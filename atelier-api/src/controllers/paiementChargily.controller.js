// src/controllers/paiementChargily.controller.js
//
// Paiement en ligne CIB / EDAHABIA via Chargily Pay™.
// Vient compléter commandes.controller.js (qui gère déjà le paiement
// "à la livraison" / virement / le suivi manuel des paiements par l'admin).
//
// Flux :
//   1. Le client crée sa commande normalement (POST /api/commandes) avec
//      methode_paiement = 'edahabia' ou 'cib'. Ce client peut être connecté
//      OU invité (guest checkout) : commande.utilisateur_id est alors NULL.
//   2. Le front appelle POST /api/commandes/:id/paiement-chargily : on crée
//      un paiement "en_attente" + un checkout Chargily, on renvoie
//      checkout_url pour rediriger le client vers la page de paiement.
//   3. Le client paie sur la page hébergée par Chargily (CIB ou EDAHABIA).
//   4. Chargily notifie notre webhook (POST /api/paiements/chargily/webhook)
//      → on met à jour le paiement + on confirme la commande si payée.
//   5. Filet de sécurité : GET /api/commandes/:id/paiement-chargily/verifier
//      permet de re-vérifier manuellement l'état auprès de Chargily (utile en
//      dev local, où Chargily ne peut pas atteindre un webhook localhost).
//
// FIX (guest checkout) :
//   - Les routes utilisent maintenant `authentifierOptionnel` (voir
//     paiementChargily.routes.js) : req.utilisateur peut être `null`.
//   - Les vérifications de propriétaire ci-dessous ne bloquent que si la
//     commande APPARTIENT à un compte (utilisateur_id non NULL) et que
//     l'appelant n'est pas ce même compte. Une commande invité
//     (utilisateur_id NULL) reste accessible via son UUID — non devinable —
//     exactement comme la page de confirmation de commande qui l'affiche.
//   - confirmerCommandeSiEnAttente utilisait un INNER JOIN utilisateurs qui
//     ne renvoyait AUCUNE ligne pour une commande invité (donc jamais
//     confirmée, jamais d'email envoyé). Passé en LEFT JOIN + COALESCE avec
//     invite_email / invite_telephone / adresse_snapshot, comme déjà fait
//     dans v_commandes_urgentes (migration_guest_checkout.sql).
const { v4: uuidv4 } = require('uuid');
const { sql, getRequest } = require('../config/db');
const chargily = require('../services/chargily.service');
const { envoyerChangementStatut } = require('../utils/email');

const EPSILON_MONTANT = 0.01;

// ── Helper : la commande appartient-elle à l'appelant ? ─────────────────────
// - Commande liée à un compte (utilisateur_id non NULL) : seul ce compte
//   (ou un admin/modérateur, si acceptAdmin=true) peut y accéder.
// - Commande invité (utilisateur_id NULL) : accessible à quiconque connaît
//   son UUID (pas de compte à qui la rattacher).
function estAutorise(commande, req, { acceptAdmin = false } = {}) {
  if (acceptAdmin && req.utilisateur && ['admin', 'moderateur'].includes(req.utilisateur.role)) {
    return true;
  }
  if (!commande.utilisateur_id) {
    return true; // commande invité
  }
  return !!req.utilisateur && commande.utilisateur_id === req.utilisateur.sub;
}

