// src/services/whatsapp.service.js
//
// Notification WhatsApp à l'admin — "Nouvelle commande".
// Comblait un manque : le trigger SQL trg_notif_nouvelle_commande crée bien
// une notification interne (table `notifications`), mais rien n'envoyait
// jamais de vrai message WhatsApp à l'admin. Ce module fait l'envoi réel.
//
// Fournisseur : WhatsApp Cloud API (Meta), la même API que Chargily côté
// paiement suit comme modèle — un service isolé, aucun accès DB ici, un
// simple wrapper fetch (Node 18+ requis, comme chargily.service.js).
//
// Documentation officielle : https://developers.facebook.com/docs/whatsapp/cloud-api
//
// Variables d'environnement attendues (voir .env) :
//   WHATSAPP_ENABLED       → 'true' pour activer l'envoi réel (sinon no-op, cf. plus bas)
//   WHATSAPP_API_TOKEN     → token d'accès permanent (System User) de l'app Meta
//   WHATSAPP_PHONE_ID      → ID du numéro expéditeur (Phone Number ID Meta)
//   WHATSAPP_ADMIN_NUMBERS → un ou plusieurs numéros admin destinataires,
//                             séparés par des virgules, au format E.164 sans
//                             le "+" (ex: 213XXXXXXXXX,213YYYYYYYYY)
//   WHATSAPP_API_VERSION   → version de l'API Graph (défaut: v20.0)
//
// ⚠️  En dehors de la fenêtre de 24h suivant le dernier message reçu du
//     destinataire, Meta exige un "message template" pré-approuvé (on ne
//     peut pas envoyer de texte libre à froid). Voir NOUVELLE_COMMANDE_TEMPLATE
//     ci-dessous : à créer et faire approuver dans Meta Business Manager,
//     avec exactement ce nombre de variables, avant la mise en prod.
'use strict';

const API_VERSION = process.env.WHATSAPP_API_VERSION || 'v20.0';
const PHONE_ID     = process.env.WHATSAPP_PHONE_ID || '';
const API_TOKEN    = process.env.WHATSAPP_API_TOKEN || '';
const ENABLED      = String(process.env.WHATSAPP_ENABLED || '').toLowerCase() === 'true';

const ADMIN_NUMBERS = (process.env.WHATSAPP_ADMIN_NUMBERS || '')
  .split(',')
  .map((n) => n.trim())
  .filter(Boolean);

// Nom du template WhatsApp à créer/approuver dans Meta Business Manager.
// Corps suggéré (français) :
//   "Nouvelle commande {{1}} — {{2}} DZD. Client : {{3}}. Voir : {{4}}"
const NOUVELLE_COMMANDE_TEMPLATE = process.env.WHATSAPP_TEMPLATE_NOUVELLE_COMMANDE
  || 'nouvelle_commande_admin';

/**
 * Petit wrapper fetch vers l'API Graph de Meta — même esprit que
 * appelerChargily() dans chargily.service.js.
 */
async function appelerWhatsApp(path, body) {
  if (!API_TOKEN || !PHONE_ID) {
    throw new Error(
      'WHATSAPP_API_TOKEN / WHATSAPP_PHONE_ID manquant dans la configuration serveur.'
    );
  }
  if (typeof fetch !== 'function') {
    throw new Error(
      'fetch global indisponible — utilisez Node.js 18+ ou installez "node-fetch".'
    );
  }

  const url = `https://graph.facebook.com/${API_VERSION}/${PHONE_ID}${path}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const texte = await res.text();
  let data;
  try {
    data = texte ? JSON.parse(texte) : {};
  } catch {
    data = { raw: texte };
  }

  if (!res.ok) {
    const message = data?.error?.message || `Erreur WhatsApp Cloud API (HTTP ${res.status}).`;
    const err = new Error(message);
    err.status = res.status;
    err.whatsappResponse = data;
    throw err;
  }

  return data;
}

/**
 * Envoie la notification WhatsApp "nouvelle commande" à tous les numéros
 * admin configurés. Ne lève jamais d'exception vers l'appelant : chaque
 * échec est loggé individuellement (l'envoi WhatsApp ne doit jamais faire
 * échouer la création de la commande elle-même).
 *
 * @param {Object} commande   Commande complète (id, numero, total, ...)
 * @param {Object} client     { prenom, nom } du client ayant passé commande
 */
async function envoyerNotificationNouvelleCommande(commande, client = {}) {
  if (!ENABLED) {
    console.log(
      `[whatsapp] désactivé (WHATSAPP_ENABLED != true) — commande ${commande?.numero} non notifiée.`
    );
    return { skipped: true, reason: 'disabled' };
  }
  if (ADMIN_NUMBERS.length === 0) {
    console.warn('[whatsapp] WHATSAPP_ADMIN_NUMBERS vide — aucune notification envoyée.');
    return { skipped: true, reason: 'no_recipients' };
  }

  const clientNom = [client.prenom, client.nom].filter(Boolean).join(' ') || 'Client';
  const total = Number(commande.total || 0).toFixed(2);
  const lienAdmin = `${(process.env.FRONTEND_URL || '').split(',')[0].replace(/\/$/, '')}/admin/commandes/${commande.id}`;

  const resultats = await Promise.allSettled(
    ADMIN_NUMBERS.map((numero) =>
      appelerWhatsApp('/messages', {
        messaging_product: 'whatsapp',
        to: numero,
        type: 'template',
        template: {
          name: NOUVELLE_COMMANDE_TEMPLATE,
          language: { code: 'fr' },
          components: [
            {
              type: 'body',
              parameters: [
                { type: 'text', text: commande.numero || '' },
                { type: 'text', text: total },
                { type: 'text', text: clientNom },
                { type: 'text', text: lienAdmin },
              ],
            },
          ],
        },
      })
    )
  );

  resultats.forEach((resultat, i) => {
    if (resultat.status === 'rejected') {
      console.error(
        `[whatsapp] échec envoi à ${ADMIN_NUMBERS[i]} pour commande ${commande.numero}:`,
        resultat.reason?.message || resultat.reason
      );
    }
  });

  return {
    skipped: false,
    envoyes: resultats.filter((r) => r.status === 'fulfilled').length,
    echecs: resultats.filter((r) => r.status === 'rejected').length,
  };
}

module.exports = {
  envoyerNotificationNouvelleCommande,
};
