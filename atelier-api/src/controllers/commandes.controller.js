// src/controllers/commandes.controller.js
// ⚠️  VERSION CORRIGÉE — 4 correctifs appliqués :
//   1. Race condition sur le stock → lecture des variantes DANS la transaction avec UPDLOCK
//   2. restockerLignes → charge les lignes DANS la transaction (plus hors transaction)
//   3. ajouterPaiement → validation montant == total commande (et pas de sur-paiement)
//   4. codes_promo.utilisations_count → incrémentation atomique DANS la transaction
//      (⚠️ si le trigger SQL trg_utilisation_promo existe toujours, il faut le SUPPRIMER
//       côté base de données pour éviter une double incrémentation — voir note plus bas)
const { v4: uuidv4 } = require('uuid');
const { sql, getRequest, getPool, getClient, SqlRequest } = require('../config/db');
const {
  envoyerConfirmationCommande,
  envoyerChangementStatut,
  envoyerNotificationAdminNouvelleCommande,
} = require('../utils/email');
const { envoyerNotificationNouvelleCommande } = require('../services/whatsapp.service');
const PDFDocument = require('pdfkit');
const journalAdmin = require('../utils/journalAdmin');
const { calculerFraisLivraison } = require('../utils/tarifsLivraison');

// ══════════════════════════════════════════════════════════════════════════════
// CONSTANTES MÉTIER
// ══════════════════════════════════════════════════════════════════════════════

const FRAIS_LIVRAISON_DEFAUT   = parseFloat(process.env.FRAIS_LIVRAISON_DEFAUT   || '500');
// Valeurs de secours si jamais parametres_site est vide/inaccessible — la
// vraie source de vérité est désormais le panneau admin (Paramètres).
const SEUIL_LIVRAISON_GRATUITE_DEFAUT = parseFloat(process.env.SEUIL_LIVRAISON_GRATUITE || '10000');

// Tolérance arithmétique (en DZD) pour comparer les montants décimaux.
const EPSILON_MONTANT = 0.01;

// Machine à états des commandes (cf. CHECK chk_statut_commande du schéma)
const TRANSITIONS = {
  en_attente:     ['confirmee', 'annulee'],
  confirmee:      ['en_preparation', 'annulee'],
  en_preparation: ['expediee', 'annulee'],
  expediee:       ['livree'],
  livree:         ['remboursee'],
  annulee:        [],
  remboursee:     [],
};

// Statuts depuis lesquels une commande est annulable et pour lesquels le
// stock (produits "stock" uniquement) a déjà été décrémenté et doit être
// recrédité. Le décrément a désormais lieu à la CRÉATION de la commande
// (dans creer(), avec verrou UPDLOCK/HOLDLOCK sur variantes), pas à la
// confirmation — donc dès que la commande existe, son stock est décrémenté.
const STATUTS_AVEC_STOCK_DECREMENTE = ['en_attente', 'confirmee', 'en_preparation', 'expediee'];

// ══════════════════════════════════════════════════════════════════════════════
// HELPERS INTERNES
// ══════════════════════════════════════════════════════════════════════════════

async function chargerLignes(commande_id) {
  const r = await getRequest();
  const res = await r
    .input('commande_id', sql.UniqueIdentifier, commande_id)
    .query(`
      SELECT lc.id, lc.variante_id, lc.produit_id, lc.quantite, lc.prix_unitaire,
             lc.produit_nom, lc.produit_sku, lc.produit_taille, lc.produit_couleur,
             lc.produit_couleur_hex, lc.date_evenement, lc.mesures,
             (lc.quantite * lc.prix_unitaire) AS sous_total_ligne,
             COALESCE(
               (SELECT ip.url FROM images_produit ip
                WHERE ip.variante_id = lc.variante_id
                ORDER BY ip.principale DESC, ip.ordre ASC LIMIT 1),
               (SELECT ip.url FROM images_produit ip
                WHERE ip.produit_id = lc.produit_id
                ORDER BY ip.principale DESC, ip.ordre ASC LIMIT 1)
             ) AS image_url
      FROM lignes_commande lc
      WHERE lc.commande_id = @commande_id
      ORDER BY lc.date_evenement ASC, lc.produit_nom
    `);
  return res.recordset;
}

async function chargerPaiements(commande_id) {
  const r = await getRequest();
  const res = await r
    .input('commande_id', sql.UniqueIdentifier, commande_id)
    .query(`
      SELECT id, methode, transaction_id, statut, montant, devise, created_at, updated_at
      FROM paiements
      WHERE commande_id = @commande_id
      ORDER BY created_at DESC
    `);
  return res.recordset;
}

/**
 * Recrédite le stock des lignes de commande liées à une variante (produits
 * de type "stock" uniquement — les lignes "sur_mesure" ont variante_id NULL
 * et ne sont pas concernées). Appelée dans la transaction d'annulation.
 */