// ── Helper : confirme la commande + envoie l'email si elle était en_attente ──
async function confirmerCommandeSiEnAttente(commande_id) {
  const r = await getRequest();
  const res = await r
    .input('id', sql.UniqueIdentifier, commande_id)
    .query(`
      SELECT c.id, c.numero, c.total, c.statut, c.utilisateur_id,
             c.invite_email, c.invite_telephone, c.adresse_snapshot,
             u.prenom AS u_prenom, u.email AS u_email
      FROM commandes c
      LEFT JOIN utilisateurs u ON u.id = c.utilisateur_id
      WHERE c.id = @id
    `);

  if (res.recordset.length === 0) return null;
  const commande = res.recordset[0];

  if (commande.statut !== 'en_attente') return commande;

  const rMaj = await getRequest();
  await rMaj
    .input('id', sql.UniqueIdentifier, commande_id)
    .query("UPDATE commandes SET statut = 'confirmee' WHERE id = @id");

  // Email de confirmation : compte connecté → u.email / u.prenom ;
  // invité → invite_email + prénom extrait de l'adresse de livraison.
  let prenomDestinataire = commande.u_prenom;
  let emailDestinataire  = commande.u_email || commande.invite_email;

  if (!prenomDestinataire && commande.adresse_snapshot) {
    try {
      const adresse = JSON.parse(commande.adresse_snapshot);
      prenomDestinataire = adresse?.prenom || null;
    } catch {
      // adresse_snapshot pas du JSON exploitable : on laisse prenomDestinataire à null
    }
  }

  if (emailDestinataire) {
    setImmediate(async () => {
      try {
        await envoyerChangementStatut(
          { id: commande.id, numero: commande.numero, total: commande.total, methode_paiement: 'carte' },
          { prenom: prenomDestinataire, email: emailDestinataire },
          'confirmee'
        );
      } catch (emailErr) {
        console.error('Erreur email confirmation paiement Chargily :', emailErr);
      }
    });
  }

  return { ...commande, statut: 'confirmee' };
}

