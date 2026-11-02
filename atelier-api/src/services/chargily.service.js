// src/services/chargily.service.js
//
// Intégration Chargily Pay™ (API v2) — paiement en ligne CIB (SATIM) et
// EDAHABIA (Algérie Poste) pour les commandes payées par carte.
//
// Documentation officielle : https://dev.chargily.com/pay-v2/introduction
//
// Ce module ne fait que parler à l'API Chargily : il ne touche pas à la base
// de données (ça reste dans les contrôleurs, comme pour le reste du projet).
//
// Variables d'environnement attendues (voir .env) :
//   CHARGILY_API_KEY      → clé API (secret key) fournie par Chargily
//   CHARGILY_MODE         → 'test' ou 'live' (détermine l'URL de base)
//   CHARGILY_WEBHOOK_URL  → URL publique de votre webhook
//                            (ex: https://api.votre-domaine.dz/api/paiements/chargily/webhook)
//   FRONTEND_URL           → déjà utilisé ailleurs dans le projet, sert de base
//                            aux URLs de redirection succès/échec
'use strict';

const crypto = require('crypto');

const MODE       = (process.env.CHARGILY_MODE || 'test').toLowerCase();
const API_KEY    = process.env.CHARGILY_API_KEY || '';
const BASE_URL   = MODE === 'live'
  ? 'https://pay.chargily.net/api/v2'
  : 'https://pay.chargily.net/test/api/v2';

// EDAHABIA / CIB : Chargily n'accepte que ces deux valeurs pour payment_method
// (si on ne précise rien, l'utilisateur choisit sur la page de paiement Chargily)
const METHODES_CHARGILY_VALIDES = ['edahabia', 'cib'];

/**
 * Petit wrapper fetch → gère l'auth Bearer, le JSON, et les erreurs API.
 * Node 18+ requis (fetch global). Sinon, remplacer par `node-fetch`.
 */
async function appelerChargily(path, { method = 'GET', body } = {}) {
  if (!API_KEY) {
    throw new Error('CHARGILY_API_KEY manquant dans la configuration serveur.');
  }
  if (typeof fetch !== 'function') {
    throw new Error(
      'fetch global indisponible — utilisez Node.js 18+ ou installez "node-fetch".'
    );
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const texte = await res.text();
  let data;
  try {
    data = texte ? JSON.parse(texte) : {};
  } catch {
    data = { raw: texte };
  }

  if (!res.ok) {
    const message = data?.message || data?.errors || `Erreur Chargily (HTTP ${res.status}).`;
    const err = new Error(typeof message === 'string' ? message : JSON.stringify(message));
    err.status = res.status;
    err.chargilyResponse = data;
    throw err;
  }

  return data;
}

/**
 * Crée un checkout Chargily pour une commande, et retourne l'objet checkout
 * (dont checkout_url, à ouvrir/rediriger côté client).
 *
 * @param {Object} params
 * @param {number} params.montant          Montant en DZD (entier ou décimal, sera arrondi)
 * @param {string} params.commande_id       UUID interne de la commande (mis en metadata)
 * @param {string} params.commande_numero   Numéro lisible de la commande (mis dans la description)
 * @param {string} [params.methode]         'edahabia' | 'cib' | undefined (laisser choisir le client)
 * @param {string} [params.locale]          'fr' | 'ar' | 'en'
 */
async function creerCheckout({ montant, commande_id, commande_numero, methode, locale = 'fr' }) {
  const frontendUrl = (process.env.FRONTEND_URL || '').split(',')[0].replace(/\/$/, '');
  const paymentMethod = METHODES_CHARGILY_VALIDES.includes(methode) ? methode : undefined;

  const payload = {
    // Chargily attend un montant en unité "normale" (DZD), pas en centimes.
    amount: Math.round(Number(montant) * 100) / 100,
    currency: 'dzd',
    description: `Commande ${commande_numero} — Atelier S.L`,
    // On renvoie vers /compte (page existante du SPA, onglet "Mes commandes")
    // avec des paramètres que le front détecte au chargement — voir
    // captureChargilyReturn() dans atelier_sl_client.html.
    success_url: `${frontendUrl}/compte?paiement=succes&commande=${encodeURIComponent(commande_numero)}`,
    failure_url: `${frontendUrl}/compte?paiement=echec&commande=${encodeURIComponent(commande_numero)}`,
    webhook_endpoint: process.env.CHARGILY_WEBHOOK_URL,
    locale,
    metadata: { commande_id, commande_numero },
  };
  if (paymentMethod) payload.payment_method = paymentMethod;

  return appelerChargily('/checkouts', { method: 'POST', body: payload });
}

/**
 * Récupère l'état actuel d'un checkout directement depuis l'API Chargily.
 * Sert de filet de sécurité si le webhook n'est jamais arrivé (ex: en dev
 * local, où Chargily ne peut pas atteindre localhost).
 */
async function obtenirCheckout(checkoutId) {
  return appelerChargily(`/checkouts/${encodeURIComponent(checkoutId)}`);
}

/**
 * Vérifie la signature HMAC-SHA256 envoyée par Chargily dans le header
 * "signature" de chaque requête webhook, calculée sur le corps BRUT
 * (avant tout parsing JSON) avec la clé API secrète.
 *
 * @param {Buffer|string} rawBody   Corps brut de la requête (req.rawBody)
 * @param {string} signatureHeader  Valeur du header "signature"
 * @returns {boolean}
 */
function verifierSignature(rawBody, signatureHeader) {
  if (!signatureHeader || !rawBody || !API_KEY) return false;

  const payload = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody), 'utf-8');
  const signatureCalculee = crypto
    .createHmac('sha256', API_KEY)
    .update(payload)
    .digest('hex');

  try {
    // Comparaison en temps constant pour éviter les attaques par timing.
    const a = Buffer.from(signatureCalculee, 'utf-8');
    const b = Buffer.from(String(signatureHeader), 'utf-8');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

module.exports = {
  MODE,
  creerCheckout,
  obtenirCheckout,
  verifierSignature,
};