async function restockerLignes(commande_id, requestFactory) {
  const rLignes = requestFactory();
  const lignesRes = await rLignes
    .input('commande_id', sql.UniqueIdentifier, commande_id)
    .query(`
      SELECT id, variante_id, quantite
      FROM lignes_commande
      WHERE commande_id = @commande_id AND variante_id IS NOT NULL
    `);

  for (const ligne of lignesRes.recordset) {
    const rMaj = requestFactory();
    await rMaj
      .input('id',  sql.UniqueIdentifier, ligne.variante_id)
      .input('qte', sql.Int,              ligne.quantite)
      .query('UPDATE variantes SET stock = stock + @qte WHERE id = @id');

    const rHist = requestFactory();
    await rHist
      .input('id',             sql.UniqueIdentifier, uuidv4())
      .input('variante_id',    sql.UniqueIdentifier, ligne.variante_id)
      .input('commande_id',    sql.UniqueIdentifier, commande_id)
      .input('quantite',       sql.Int,              ligne.quantite)
      .query(`
        INSERT INTO historique_stock
          (id, variante_id, commande_id, type_mouvement, quantite_avant, quantite_delta, quantite_apres, note)
        SELECT
          @id, @variante_id, @commande_id, 'retour',
          stock - @quantite, @quantite, stock,
          'Réapprovisionnement — annulation commande'
        FROM variantes WHERE id = @variante_id
      `)
      .catch(() => {}); // historique_stock est un bonus, ne bloque pas l'annulation si absent
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/commandes
// ══════════════════════════════════════════════════════════════════════════════
async function lister(req, res) {
  try {
    const {
      page           = 1,
      limite         = 12,
      statut         = '',
      numero         = '',
      utilisateur_id = '',
      tri            = 'created_at',
      ordre          = 'DESC',
    } = req.query;

    const estAdmin = ['admin', 'moderateur'].includes(req.utilisateur.role);
    const offset    = (Math.max(1, parseInt(page)) - 1) * Math.min(50, parseInt(limite));
    const nbLigne   = Math.min(50, Math.max(1, parseInt(limite)));

    const colonnesTri  = ['created_at', 'total', 'statut', 'numero'];
    const colonneTri    = colonnesTri.includes(tri) ? tri : 'created_at';
    const ordreTri       = ['ASC', 'DESC'].includes(ordre.toUpperCase()) ? ordre.toUpperCase() : 'DESC';

    const conditions = ['1=1'];
    const r = await getRequest();

    // Un client ne voit que ses propres commandes ; un admin/modérateur peut
    // filtrer sur un utilisateur précis ou voir l'ensemble.
    if (estAdmin) {
      if (utilisateur_id) {
        conditions.push('c.utilisateur_id = @utilisateur_id');
        r.input('utilisateur_id', sql.UniqueIdentifier, utilisateur_id);
      }
    } else {
      conditions.push('c.utilisateur_id = @utilisateur_id');
      r.input('utilisateur_id', sql.UniqueIdentifier, req.utilisateur.sub);
    }

    if (statut) {
      conditions.push('c.statut = @statut');
      r.input('statut', sql.NVarChar(20), statut);
    }

    if (numero) {
      conditions.push('c.numero LIKE @numero');
      r.input('numero', sql.NVarChar(20), `%${numero}%`);
    }

    const where = conditions.join(' AND ');
    r.input('offset',  sql.Int, offset);
    r.input('nbLigne', sql.Int, nbLigne);

    const querySQL = `
      SELECT
        c.id, c.numero, c.statut, c.sous_total, c.remise, c.frais_livraison,
        c.total, c.created_at, c.updated_at,
        c.adresse_snapshot,
        u.nom                                                           AS utilisateur_nom,
        u.prenom                                                        AS utilisateur_prenom,
        COALESCE(u.email, c.invite_email)                              AS utilisateur_email,
        CASE WHEN c.utilisateur_id IS NULL THEN 1 ELSE 0 END              AS est_invite,
        (SELECT COUNT(*) FROM lignes_commande lc WHERE lc.commande_id = c.id) AS nb_articles,
        (SELECT MIN(lc2.date_evenement) FROM lignes_commande lc2 WHERE lc2.commande_id = c.id AND lc2.date_evenement IS NOT NULL) AS date_evenement_min,
        (
          SELECT COALESCE(
            (SELECT ip.url FROM images_produit ip
             WHERE ip.variante_id = lc3.variante_id
             ORDER BY ip.principale DESC, ip.ordre ASC LIMIT 1),
            (SELECT ip.url FROM images_produit ip
             WHERE ip.produit_id = lc3.produit_id
             ORDER BY ip.principale DESC, ip.ordre ASC LIMIT 1)
          )
          FROM lignes_commande lc3
          WHERE lc3.commande_id = c.id
          ORDER BY lc3.date_evenement ASC, lc3.produit_nom
          LIMIT 1
        ) AS image_url
      FROM commandes c
      LEFT JOIN utilisateurs u ON u.id = c.utilisateur_id
      WHERE ${where}
      ORDER BY c.${colonneTri} ${ordreTri}
      LIMIT @nbLigne OFFSET @offset
    `;

    const rCount = await getRequest();
    if (!estAdmin)               rCount.input('utilisateur_id', sql.UniqueIdentifier, req.utilisateur.sub);
    else if (utilisateur_id)     rCount.input('utilisateur_id', sql.UniqueIdentifier, utilisateur_id);
    if (statut) rCount.input('statut', sql.NVarChar(20), statut);
    if (numero) rCount.input('numero', sql.NVarChar(20), `%${numero}%`);

    const countSQL = `SELECT COUNT(*) AS total FROM commandes c WHERE ${where}`;

    const [commandes, count] = await Promise.all([
      r.query(querySQL),
      rCount.query(countSQL),
    ]);

    const total = count.recordset[0].total;

    // Repli nom/prénom "invité" depuis adresse_snapshot, fait en JS plutôt
    // qu'en SQL (opérateur ->> non supporté sur toutes les versions
    // MySQL/MariaDB) : évite un 500 si l'hébergeur tourne une version plus
    // ancienne. adresse_snapshot peut arriver en objet déjà parsé (MySQL 8)
    // ou en chaîne JSON (MariaDB / mysql2 selon config) — on gère les deux.
    const lignesFinal = commandes.recordset.map((row) => {
      if (!row.utilisateur_nom || !row.utilisateur_prenom) {
        let snap = row.adresse_snapshot;
        if (typeof snap === 'string') {
          try { snap = JSON.parse(snap); } catch { snap = null; }
        }
        if (snap) {
          row.utilisateur_nom    = row.utilisateur_nom    || snap.nom    || null;
          row.utilisateur_prenom = row.utilisateur_prenom || snap.prenom || null;
        }
      }
      delete row.adresse_snapshot;
      return row;
    });

    return res.status(200).json({
      commandes: lignesFinal,
      pagination: {
        page:   parseInt(page),
        limite: nbLigne,
        total,
        pages:  Math.ceil(total / nbLigne),
      },
    });

  } catch (err) {
    console.error('lister commandes error:', err);
    // Filet de sécurité : un admin/modérateur voit le vrai message d'erreur
    // directement dans l'interface (au lieu du texte générique), pour
    // pouvoir diagnostiquer sans avoir à aller consulter les logs serveur.
    const estAdminErr = req.utilisateur && ['admin', 'moderateur'].includes(req.utilisateur.role);
    return res.status(500).json({
      message: estAdminErr ? `Erreur serveur : ${err.message}` : 'Erreur serveur.',
    });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/commandes/:id
// ══════════════════════════════════════════════════════════════════════════════
async function obtenir(req, res) {
  try {
    const { id } = req.params;

    const r = await getRequest();
    const result = await r
      .input('id', sql.UniqueIdentifier, id)
      .query(`
        SELECT
          c.*,
          u.nom                                                AS utilisateur_nom,
          u.prenom                                              AS utilisateur_prenom,
          u.telephone                                          AS utilisateur_telephone,
          COALESCE(u.email, c.invite_email)                              AS utilisateur_email,
          cp.code AS code_promo_code
        FROM commandes c
        LEFT JOIN  utilisateurs u  ON u.id  = c.utilisateur_id
        LEFT JOIN  codes_promo  cp ON cp.id = c.code_promo_id
        WHERE c.id = @id
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ message: 'Commande introuvable.' });
    }

    const commande = result.recordset[0];
    // Repli invité depuis adresse_snapshot (JS plutôt que SQL ->>, voir lister()).
    if (!commande.utilisateur_nom || !commande.utilisateur_prenom) {
      let snap = commande.adresse_snapshot;
      if (typeof snap === 'string') {
        try { snap = JSON.parse(snap); } catch { snap = null; }
      }
      if (snap) {
        commande.utilisateur_nom    = commande.utilisateur_nom    || snap.nom    || null;
        commande.utilisateur_prenom = commande.utilisateur_prenom || snap.prenom || null;
      }
    }
    const estAdmin = ['admin', 'moderateur'].includes(req.utilisateur.role);

    if (!estAdmin && commande.utilisateur_id !== req.utilisateur.sub) {
      return res.status(403).json({ message: 'Accès refusé à cette commande.' });
    }

    const [lignes, paiements] = await Promise.all([
      chargerLignes(id),
      chargerPaiements(id),
    ]);

    return res.status(200).json({ ...commande, lignes, paiements });

  } catch (err) {
    console.error('obtenir commande error:', err);
    const estAdminErr = req.utilisateur && ['admin', 'moderateur'].includes(req.utilisateur.role);
    return res.status(500).json({
      message: estAdminErr ? `Erreur serveur : ${err.message}` : 'Erreur serveur.',
    });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/commandes
// Crée une commande à partir du panier de l'utilisateur connecté.
//
// ✅ CORRECTIONS APPORTÉES :
//   - La lecture des variantes (avec leur stock) est faite DANS la transaction
//     avec WITH (UPDLOCK, HOLDLOCK) pour empêcher 2 commandes concurrentes de
//     passer la vérification de stock sur le même article.
//   - L'incrémentation du compteur d'utilisation du code promo est faite DANS
//     la transaction avec un UPDATE atomique vérifiant la limite, au lieu de
//     laisser le trigger trg_utilisation_promo le faire de façon non atomique.
//   ⚠️  IMPORTANT : si le trigger SQL trg_utilisation_promo existe toujours dans
//      votre base, il faut le SUPPRIMER côté SQL Server pour éviter une double
//      incrémentation. Commande à exécuter une fois :
//          DROP TRIGGER IF EXISTS trg_utilisation_promo;
//      (Le trigger trg_decrementer_stock, lui, doit rester DÉSACTIVÉ : le
//       décrément de stock est désormais géré ici, dans cette même
//       transaction, avec verrou UPDLOCK/HOLDLOCK — voir étape 6/11 ci-dessous.)
// ══════════════════════════════════════════════════════════════════════════════
async function creer(req, res) {
  let transaction;
  try {
    // req.utilisateur est renseigné (client connecté) ou null (invité) —
    // voir middleware authentifierOptionnel sur cette route.
    const utilisateur_id = req.utilisateur ? req.utilisateur.sub : null;
    const {
      adresse_id,
      adresse: adresseInline = null, // { prenom, nom, rue, complement, ville, pays, telephone, email } — invité
      email:       inviteEmail     = null,
      telephone:   inviteTelephone = null,
      code_promo       = null,
      note_client      = null,
      methode_paiement = 'a_la_livraison',
      dates_evenement  = {},  // { [ligne_panier_id]: 'YYYY-MM-DD' } (optionnel, sinon date déjà sur la ligne)
      // Grille tarifaire Yalidine (Algérie uniquement) : code wilaya à 2
      // chiffres + type de livraison choisi par le client au checkout.
      wilaya_code      = null,
      type_livraison   = 'domicile', // 'domicile' | 'stopdesk'
    } = req.body;

    // ────────────────────────────────────────────────────────────────────────
    // 1. Résoudre l'adresse de livraison
    //    - Client connecté : adresse_id doit référencer une adresse lui appartenant.
    //    - Invité (pas de compte)  : adresse fournie directement dans le corps
    //      de la requête, avec email + téléphone obligatoires pour le contact.
    // ────────────────────────────────────────────────────────────────────────
    let adresse;
    let email_commande     = null;
    let telephone_commande = null;

    if (utilisateur_id) {
      if (!adresse_id) {
        return res.status(400).json({ message: 'adresse_id est obligatoire.' });
      }
      const rAdresse = await getRequest();
      const adresseRes = await rAdresse
        .input('id',             sql.UniqueIdentifier, adresse_id)
        .input('utilisateur_id', sql.UniqueIdentifier, utilisateur_id)
        .query(`
          SELECT id, prenom, nom, rue, complement, ville, pays
          FROM adresses
          WHERE id = @id AND utilisateur_id = @utilisateur_id
        `);

      if (adresseRes.recordset.length === 0) {
        return res.status(404).json({ message: 'Adresse introuvable.' });
      }
      adresse = adresseRes.recordset[0];
    } else {
      // ── Commande invité : pas de ligne dans `adresses` (elle exige un utilisateur_id) ──
      if (!adresseInline) {
        return res.status(400).json({ message: 'Adresse de livraison obligatoire.' });
      }
      email_commande     = (inviteEmail || adresseInline.email || '').trim().toLowerCase();
      telephone_commande = (inviteTelephone || adresseInline.telephone || '').trim();

      if (!email_commande) {
        return res.status(400).json({ message: 'E-mail obligatoire pour une commande sans compte.' });
      }

      adresse = {
        prenom:     (adresseInline.prenom     || '').trim(),
        nom:        (adresseInline.nom        || '').trim(),
        rue:        (adresseInline.rue        || '').trim(),
        complement: (adresseInline.complement || '').trim() || null,
        ville:      (adresseInline.ville      || '').trim(),
        pays:       (adresseInline.pays       || 'Algérie').trim(),
      };
    }

    // ────────────────────────────────────────────────────────────────────────
    // 2. Vérifier qu'un panier existe (hors transaction, simple contrôle)
    //    Client connecté → panier lié à utilisateur_id
    //    Invité           → panier lié à session_id (en-tête x-session-id)
    // ────────────────────────────────────────────────────────────────────────
    const session_id = utilisateur_id ? null : (req.headers['x-session-id'] || null);

    if (!utilisateur_id && !session_id) {
      return res.status(400).json({ message: 'En-tête x-session-id requis pour une commande invité.' });
    }

    const rPanier = await getRequest();
    rPanier.input('utilisateur_id', sql.UniqueIdentifier, utilisateur_id || null);
    rPanier.input('session_id',     sql.NVarChar(255),    session_id || null);
    const panierRes = await rPanier.query(`
      SELECT id FROM paniers
      WHERE (@utilisateur_id IS NOT NULL AND utilisateur_id = @utilisateur_id)
         OR (@session_id     IS NOT NULL AND session_id     = @session_id)
    `);

    if (panierRes.recordset.length === 0) {
      return res.status(400).json({ message: 'Votre panier est vide.' });
    }
    const panier_id = panierRes.recordset[0].id;

    // ────────────────────────────────────────────────────────────────────────
    // 3. Pré-validation du code promo hors transaction (lecture seule)
    //    La vérification finale + incrémentation aura lieu dans la transaction.
    // ────────────────────────────────────────────────────────────────────────
    let promoPreflight = null;
    if (code_promo) {
      const rPromo = await getRequest();
      const promoRes = await rPromo
        .input('code', sql.NVarChar(50), code_promo)
        .query(`
          SELECT id, type_remise, valeur, montant_minimum,
                 utilisations_max, utilisations_count, debut_le, expire_le, actif
          FROM codes_promo
          WHERE code = @code
        `);

      if (promoRes.recordset.length === 0) {
        return res.status(404).json({ message: 'Code promo introuvable.' });
      }
      promoPreflight = promoRes.recordset[0];
      const maintenant = new Date();

      if (!promoPreflight.actif) {
        return res.status(400).json({ message: 'Ce code promo n\'est plus actif.' });
      }
      if (promoPreflight.debut_le && new Date(promoPreflight.debut_le) > maintenant) {
        return res.status(400).json({ message: 'Ce code promo n\'est pas encore valide.' });
      }
      if (promoPreflight.expire_le && new Date(promoPreflight.expire_le) < maintenant) {
        return res.status(400).json({ message: 'Ce code promo a expiré.' });
      }
    }

    // ────────────────────────────────────────────────────────────────────────
    // 4. OUVERTURE DE LA TRANSACTION
    //    Toutes les opérations critiques (stock, code promo, commande, lignes)
    //    sont faites à l'intérieur pour garantir l'atomicité.
    // ────────────────────────────────────────────────────────────────────────
    transaction = await getClient();
    await transaction.query('BEGIN');
    // Compat avec le reste du fichier qui appelle transaction.commit()/.rollback()
    // (comme avec l'ancienne API mssql) : on relâche aussi le client vers le
    // pool à ce moment-là pour ne jamais fuir de connexion.
    transaction.commit   = async () => { await transaction.query('COMMIT');   transaction.release(); };
    transaction.rollback = async () => { await transaction.query('ROLLBACK'); transaction.release(); };

    // ────────────────────────────────────────────────────────────────────────
    // 5. Charger les lignes du panier (produits sur commande = pas de stock
    //    à verrouiller, on vérifie juste que le produit est actif)
    // ────────────────────────────────────────────────────────────────────────
    const rLignes = new SqlRequest(transaction);
    const lignesRes = await rLignes
      .input('panier_id', sql.UniqueIdentifier, panier_id)
      .query(`
        SELECT
          lp.id AS ligne_id, lp.produit_id, lp.variante_id, lp.quantite,
          lp.couleur, lp.couleur_hex, lp.taille, lp.date_evenement, lp.mesures,
          p.nom AS produit_nom, p.prix, p.prix_solde, p.actif AS produit_actif,
          p.type_produit
        FROM lignes_panier lp
        INNER JOIN produits p ON p.id = lp.produit_id
        WHERE lp.panier_id = @panier_id
      `);

    const lignesPanier = lignesRes.recordset;
    if (lignesPanier.length === 0) {
      await transaction.rollback();
      transaction = null;
      return res.status(400).json({ message: 'Votre panier est vide.' });
    }

    // Verrouiller (FOR UPDATE) les variantes concernées par une requête séparée.
    // PostgreSQL interdit de verrouiller le côté "nullable" d'un LEFT JOIN
    // (contrairement au WITH (UPDLOCK, HOLDLOCK) de SQL Server sur la jointure
    // directe) — on charge donc les variantes à part, verrouillées par leur id,
    // puis on fusionne le résultat dans chaque ligne du panier ci-dessous.
    const varianteIds = [...new Set(lignesPanier.filter(l => l.variante_id).map(l => l.variante_id))];
    const variantesParId = {};
    if (varianteIds.length > 0) {
      const rVariantes = new SqlRequest(transaction);
      // MySQL n'a pas de type tableau / opérateur ANY() : on construit une
      // clause IN (@id0, @id1, ...) avec un paramètre nommé par id.
      const nomsParams = varianteIds.map((vid, i) => {
        const nom = `varianteId${i}`;
        rVariantes.input(nom, sql.UniqueIdentifier, vid);
        return `@${nom}`;
      });
      const variantesRes = await rVariantes
        .query(`
          SELECT id, stock, actif, prix_supplement, sku, stock_alerte
          FROM variantes
          WHERE id IN (${nomsParams.join(', ')})
          FOR UPDATE
        `);
      for (const v of variantesRes.recordset) variantesParId[v.id] = v;
    }
    for (const l of lignesPanier) {
      if (l.variante_id) {
        const v = variantesParId[l.variante_id];
        l.variante_stock  = v ? v.stock : null;
        l.variante_actif  = v ? v.actif : false;
        l.prix_supplement = v ? v.prix_supplement : 0;
        l.variante_sku    = v ? v.sku : null;
        l.stock_alerte    = v ? v.stock_alerte : 5;
      }
    }

    // 6. Vérifier que tous les produits sont encore actifs, et que le stock
    //    est suffisant pour les lignes liées à une variante (produits "stock").
    //    Les variantes concernées ont déjà été verrouillées ci-dessus (FOR
    //    UPDATE) : aucune autre transaction concurrente ne peut modifier ce
    //    stock tant que celle-ci n'est pas terminée.
    for (const l of lignesPanier) {
      if (!l.produit_actif) {
        await transaction.rollback();
        transaction = null;
        return res.status(409).json({ message: `"${l.produit_nom}" n'est plus disponible.` });
      }
      if (l.variante_id) {
        if (!l.variante_actif) {
          await transaction.rollback();
          transaction = null;
          return res.status(409).json({ message: `"${l.produit_nom}" (${l.taille || ''} ${l.couleur || ''}) n'est plus disponible.` });
        }
        if (l.variante_stock < l.quantite) {
          await transaction.rollback();
          transaction = null;
          return res.status(409).json({
            message: `Stock insuffisant pour "${l.produit_nom}" (${l.taille || ''} ${l.couleur || ''}). Il reste ${l.variante_stock} unité(s).`,
            stock_disponible: l.variante_stock,
          });
        }
      }
    }

    // 6bis. [Désactivé] La restriction "pas de paiement à la livraison pour
    //       les produits sur mesure" n'a plus lieu d'être : il n'y a plus de
    //       paiement en ligne proposé sur le site. Chaque commande est
    //       enregistrée telle quelle, puis la boutique contacte le client
    //       sur WhatsApp pour convenir du mode de paiement.

    // 7. Calculer le sous-total (prix soldé si présent + supplément de variante)
    let sous_total = 0;
    const lignesCalculees = lignesPanier.map(l => {
      const prixBase = (l.prix_solde !== null && l.prix_solde !== undefined) ? l.prix_solde : l.prix;
      const supplement = l.variante_id ? parseFloat(l.prix_supplement || 0) : 0;
      const prix_unitaire = parseFloat(prixBase) + supplement;
      sous_total += prix_unitaire * l.quantite;
      return { ...l, prix_unitaire };
    });
    sous_total = Math.round(sous_total * 100) / 100;

    // 8. Appliquer le code promo avec incrémentation atomique du compteur
    let remise = 0;
    let code_promo_id = null;
    let livraisonGratuiteForcee = false;

    if (promoPreflight) {
      // Re-vérification dans la transaction (le code a pu être désactivé entre-temps)
      const rPromoLock = new SqlRequest(transaction);
      const promoLockRes = await rPromoLock
        .input('id', sql.UniqueIdentifier, promoPreflight.id)
        .query(`
          SELECT id, type_remise, valeur, montant_minimum,
                 utilisations_max, utilisations_count, actif
          FROM codes_promo
          WHERE id = @id
          FOR UPDATE
        `);

      if (promoLockRes.recordset.length === 0) {
        await transaction.rollback();
        transaction = null;
        return res.status(404).json({ message: 'Code promo introuvable.' });
      }

      const promo = promoLockRes.recordset[0];

      if (!promo.actif) {
        await transaction.rollback();
        transaction = null;
        return res.status(400).json({ message: 'Ce code promo n\'est plus actif.' });
      }
      if (promo.montant_minimum && sous_total < parseFloat(promo.montant_minimum)) {
        await transaction.rollback();
        transaction = null;
        return res.status(400).json({ message: `Un montant minimum de ${promo.montant_minimum} est requis pour ce code.` });
      }

      // ✅ Incrémentation atomique avec vérification de la limite dans le même UPDATE.
      // Si utilisations_max est défini et déjà atteint, rowsAffected = 0 → on rollback.
      const rIncr = new SqlRequest(transaction);
      const incrRes = await rIncr
        .input('id', sql.UniqueIdentifier, promo.id)
        .query(`
          UPDATE codes_promo
          SET utilisations_count = utilisations_count + 1
          WHERE id = @id
            AND actif = true
            AND (utilisations_max IS NULL OR utilisations_count < utilisations_max)
        `);

      if (incrRes.rowsAffected[0] !== 1) {
        await transaction.rollback();
        transaction = null;
        return res.status(400).json({ message: 'Ce code promo a atteint sa limite d\'utilisation.' });
      }

      code_promo_id = promo.id;
      if (promo.type_remise === 'pourcentage') {
        remise = sous_total * (parseFloat(promo.valeur) / 100);
      } else if (promo.type_remise === 'montant_fixe') {
        remise = Math.min(parseFloat(promo.valeur), sous_total);
      } else if (promo.type_remise === 'livraison_gratuite') {
        livraisonGratuiteForcee = true;
      }
      remise = Math.round(remise * 100) / 100;
    }

    // 9. Frais de livraison
    //    Algérie + wilaya renseignée → grille tarifaire Yalidine (par wilaya
    //    et selon domicile/stop-desk), éventuellement surchargée depuis le
    //    panneau admin (parametres_site.tarifs_livraison_json). Sinon
    //    (France, ou wilaya manquante sur une commande plus ancienne) →
    //    tarif fixe historique.
    //    Gratuite si : un code promo dédié le force, OU si la commande
    //    dépasse le seuil réglé dans Paramètres ET que l'option y est activée.
    const typeLivraisonNormalise = type_livraison === 'stopdesk' ? 'stopdesk' : 'domicile';

    const rParamsLivraison = new SqlRequest(transaction);
    const paramsLivraisonRes = await rParamsLivraison.query(`
      SELECT tarifs_livraison_json, livraison_gratuite_active, seuil_livraison_gratuite
      FROM parametres_site WHERE id = 1
    `);
    const paramsLivraison = paramsLivraisonRes.recordset[0] || {};
    const tarifsPersonnalisesJson = paramsLivraison.tarifs_livraison_json || null;
    const seuilLivraisonGratuite = (paramsLivraison.seuil_livraison_gratuite !== null && paramsLivraison.seuil_livraison_gratuite !== undefined)
      ? parseFloat(paramsLivraison.seuil_livraison_gratuite)
      : SEUIL_LIVRAISON_GRATUITE_DEFAUT;
    const livraisonGratuiteActive = paramsLivraison.livraison_gratuite_active !== undefined
      ? !!paramsLivraison.livraison_gratuite_active
      : true;

    const fraisLivraisonBase = (adresse.pays === 'Algérie' && wilaya_code)
      ? calculerFraisLivraison(wilaya_code, typeLivraisonNormalise, tarifsPersonnalisesJson)
      : FRAIS_LIVRAISON_DEFAUT;

    const seuilAtteint = livraisonGratuiteActive && (sous_total - remise) >= seuilLivraisonGratuite;
    const frais_livraison = (livraisonGratuiteForcee || seuilAtteint) ? 0 : fraisLivraisonBase;

    // 10. Total final
    const total = Math.max(0, Math.round((sous_total - remise + frais_livraison) * 100) / 100);

    // 11. Insérer la commande + les lignes + vider le panier
    const commande_id      = uuidv4();
    const adresse_snapshot = JSON.stringify({
      ...adresse,
      wilaya_code: (adresse.pays === 'Algérie' && wilaya_code) ? wilaya_code : undefined,
      type_livraison: (adresse.pays === 'Algérie' && wilaya_code) ? typeLivraisonNormalise : undefined,
    });

    // Le numéro de commande est généré par le trigger INSTEAD OF INSERT
    // trg_commande_numero — on ne le fournit donc pas ici.
    const reqCmd = new SqlRequest(transaction);
    await reqCmd
      .input('id',               sql.UniqueIdentifier, commande_id)
      .input('utilisateur_id',   sql.UniqueIdentifier, utilisateur_id || null)
      .input('adresse_id',       sql.UniqueIdentifier, utilisateur_id ? adresse_id : null)
      .input('code_promo_id',    sql.UniqueIdentifier, code_promo_id)
      .input('statut',           sql.NVarChar(20),     'en_attente')
      .input('sous_total',       sql.Decimal(10, 2),   sous_total)
      .input('remise',           sql.Decimal(10, 2),   remise)
      .input('frais_livraison',  sql.Decimal(10, 2),   frais_livraison)
      .input('total',            sql.Decimal(10, 2),   total)
      .input('note_client',      sql.NVarChar(sql.MAX), note_client)
      .input('adresse_snapshot', sql.NVarChar(sql.MAX), adresse_snapshot)
      .input('invite_email',     sql.NVarChar(255),    email_commande)
      .input('invite_telephone', sql.NVarChar(30),     telephone_commande)
      .query(`
        INSERT INTO commandes
          (id, utilisateur_id, adresse_id, code_promo_id, statut,
           sous_total, remise, frais_livraison, total, note_client, adresse_snapshot,
           invite_email, invite_telephone)
        VALUES
          (@id, @utilisateur_id, @adresse_id, @code_promo_id, @statut,
           @sous_total, @remise, @frais_livraison, @total, @note_client, @adresse_snapshot,
           @invite_email, @invite_telephone)
      `);

    for (const l of lignesCalculees) {
      // La date d'événement vient soit du body (override), soit de la ligne de panier
      const dateEvt = dates_evenement[l.ligne_id]
        ? new Date(dates_evenement[l.ligne_id])
        : (l.date_evenement ? new Date(l.date_evenement) : null);

      const reqLigne = new SqlRequest(transaction);
      await reqLigne
        .input('id',                 sql.UniqueIdentifier, uuidv4())
        .input('commande_id',        sql.UniqueIdentifier, commande_id)
        .input('produit_id',         sql.UniqueIdentifier, l.produit_id)
        .input('variante_id',        sql.UniqueIdentifier, l.variante_id || null)
        .input('quantite',           sql.Int,              l.quantite)
        .input('prix_unitaire',      sql.Decimal(10, 2),   l.prix_unitaire)
        .input('produit_nom',        sql.NVarChar(255),    l.produit_nom)
        .input('produit_sku',        sql.NVarChar(100),    l.variante_sku || null)
        .input('produit_taille',     sql.NVarChar(20),     l.taille  || null)
        .input('produit_couleur',    sql.NVarChar(50),     l.couleur || null)
        .input('produit_couleur_hex',sql.NVarChar(7),      l.couleur_hex || null)
        .input('date_evenement',     sql.Date,             dateEvt)
        .input('mesures',            sql.NVarChar(sql.MAX),l.mesures ? JSON.stringify(l.mesures) : null)
        .query(`
          INSERT INTO lignes_commande
            (id, commande_id, produit_id, variante_id, quantite, prix_unitaire,
             produit_nom, produit_sku, produit_taille, produit_couleur, produit_couleur_hex, date_evenement, mesures)
          VALUES
            (@id, @commande_id, @produit_id, @variante_id, @quantite, @prix_unitaire,
             @produit_nom, @produit_sku, @produit_taille, @produit_couleur, @produit_couleur_hex, @date_evenement, @mesures)
        `);

      // ── Produit "stock" : décrémenter le stock de la variante (déjà
      //    verrouillée et vérifiée suffisante à l'étape 6), journaliser le
      //    mouvement et notifier l'admin si on passe sous le seuil d'alerte.
      if (l.variante_id) {
        const reqDecr = new SqlRequest(transaction);
        await reqDecr
          .input('id',  sql.UniqueIdentifier, l.variante_id)
          .input('qte', sql.Int,              l.quantite)
          .query('UPDATE variantes SET stock = stock - @qte WHERE id = @id');

        const stockApres = l.variante_stock - l.quantite;

        const reqHist = new SqlRequest(transaction);
        await reqHist
          .input('id',           sql.UniqueIdentifier, uuidv4())
          .input('variante_id',  sql.UniqueIdentifier, l.variante_id)
          .input('commande_id',  sql.UniqueIdentifier, commande_id)
          .input('avant',        sql.Int,              l.variante_stock)
          .input('delta',        sql.Int,              -l.quantite)
          .input('apres',        sql.Int,              stockApres)
          .query(`
            INSERT INTO historique_stock
              (id, variante_id, commande_id, type_mouvement, quantite_avant, quantite_delta, quantite_apres, note)
            VALUES
              (@id, @variante_id, @commande_id, 'sortie_vente', @avant, @delta, @apres, 'Sortie automatique — nouvelle commande')
          `)
          .catch(() => {});

        if (stockApres <= (l.stock_alerte ?? 5)) {
          const reqNotif = new SqlRequest(transaction);
          await reqNotif
            .input('id',     sql.UniqueIdentifier, uuidv4())
            .input('titre',  sql.NVarChar(255),    `Stock bas : ${l.produit_nom} (${l.taille || ''} ${l.couleur || ''})`)
            .input('contenu',sql.NVarChar(sql.MAX), `Il reste ${stockApres} unité(s) en stock.`)
            .input('lien',   sql.NVarChar(500),    `/admin/produits/${l.produit_id}`)
            .query(`
              INSERT INTO notifications (id, utilisateur_id, type, titre, contenu, lien)
              VALUES (@id, NULL, 'stock_bas', @titre, @contenu, @lien)
            `)
            .catch(() => {});
        }
      }
    }

    const reqVide = new SqlRequest(transaction);
    await reqVide
      .input('panier_id', sql.UniqueIdentifier, panier_id)
      .query('DELETE FROM lignes_panier WHERE panier_id = @panier_id');

    await transaction.commit();
    transaction = null;

    // 12. Créer l'enregistrement de paiement initial (en attente)
    if (methode_paiement && total > 0) {
      const rPaiement = await getRequest();
      await rPaiement
        .input('id',          sql.UniqueIdentifier, uuidv4())
        .input('commande_id', sql.UniqueIdentifier, commande_id)
        .input('methode',     sql.NVarChar(50),     methode_paiement)
        .input('statut',      sql.NVarChar(20),     'en_attente')
        .input('montant',     sql.Decimal(10, 2),   total)
        .query(`
          INSERT INTO paiements (id, commande_id, methode, statut, montant)
          VALUES (@id, @commande_id, @methode, @statut, @montant)
        `);
    }

    // 13. Retourner la commande complète (numéro généré par le trigger)
    const rFinal = await getRequest();
    const finalRes = await rFinal
      .input('id', sql.UniqueIdentifier, commande_id)
      .query('SELECT * FROM commandes WHERE id = @id');

    const [lignes, paiements] = await Promise.all([
      chargerLignes(commande_id),
      chargerPaiements(commande_id),
    ]);

    const commandeFinale = { ...finalRes.recordset[0], lignes, paiements };

    // Envoyer la confirmation de commande en arrière-plan
    setImmediate(async () => {
      try {
        if (utilisateur_id) {
          const rUser = await getRequest();
          const userRes = await rUser
            .input('id', sql.UniqueIdentifier, utilisateur_id)
            .query('SELECT prenom, nom, email FROM utilisateurs WHERE id = @id');
          if (userRes.recordset.length > 0) {
            await envoyerConfirmationCommande(commandeFinale, userRes.recordset[0], lignes);
          }
        } else {
          // Commande invité : pas de ligne dans `utilisateurs`, on utilise les infos saisies au checkout.
          await envoyerConfirmationCommande(
            commandeFinale,
            { prenom: adresse.prenom, nom: adresse.nom, email: email_commande },
            lignes
          );
        }
      } catch (emailErr) {
        console.error('Erreur email confirmation commande:', emailErr);
      }
    });

    // Notifier l'admin par WhatsApp en arrière-plan (indépendant de l'email
    // client ci-dessus : un échec de l'un ne doit jamais bloquer l'autre).
    // Complète la notification interne déjà créée par le trigger SQL
    // trg_notif_nouvelle_commande (table `notifications`), qui elle
    // n'envoie rien réellement en dehors de la base.
    setImmediate(async () => {
      try {
        let clientInfo = { prenom: adresse.prenom, nom: adresse.nom };
        if (utilisateur_id) {
          const rUser2 = await getRequest();
          const userRes2 = await rUser2
            .input('id', sql.UniqueIdentifier, utilisateur_id)
            .query('SELECT prenom, nom FROM utilisateurs WHERE id = @id');
          clientInfo = userRes2.recordset[0] || clientInfo;
        }
        await envoyerNotificationNouvelleCommande(
          commandeFinale,
          clientInfo
        );
      } catch (whatsappErr) {
        console.error('Erreur notification WhatsApp nouvelle commande:', whatsappErr);
      }
    });

    // Notifier l'admin par e-mail en arrière-plan (indépendant des deux
    // notifications ci-dessus : un échec ici ne doit jamais bloquer la
    // création de commande ni les autres notifications).
    setImmediate(async () => {
      try {
        let clientInfoEmail = { prenom: adresse.prenom, nom: adresse.nom, email: email_commande, telephone: telephone_commande };
        if (utilisateur_id) {
          const rUser3 = await getRequest();
          const userRes3 = await rUser3
            .input('id', sql.UniqueIdentifier, utilisateur_id)
            .query('SELECT prenom, nom, email, telephone FROM utilisateurs WHERE id = @id');
          clientInfoEmail = userRes3.recordset[0] || clientInfoEmail;
        }
        await envoyerNotificationAdminNouvelleCommande(
          commandeFinale,
          clientInfoEmail,
          lignes
        );
      } catch (adminEmailErr) {
        console.error('Erreur email notification admin nouvelle commande:', adminEmailErr);
      }
    });

    return res.status(201).json({
      message: 'Commande créée avec succès.',
      commande: commandeFinale,
    });

  } catch (err) {
    if (transaction) {
      await transaction.rollback().catch(() => {});
    }
    console.error('creer commande error:', err);
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// PATCH /api/commandes/:id/statut  [admin]
// ══════════════════════════════════════════════════════════════════════════════
async function changerStatut(req, res) {
  let transaction;
  try {
    const { id } = req.params;
    const { statut: nouveauStatut } = req.body;

    const rExiste = await getRequest();
    const existe = await rExiste
      .input('id', sql.UniqueIdentifier, id)
      .query('SELECT id, statut FROM commandes WHERE id = @id');

    if (existe.recordset.length === 0) {
      return res.status(404).json({ message: 'Commande introuvable.' });
    }

    const statutActuel = existe.recordset[0].statut;
    const transitionsAutorisees = TRANSITIONS[statutActuel] || [];

    if (!transitionsAutorisees.includes(nouveauStatut)) {
      return res.status(400).json({
        message: `Transition invalide : "${statutActuel}" → "${nouveauStatut}".`,
        transitions_autorisees: transitionsAutorisees,
      });
    }

    transaction = await getClient();
    await transaction.query('BEGIN');
    transaction.commit   = async () => { await transaction.query('COMMIT');   transaction.release(); };
    transaction.rollback = async () => { await transaction.query('ROLLBACK'); transaction.release(); };

    const reqMaj = new SqlRequest(transaction);
    await reqMaj
      .input('id',     sql.UniqueIdentifier, id)
      .input('statut', sql.NVarChar(20),     nouveauStatut)
      .query('UPDATE commandes SET statut = @statut WHERE id = @id');

    // Si on annule une commande dont le stock avait déjà été décrémenté, on recrédite.
    if (nouveauStatut === 'annulee' && STATUTS_AVEC_STOCK_DECREMENTE.includes(statutActuel)) {
      await restockerLignes(id, () => new SqlRequest(transaction));
    }

    await transaction.commit();
    transaction = null;

    await journalAdmin.enregistrer(req, {
      action:    'commande.changement_statut',
      entite:    'commande',
      entite_id: id,
      details:   { avant: statutActuel, apres: nouveauStatut },
    });

    // Envoyer l'email de changement de statut en arrière-plan (si statut visible client)
    const STATUTS_EMAIL_CLIENT = ['confirmee', 'en_preparation', 'expediee', 'livree', 'annulee', 'remboursee'];
    if (STATUTS_EMAIL_CLIENT.includes(nouveauStatut)) {
      setImmediate(async () => {
        try {
          const rCmd = await getRequest();
          const cmdRes = await rCmd
            .input('id', sql.UniqueIdentifier, id)
            .query(`
              SELECT c.numero, c.total, c.methode_paiement, c.utilisateur_id,
                     u.prenom, u.email
              FROM commandes c
              INNER JOIN utilisateurs u ON u.id = c.utilisateur_id
              WHERE c.id = @id
            `);
          if (cmdRes.recordset.length > 0) {
            const row = cmdRes.recordset[0];
            await envoyerChangementStatut(
              { id, numero: row.numero, total: row.total, methode_paiement: row.methode_paiement },
              { prenom: row.prenom, email: row.email },
              nouveauStatut
            );
          }
        } catch (emailErr) {
          console.error('Erreur email changement statut:', emailErr);
        }
      });
    }

    return res.status(200).json({
      message: `Commande passée au statut "${nouveauStatut}".`,
      statut: nouveauStatut,
    });

  } catch (err) {
    if (transaction) await transaction.rollback().catch(() => {});
    console.error('changerStatut commande error:', err);
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/commandes/:id/annuler
// Annulation en self-service (client propriétaire) ou par un admin/modérateur.
// ══════════════════════════════════════════════════════════════════════════════
async function annuler(req, res) {
  let transaction;
  try {
    const { id } = req.params;
    const estAdmin = ['admin', 'moderateur'].includes(req.utilisateur.role);

    const rExiste = await getRequest();
    const existe = await rExiste
      .input('id', sql.UniqueIdentifier, id)
      .query('SELECT id, statut, utilisateur_id FROM commandes WHERE id = @id');

    if (existe.recordset.length === 0) {
      return res.status(404).json({ message: 'Commande introuvable.' });
    }

    const commande = existe.recordset[0];

    if (!estAdmin && commande.utilisateur_id !== req.utilisateur.sub) {
      return res.status(403).json({ message: 'Accès refusé à cette commande.' });
    }

    const statutsAnnulablesClient = ['en_attente', 'confirmee'];
    const statutsAnnulablesAdmin  = ['en_attente', 'confirmee', 'en_preparation', 'expediee'];
    const statutsAutorises = estAdmin ? statutsAnnulablesAdmin : statutsAnnulablesClient;

    if (!statutsAutorises.includes(commande.statut)) {
      return res.status(400).json({
        message: `Cette commande ne peut plus être annulée (statut actuel : "${commande.statut}").`,
      });
    }

    transaction = await getClient();
    await transaction.query('BEGIN');
    transaction.commit   = async () => { await transaction.query('COMMIT');   transaction.release(); };
    transaction.rollback = async () => { await transaction.query('ROLLBACK'); transaction.release(); };

    const reqMaj = new SqlRequest(transaction);
    await reqMaj
      .input('id', sql.UniqueIdentifier, id)
      .query("UPDATE commandes SET statut = 'annulee' WHERE id = @id");

    if (STATUTS_AVEC_STOCK_DECREMENTE.includes(commande.statut)) {
      await restockerLignes(id, () => new SqlRequest(transaction));
    }

    await transaction.commit();
    transaction = null;

    return res.status(200).json({ message: 'Commande annulée avec succès.' });

  } catch (err) {
    if (transaction) await transaction.rollback().catch(() => {});
    console.error('annuler commande error:', err);
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// ── PAIEMENTS ─────────────────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

// POST /api/commandes/:id/paiements  [admin]
//
// ✅ CORRECTION : validation du montant du paiement.
//    - Le montant saisi doit être > 0.
//    - Le montant saisi + la somme des paiements déjà réussis ne doit pas
//      dépasser le total de la commande (pas de sur-paiement).
//    - Le montant saisi doit correspondre au reste à payer (tolérance EPSILON)
//      pour éviter qu'un admin enregistre un paiement partiel de 1 DZD sur une
//      commande de 50 000 DZD et la marque comme "réussi".
async function ajouterPaiement(req, res) {
  try {
    const { id: commande_id } = req.params;
    const {
      methode,
      transaction_id = null,
      statut          = 'en_attente',
      montant,
      devise          = 'DZD',
    } = req.body;

    // ── Validation : methode + montant obligatoires ──────────────────────────
    if (!methode || montant === undefined || montant === null) {
      return res.status(400).json({ message: 'Les champs "methode" et "montant" sont obligatoires.' });
    }

    const montantSaisi = parseFloat(montant);
    if (Number.isNaN(montantSaisi) || montantSaisi <= 0) {
      return res.status(400).json({ message: 'Le montant du paiement doit être un nombre positif.' });
    }

    // ── Charger la commande (total + statut) ─────────────────────────────────
    const rExiste = await getRequest();
    const existe = await rExiste
      .input('id', sql.UniqueIdentifier, commande_id)
      .query('SELECT id, statut, total FROM commandes WHERE id = @id');

    if (existe.recordset.length === 0) {
      return res.status(404).json({ message: 'Commande introuvable.' });
    }
    const commande = existe.recordset[0];
    const totalCommande = parseFloat(commande.total);

    // ── Calculer le reste à payer = total − (somme des paiements réussis) ────
    const rDejaPaye = await getRequest();
    const dejaPayeRes = await rDejaPaye
      .input('commande_id', sql.UniqueIdentifier, commande_id)
      .query(`
        SELECT COALESCE(SUM(montant), 0) AS deja_paye
        FROM paiements
        WHERE commande_id = @commande_id AND statut = 'reussi'
      `);
    const dejaPaye = parseFloat(dejaPayeRes.recordset[0].deja_paye);
    const resteAPayer = Math.max(0, totalCommande - dejaPaye);

    // ── Validation : pas de sur-paiement ─────────────────────────────────────
    if (montantSaisi > resteAPayer + EPSILON_MONTANT) {
      return res.status(400).json({
        message: `Le montant du paiement (${montantSaisi} DZD) dépasse le reste à payer (${resteAPayer.toFixed(2)} DZD).`,
        total_commande: totalCommande,
        deja_paye: dejaPaye,
        reste_a_payer: resteAPayer,
      });
    }

    // ── Validation : pour un paiement "réussi", le montant doit couvrir le reste
    //    à payer (pas de paiement partiel marqué comme réussi).
    //    Les paiements partiels doivent rester en statut "en_attente".
    if (statut === 'reussi' && (resteAPayer - montantSaisi) > EPSILON_MONTANT) {
      return res.status(400).json({
        message: `Un paiement réussi doit couvrir l'intégralité du reste à payer (${resteAPayer.toFixed(2)} DZD). Montant saisi : ${montantSaisi} DZD.`,
        reste_a_payer: resteAPayer,
      });
    }

    // ── Insertion du paiement ────────────────────────────────────────────────
    const paiement_id = uuidv4();
    const r = await getRequest();
    await r
      .input('id',             sql.UniqueIdentifier, paiement_id)
      .input('commande_id',    sql.UniqueIdentifier, commande_id)
      .input('methode',        sql.NVarChar(50),     methode)
      .input('transaction_id', sql.NVarChar(255),    transaction_id)
      .input('statut',         sql.NVarChar(20),     statut)
      .input('montant',        sql.Decimal(10, 2),   montantSaisi)
      .input('devise',         sql.NChar(3),         devise)
      .query(`
        INSERT INTO paiements (id, commande_id, methode, transaction_id, statut, montant, devise)
        VALUES (@id, @commande_id, @methode, @transaction_id, @statut, @montant, @devise)
      `);

    // Un paiement réussi confirme automatiquement une commande en attente
    if (statut === 'reussi' && commande.statut === 'en_attente') {
      const rConfirm = await getRequest();
      await rConfirm
        .input('id', sql.UniqueIdentifier, commande_id)
        .query("UPDATE commandes SET statut = 'confirmee' WHERE id = @id");
    }

    return res.status(201).json({
      message: 'Paiement enregistré.',
      paiement: { id: paiement_id, commande_id, methode, transaction_id, statut, montant: montantSaisi, devise },
    });

  } catch (err) {
    console.error('ajouterPaiement error:', err);
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
}

// PATCH /api/commandes/:id/paiements/:paiementId  [admin]
//
// ✅ CORRECTION : lorsqu'un paiement passe à "réussi", on vérifie aussi que
//    la somme des paiements réussis ne dépasse pas le total de la commande.
async function modifierPaiement(req, res) {
  try {
    const { id: commande_id, paiementId } = req.params;
    const { statut, transaction_id, details } = req.body;

    const rExiste = await getRequest();
    const existe = await rExiste
      .input('id',          sql.UniqueIdentifier, paiementId)
      .input('commande_id', sql.UniqueIdentifier, commande_id)
      .query('SELECT id, montant, statut FROM paiements WHERE id = @id AND commande_id = @commande_id');

    if (existe.recordset.length === 0) {
      return res.status(404).json({ message: 'Paiement introuvable.' });
    }
    const paiementActuel = existe.recordset[0];

    // ── Validation : si on passe à "réussi", vérifier le total de la commande ─
    if (statut === 'reussi' && paiementActuel.statut !== 'reussi') {
      const rCmd = await getRequest();
      const cmdRes = await rCmd
        .input('id', sql.UniqueIdentifier, commande_id)
        .query('SELECT total FROM commandes WHERE id = @id');

      if (cmdRes.recordset.length === 0) {
        return res.status(404).json({ message: 'Commande introuvable.' });
      }
      const totalCommande = parseFloat(cmdRes.recordset[0].total);

      // Somme des AUTRES paiements réussis (hors celui qu'on modifie)
      const rAutres = await getRequest();
      const autresRes = await rAutres
        .input('commande_id', sql.UniqueIdentifier, commande_id)
        .input('paiement_id', sql.UniqueIdentifier, paiementId)
        .query(`
          SELECT COALESCE(SUM(montant), 0) AS autres_paye
          FROM paiements
          WHERE commande_id = @commande_id
            AND statut = 'reussi'
            AND id <> @paiement_id
        `);
      const autresPaye = parseFloat(autresRes.recordset[0].autres_paye);
      const nouveauTotalPaye = autresPaye + parseFloat(paiementActuel.montant);

      if (nouveauTotalPaye > totalCommande + EPSILON_MONTANT) {
        return res.status(400).json({
          message: `Impossible de marquer ce paiement comme réussi : la somme des paiements réussis (${nouveauTotalPaye.toFixed(2)} DZD) dépasserait le total de la commande (${totalCommande.toFixed(2)} DZD).`,
        });
      }
    }

    const champs = [];
    const r = await getRequest();

    if (statut         !== undefined) { champs.push('statut = @statut');                r.input('statut', sql.NVarChar(20), statut); }
    if (transaction_id !== undefined) { champs.push('transaction_id = @transaction_id'); r.input('transaction_id', sql.NVarChar(255), transaction_id); }
    if (details        !== undefined) { champs.push('details = @details');               r.input('details', sql.NVarChar(sql.MAX), typeof details === 'string' ? details : JSON.stringify(details)); }

    if (champs.length === 0) {
      return res.status(400).json({ message: 'Aucun champ à mettre à jour.' });
    }

    r.input('id', sql.UniqueIdentifier, paiementId);
    await r.query(`UPDATE paiements SET ${champs.join(', ')} WHERE id = @id`);

    // Un paiement qui passe à "reussi" confirme automatiquement une commande en attente
    if (statut === 'reussi') {
      const rCmd = await getRequest();
      const cmdRes = await rCmd
        .input('id', sql.UniqueIdentifier, commande_id)
        .query('SELECT statut FROM commandes WHERE id = @id');

      if (cmdRes.recordset[0]?.statut === 'en_attente') {
        const rConfirm = await getRequest();
        await rConfirm
          .input('id', sql.UniqueIdentifier, commande_id)
          .query("UPDATE commandes SET statut = 'confirmee' WHERE id = @id");
      }
    }

    return res.status(200).json({ message: 'Paiement mis à jour.' });

  } catch (err) {
    console.error('modifierPaiement error:', err);
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/commandes/dashboard  [admin]
// Chiffre d'affaires / commandes par jour (s'appuie sur la vue v_commandes_dashboard)
// ══════════════════════════════════════════════════════════════════════════════
async function dashboard(req, res) {
  try {
    const { date_debut = null, date_fin = null } = req.query;

    const r = await getRequest();
    let querySQL = 'SELECT * FROM v_commandes_dashboard WHERE 1=1';

    if (date_debut) { querySQL += ' AND jour >= @date_debut'; r.input('date_debut', sql.Date, date_debut); }
    if (date_fin)   { querySQL += ' AND jour <= @date_fin';   r.input('date_fin',   sql.Date, date_fin); }
    querySQL += ' ORDER BY jour DESC';

    const result = await r.query(querySQL);

    return res.status(200).json({ dashboard: result.recordset });

  } catch (err) {
    console.error('dashboard commandes error:', err);
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
}


// ══════════════════════════════════════════════════════════════════════════════
// GET /api/commandes/:id/facture
// Génère et renvoie la facture PDF d'une commande.
// Accessible au propriétaire de la commande ou à un admin.
// ══════════════════════════════════════════════════════════════════════════════
async function genererFacture(req, res) {
  try {
    const { id } = req.params;
    const utilisateurId = req.utilisateur.sub || req.utilisateur.id;
    const estAdmin      = ['admin', 'moderateur'].includes(req.utilisateur.role);

    // ── Charger la commande ───────────────────────────────────────────────────
    const r = await getRequest();
    const cmdRes = await r
      .input('id', sql.UniqueIdentifier, id)
      .query(`
        SELECT
          c.id, c.numero, c.statut, c.sous_total, c.remise, c.frais_livraison,
          c.total, c.methode_paiement, c.note_client, c.created_at,
          c.utilisateur_id, c.code_promo_id, c.adresse_snapshot, c.invite_email,
          u.prenom                                                       AS prenom,
          u.nom                                                          AS nom_client,
          COALESCE(u.email, c.invite_email)                             AS email,
          a.prenom                                                       AS adr_prenom,
          a.nom                                                          AS adr_nom,
          a.rue                                                          AS rue,
          a.complement                                                   AS complement,
          a.ville                                                        AS ville,
          a.pays                                                         AS pays,
          cp.code    AS code_promo_code
        FROM commandes c
        LEFT JOIN  utilisateurs u ON u.id = c.utilisateur_id
        LEFT JOIN  adresses     a ON a.id = c.adresse_id
        LEFT JOIN  codes_promo cp ON cp.id = c.code_promo_id
        WHERE c.id = @id
      `);

    if (cmdRes.recordset.length === 0) {
      return res.status(404).json({ message: 'Commande introuvable.' });
    }

    const cmd = cmdRes.recordset[0];
    // Repli invité depuis adresse_snapshot (JS plutôt que SQL ->>, voir lister()).
    {
      let snap = cmd.adresse_snapshot;
      if (typeof snap === 'string') {
        try { snap = JSON.parse(snap); } catch { snap = null; }
      }
      if (snap) {
        cmd.prenom     = cmd.prenom     || snap.prenom     || null;
        cmd.nom_client = cmd.nom_client || snap.nom         || null;
        cmd.adr_prenom = cmd.adr_prenom || snap.prenom      || null;
        cmd.adr_nom    = cmd.adr_nom    || snap.nom         || null;
        cmd.rue        = cmd.rue        || snap.rue         || null;
        cmd.complement = cmd.complement || snap.complement  || null;
        cmd.ville      = cmd.ville      || snap.ville       || null;
        cmd.pays       = cmd.pays       || snap.pays        || null;
      }
    }

    // Vérifier les droits d'accès
    if (!estAdmin && cmd.utilisateur_id !== utilisateurId) {
      return res.status(403).json({ message: 'Accès refusé à cette commande.' });
    }

    // Seules les commandes confirmées peuvent générer une facture
    const STATUTS_FACTURABLES = ['confirmee', 'en_preparation', 'expediee', 'livree', 'remboursee'];
    if (!STATUTS_FACTURABLES.includes(cmd.statut)) {
      return res.status(400).json({
        message: `La facture n'est disponible que pour les commandes confirmées (statut actuel : "${cmd.statut}").`,
      });
    }

    // ── Charger les lignes ────────────────────────────────────────────────────
    const lignes = await chargerLignes(id);

    // ── Générer le PDF ────────────────────────────────────────────────────────
    const doc = new PDFDocument({ margin: 50, size: 'A4' });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="facture-${cmd.numero}.pdf"`
    );
    doc.pipe(res);

    // Couleur principale
    const BRUN = '#8B4513';
    const GRIS = '#6b7280';

    // ── En-tête boutique ──────────────────────────────────────────────────────
    doc.fontSize(22).fillColor(BRUN).text(process.env.SHOP_NAME || 'Atelier S.L', 50, 50);
    doc.fontSize(10).fillColor(GRIS)
       .text((process.env.FRONTEND_URL || '').split(',')[0].replace(/^https?:\/\//, '').replace(/\/$/, ''), 50, 78)
       .text(process.env.CONTACT_EMAIL || '', 50, 91);

    // ── Titre FACTURE ─────────────────────────────────────────────────────────
    doc.fontSize(28).fillColor('#111827')
       .text('FACTURE', 350, 50, { align: 'right' });
    doc.fontSize(11).fillColor(GRIS)
       .text(`N° ${cmd.numero}`, 350, 85, { align: 'right' })
       .text(
         `Date : ${new Date(cmd.created_at).toLocaleDateString('fr-DZ', {
           day: '2-digit', month: 'long', year: 'numeric',
         })}`,
         350, 100, { align: 'right' }
       );

    // ── Ligne séparatrice ─────────────────────────────────────────────────────
    doc.moveTo(50, 130).lineTo(545, 130).strokeColor(BRUN).lineWidth(2).stroke();

    // ── Infos client ──────────────────────────────────────────────────────────
    doc.fontSize(10).fillColor('#111827');
    doc.text('FACTURÉ À', 50, 150).moveDown(0.3);
    doc.fillColor(GRIS)
       .text(`${cmd.adr_prenom || cmd.prenom} ${cmd.adr_nom || cmd.nom_client}`)
       .text(cmd.rue || '')
       .text(cmd.complement || '', { continued: false });
    if (cmd.complement) doc.moveUp();
    doc.text(`${cmd.ville || ''}`.trim())
       .text(cmd.pays || '')
       .text(cmd.email);

    // ── Tableau des lignes ────────────────────────────────────────────────────
    const tableTop    = 280;
    const colArticle  = 50;
    const colQte      = 320;
    const colPU       = 380;
    const colTotal    = 460;

    // En-tête du tableau
    doc.rect(50, tableTop - 5, 495, 22).fill('#f3f4f6');
    doc.fontSize(10).fillColor('#374151')
       .text('Article',    colArticle, tableTop, { width: 260 })
       .text('Qté',        colQte,     tableTop, { width: 50, align: 'center' })
       .text('Prix unit.',  colPU,      tableTop, { width: 70, align: 'right' })
       .text('Total',       colTotal,   tableTop, { width: 85, align: 'right' });

    doc.moveTo(50, tableTop + 18).lineTo(545, tableTop + 18)
       .strokeColor('#e5e7eb').lineWidth(1).stroke();

    // Lignes du tableau
    let y = tableTop + 28;
    for (const ligne of lignes) {
      const detail = [ligne.produit_taille, ligne.produit_couleur].filter(Boolean).join(' / ');
      const nom    = ligne.produit_nom + (detail ? `
  ${detail}` : '');
      const hLigne = detail ? 30 : 18;

      doc.fontSize(10).fillColor('#111827')
         .text(nom,                              colArticle, y, { width: 260 })
         .text(String(ligne.quantite),           colQte,     y, { width: 50,  align: 'center' })
         .text(fmtMontant(ligne.prix_unitaire),  colPU,      y, { width: 70,  align: 'right' })
         .text(fmtMontant(ligne.sous_total_ligne || ligne.prix_unitaire * ligne.quantite),
                                                 colTotal,   y, { width: 85,  align: 'right' });

      y += hLigne;
      doc.moveTo(50, y - 2).lineTo(545, y - 2)
         .strokeColor('#f3f4f6').lineWidth(0.5).stroke();

      // Saut de page si nécessaire
      if (y > 700) {
        doc.addPage();
        y = 60;
      }
    }

    // ── Récapitulatif des montants ────────────────────────────────────────────
    y += 20;
    const xLabel = 350;
    const xVal   = 460;
    const largeur = 85;

    function ligneRecap(label, valeur, gras = false, couleur = '#374151') {
      doc.fontSize(10)
         .fillColor(GRIS).text(label, xLabel, y, { width: 100 })
         .fillColor(couleur).font(gras ? 'Helvetica-Bold' : 'Helvetica')
         .text(valeur, xVal, y, { width: largeur, align: 'right' });
      y += 18;
    }

    doc.font('Helvetica');
    ligneRecap('Sous-total HT', fmtMontant(cmd.sous_total));
    if (parseFloat(cmd.remise || 0) > 0) {
      ligneRecap(
        `Remise${cmd.code_promo_code ? ' (' + cmd.code_promo_code + ')' : ''}`,
        '−' + fmtMontant(cmd.remise),
        false, '#059669'
      );
    }
    ligneRecap(
      'Livraison',
      parseFloat(cmd.frais_livraison || 0) === 0 ? 'Offerte' : fmtMontant(cmd.frais_livraison)
    );

    // Ligne total
    y += 4;
    doc.moveTo(350, y).lineTo(545, y).strokeColor(BRUN).lineWidth(1.5).stroke();
    y += 8;
    doc.font('Helvetica-Bold').fontSize(12)
       .fillColor('#111827').text('TOTAL', xLabel, y, { width: 100 })
       .fillColor(BRUN).text(fmtMontant(cmd.total) + ' DZD', xVal, y, { width: largeur, align: 'right' });

    // ── Pied de page ──────────────────────────────────────────────────────────
    doc.font('Helvetica').fontSize(9).fillColor(GRIS)
       .text(
         'Merci pour votre achat ! Pour toute question, contactez-nous en mentionnant le numéro de commande.',
         50, 780, { align: 'center', width: 495 }
       );

    doc.end();

  } catch (err) {
    console.error('genererFacture error:', err);
    // Si les headers n'ont pas encore été envoyés, renvoyer une erreur JSON
    if (!res.headersSent) {
      return res.status(500).json({ message: 'Erreur lors de la génération de la facture.' });
    }
  }
}

function fmtMontant(val) {
  return Number(val || 0).toLocaleString('fr-DZ', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }) + ' DZD';
}

module.exports = {
  lister,
  obtenir,
  creer,
  changerStatut,
  annuler,
  ajouterPaiement,
  modifierPaiement,
  dashboard,
  genererFacture,
};