// ══════════════════════════════════════════════════════════════════════════
// POST /api/commandes/:id/paiement-chargily
// Crée (ou réutilise) un paiement en attente + un checkout Chargily.
// ══════════════════════════════════════════════════════════════════════════
async function creerCheckout(req, res) {
  try {
    const { id: commande_id } = req.params;
    const { methode = 'edahabia' } = req.body; // 'edahabia' | 'cib'

    if (!['edahabia', 'cib'].includes(methode)) {
      return res.status(400).json({ message: 'methode doit être "edahabia" ou "cib".' });
    }

    // ── Charger la commande et vérifier les droits ──────────────────────────
    const r = await getRequest();
    const cmdRes = await r
      .input('id', sql.UniqueIdentifier, commande_id)
      .query('SELECT id, numero, total, statut, utilisateur_id FROM commandes WHERE id = @id');

    if (cmdRes.recordset.length === 0) {
      return res.status(404).json({ message: 'Commande introuvable.' });
    }
    const commande = cmdRes.recordset[0];

    if (!estAutorise(commande, req)) {
      return res.status(403).json({ message: 'Accès refusé à cette commande.' });
    }

    if (commande.statut !== 'en_attente') {
      return res.status(400).json({
        message: `Cette commande ne peut plus être payée en ligne (statut actuel : "${commande.statut}").`,
      });
    }

    // ── Réutiliser une ligne de paiement "en_attente" existante pour cette
    //    commande plutôt que d'en dupliquer une. Deux cas possibles :
    //    a) POST /commandes a déjà inséré une ligne "en_attente" sans
    //       transaction_id (comportement normal quand methode_paiement
    //       valait déjà 'edahabia'/'cib' à la création de la commande) ;
    //    b) un checkout avait déjà été créé lors d'un essai précédent.
    const rExistant = await getRequest();
    const existantRes = await rExistant
      .input('commande_id', sql.UniqueIdentifier, commande_id)
      .query(`
        SELECT id, transaction_id
        FROM paiements
        WHERE commande_id = @commande_id
          AND statut = 'en_attente'
          AND methode IN ('edahabia', 'cib')
        ORDER BY created_at DESC
        LIMIT 1
      `);

    let paiement_id;

    if (existantRes.recordset.length > 0) {
      const paiementExistant = existantRes.recordset[0];
      paiement_id = paiementExistant.id;

      if (paiementExistant.transaction_id) {
        // Un checkout a déjà été créé pour cette ligne : s'il est toujours
        // valide, on le renvoie tel quel plutôt que d'en recréer un nouveau.
        try {
          const checkoutActuel = await chargily.obtenirCheckout(paiementExistant.transaction_id);
          if (checkoutActuel.status === 'pending' && checkoutActuel.checkout_url) {
            return res.status(200).json({
              message: 'Checkout existant réutilisé.',
              checkout_url: checkoutActuel.checkout_url,
              paiement_id,
            });
          }
        } catch {
          // Chargily ne répond pas / checkout introuvable → on en recrée un.
        }
      }

      // Aligner la méthode choisie sur ce que le client vient de sélectionner.
      const rMajMethode = await getRequest();
      await rMajMethode
        .input('id',      sql.UniqueIdentifier, paiement_id)
        .input('methode', sql.NVarChar(50),     methode)
        .query('UPDATE paiements SET methode = @methode, updated_at = now() WHERE id = @id');

    } else {
      // Aucune ligne existante (ex: commande créée avec methode_paiement
      // différente) → on en crée une nouvelle.
      paiement_id = uuidv4();
      const rInsert = await getRequest();
      await rInsert
        .input('id',          sql.UniqueIdentifier, paiement_id)
        .input('commande_id', sql.UniqueIdentifier, commande_id)
        .input('methode',     sql.NVarChar(50),     methode)
        .input('statut',      sql.NVarChar(20),     'en_attente')
        .input('montant',     sql.Decimal(10, 2),   commande.total)
        .query(`
          INSERT INTO paiements (id, commande_id, methode, statut, montant)
          VALUES (@id, @commande_id, @methode, @statut, @montant)
        `);
    }

    // ── Créer le checkout Chargily ───────────────────────────────────────────
    let checkout;
    try {
      checkout = await chargily.creerCheckout({
        montant: commande.total,
        commande_id: commande.id,
        commande_numero: commande.numero,
        methode,
      });
    } catch (err) {
      console.error('Erreur création checkout Chargily :', err.message, err.chargilyResponse || '');
      // On marque le paiement en échec pour ne pas laisser une ligne fantôme.
      const rEchec = await getRequest();
      await rEchec
        .input('id', sql.UniqueIdentifier, paiement_id)
        .query("UPDATE paiements SET statut = 'echoue' WHERE id = @id");
      return res.status(502).json({ message: 'Impossible de contacter le service de paiement Chargily.' });
    }

    // ── Enregistrer l'id du checkout (= transaction_id) + la réponse brute ──
    const rMaj = await getRequest();
    await rMaj
      .input('id',             sql.UniqueIdentifier, paiement_id)
      .input('transaction_id', sql.NVarChar(255),    checkout.id)
      .input('details',        sql.NVarChar(sql.MAX), JSON.stringify(checkout))
      .query(`
        UPDATE paiements
        SET transaction_id = @transaction_id, details = @details, updated_at = now()
        WHERE id = @id
      `);

    return res.status(201).json({
      message: 'Checkout Chargily créé.',
      checkout_url: checkout.checkout_url,
      paiement_id,
    });

  } catch (err) {
    console.error('creerCheckout Chargily error:', err);
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
}

// ══════════════════════════════════════════════════════════════════════════
// GET /api/commandes/:id/paiement-chargily/verifier
// Filet de sécurité : interroge directement l'API Chargily pour l'état du
// dernier checkout de cette commande, et reconcilie la base si besoin.
// Utile en développement local (webhook injoignable) ou en cas de doute.
// ══════════════════════════════════════════════════════════════════════════
async function verifierCheckout(req, res) {
  try {
    const { id: commande_id } = req.params;

    const r = await getRequest();
    const cmdRes = await r
      .input('id', sql.UniqueIdentifier, commande_id)
      .query('SELECT id, statut, utilisateur_id FROM commandes WHERE id = @id');

    if (cmdRes.recordset.length === 0) {
      return res.status(404).json({ message: 'Commande introuvable.' });
    }
    const commande = cmdRes.recordset[0];

    if (!estAutorise(commande, req, { acceptAdmin: true })) {
      return res.status(403).json({ message: 'Accès refusé à cette commande.' });
    }

    const rPaiement = await getRequest();
    const paiementRes = await rPaiement
      .input('commande_id', sql.UniqueIdentifier, commande_id)
      .query(`
        SELECT id, statut, transaction_id, montant
        FROM paiements
        WHERE commande_id = @commande_id
          AND methode IN ('edahabia', 'cib')
          AND transaction_id IS NOT NULL
        ORDER BY created_at DESC
        LIMIT 1
      `);

    if (paiementRes.recordset.length === 0) {
      return res.status(404).json({ message: 'Aucun paiement Chargily trouvé pour cette commande.' });
    }
    const paiement = paiementRes.recordset[0];

    const checkout = await chargily.obtenirCheckout(paiement.transaction_id);
    const resultat = await appliquerStatutCheckout(paiement, checkout);

    return res.status(200).json({
      checkout_status: checkout.status,
      paiement_statut: resultat.statutPaiement,
      commande_statut: resultat.statutCommande,
    });

  } catch (err) {
    console.error('verifierCheckout Chargily error:', err);
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
}

// ── Applique le statut d'un checkout Chargily au paiement + à la commande ──
// Partagé entre le webhook et la vérification manuelle.
async function appliquerStatutCheckout(paiementRow, checkout) {
  const { id: paiement_id, commande_id, montant, statut: statutActuel } = paiementRow;

  let statutPaiement = statutActuel;
  let statutCommande;

  if (checkout.status === 'paid') {
    if (statutActuel !== 'reussi') {
      // Vérification anti-fraude simple : le montant payé doit correspondre
      // à ce qui était attendu (tolérance pour les centimes).
      const montantPaye = Number(checkout.amount || 0);
      if (Math.abs(montantPaye - Number(montant)) > EPSILON_MONTANT) {
        console.error(
          `⚠️  Montant Chargily incohérent pour paiement ${paiement_id} : attendu ${montant}, reçu ${montantPaye}.`
        );
      }

      const r = await getRequest();
      await r
        .input('id', sql.UniqueIdentifier, paiement_id)
        .input('details', sql.NVarChar(sql.MAX), JSON.stringify(checkout))
        .query(`
          UPDATE paiements
          SET statut = 'reussi', details = @details, updated_at = now()
          WHERE id = @id
        `);
      statutPaiement = 'reussi';
    }
    const commandeMaj = await confirmerCommandeSiEnAttente(commande_id);
    statutCommande = commandeMaj?.statut;

  } else if (['failed', 'expired', 'canceled'].includes(checkout.status)) {
    if (statutActuel === 'en_attente') {
      const r = await getRequest();
      await r
        .input('id', sql.UniqueIdentifier, paiement_id)
        .input('details', sql.NVarChar(sql.MAX), JSON.stringify(checkout))
        .query(`
          UPDATE paiements
          SET statut = 'echoue', details = @details, updated_at = now()
          WHERE id = @id
        `);
      statutPaiement = 'echoue';
    }
  }

  return { statutPaiement, statutCommande };
}

// ══════════════════════════════════════════════════════════════════════════
// POST /api/paiements/chargily/webhook   [PUBLIC — appelé par Chargily]
// ══════════════════════════════════════════════════════════════════════════
async function webhook(req, res) {
  try {
    const signature = req.headers['signature'];
    const rawBody   = req.rawBody;

    if (!signature || !chargily.verifierSignature(rawBody, signature)) {
      console.warn('Webhook Chargily : signature manquante ou invalide.');
      return res.sendStatus(403);
    }

    // Le corps a déjà été parsé en JSON par express (req.body), on peut s'y fier
    // maintenant que la signature sur le rawBody est validée.
    const event = req.body;
    const checkout = event?.data;

    if (!checkout?.id) {
      return res.sendStatus(400);
    }

    // ── Retrouver le paiement correspondant via transaction_id = checkout.id ─
    const r = await getRequest();
    const paiementRes = await r
      .input('transaction_id', sql.NVarChar(255), checkout.id)
      .query(`
        SELECT id, commande_id, montant, statut
        FROM paiements
        WHERE transaction_id = @transaction_id
      `);

    if (paiementRes.recordset.length === 0) {
      // Événement légitime mais qui ne correspond à aucun paiement connu chez
      // nous (ex: rejoué après suppression de la commande) → on répond 200
      // pour éviter que Chargily ne réessaie indéfiniment, mais on logue.
      console.warn(`Webhook Chargily : paiement introuvable pour checkout ${checkout.id}.`);
      return res.sendStatus(200);
    }

    const paiement = paiementRes.recordset[0];
    await appliquerStatutCheckout(paiement, checkout);

    return res.sendStatus(200);

  } catch (err) {
    console.error('webhook Chargily error:', err);
    // On répond 200 quand même : une erreur de notre côté ne doit pas faire
    // boucler indéfiniment les tentatives de webhook de Chargily. L'état
    // pourra toujours être reconcilié via /paiement-chargily/verifier.
    return res.sendStatus(200);
  }
}

module.exports = {
  creerCheckout,
  verifierCheckout,
  webhook,
};