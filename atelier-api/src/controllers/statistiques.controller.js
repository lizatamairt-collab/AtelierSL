// src/controllers/statistiques.controller.js
const { sql, getRequest } = require('../config/db');

// ══════════════════════════════════════════════════════════════════════════════
// HELPER — plage de dates par défaut : 30 derniers jours
// ══════════════════════════════════════════════════════════════════════════════
function plageParDefaut(date_debut, date_fin) {
  const fin   = date_fin   ? new Date(date_fin)   : new Date();
  const debut = date_debut ? new Date(date_debut) : new Date(fin.getTime() - 30 * 24 * 60 * 60 * 1000);
  return { debut, fin };
}

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/statistiques/resume  [admin]
// Carte de bord principale : chiffres clés sur la période sélectionnée
// + comparaison avec la période précédente de même durée.
// ══════════════════════════════════════════════════════════════════════════════
async function resume(req, res) {
  try {
    const { date_debut, date_fin } = req.query;
    const { debut, fin } = plageParDefaut(date_debut, date_fin);

    // Période précédente de même durée (pour calcul du delta %)
    const dureeMs    = fin.getTime() - debut.getTime();
    const debutPrec  = new Date(debut.getTime() - dureeMs);
    const finPrec    = new Date(debut.getTime() - 1);

    const r = await getRequest();
    r.input('debut',     sql.DateTime2, debut);
    r.input('fin',       sql.DateTime2, fin);
    r.input('debutPrec', sql.DateTime2, debutPrec);
    r.input('finPrec',   sql.DateTime2, finPrec);

    const result = await r.query(`
      -- ── Période courante ─────────────────────────────────────────────────
      SELECT
        -- Commandes
        (SELECT COUNT(*)       FROM commandes WHERE statut NOT IN ('annulee','remboursee') AND created_at BETWEEN @debut AND @fin) AS nb_commandes,
        (SELECT COALESCE(SUM(total), 0) FROM commandes WHERE statut NOT IN ('annulee','remboursee') AND created_at BETWEEN @debut AND @fin) AS chiffre_affaires,
        (SELECT COALESCE(AVG(total), 0) FROM commandes WHERE statut NOT IN ('annulee','remboursee') AND created_at BETWEEN @debut AND @fin) AS panier_moyen,
        (SELECT COUNT(*)       FROM commandes WHERE statut = 'annulee' AND created_at BETWEEN @debut AND @fin) AS nb_annulations,

        -- Nouveaux comptes
        (SELECT COUNT(*) FROM utilisateurs WHERE role = 'client' AND created_at BETWEEN @debut AND @fin) AS nouveaux_clients,

        -- Avis
        (SELECT COUNT(*) FROM avis WHERE created_at BETWEEN @debut AND @fin) AS nb_avis,

        -- Stock faible (toutes périodes)
        (SELECT COUNT(*) FROM variantes WHERE actif = true AND stock <= 5)  AS variantes_stock_faible,
        (SELECT COUNT(*) FROM variantes WHERE actif = true AND stock  = 0)  AS variantes_rupture,

        -- Totaux globaux
        (SELECT COUNT(*) FROM utilisateurs WHERE role = 'client') AS total_clients,
        (SELECT COUNT(*) FROM produits    WHERE actif = true)     AS total_produits_actifs,

        -- ── Période précédente (pour delta) ──────────────────────────────
        (SELECT COUNT(*)       FROM commandes WHERE statut NOT IN ('annulee','remboursee') AND created_at BETWEEN @debutPrec AND @finPrec) AS nb_commandes_prec,
        (SELECT COALESCE(SUM(total), 0) FROM commandes WHERE statut NOT IN ('annulee','remboursee') AND created_at BETWEEN @debutPrec AND @finPrec) AS chiffre_affaires_prec,
        (SELECT COUNT(*) FROM utilisateurs WHERE role = 'client' AND created_at BETWEEN @debutPrec AND @finPrec) AS nouveaux_clients_prec
    `);

    const d = result.recordset[0];

    // Calcul des variations en %
    const delta = (courant, precedent) =>
      precedent === 0 ? null : Math.round(((courant - precedent) / precedent) * 100 * 10) / 10;

    return res.status(200).json({
      periode: { debut, fin },
      resume: {
        nb_commandes:          d.nb_commandes,
        chiffre_affaires:      parseFloat(d.chiffre_affaires),
        panier_moyen:          parseFloat(d.panier_moyen),
        nb_annulations:        d.nb_annulations,
        taux_annulation:       d.nb_commandes + d.nb_annulations > 0
          ? Math.round((d.nb_annulations / (d.nb_commandes + d.nb_annulations)) * 100 * 10) / 10
          : 0,
        nouveaux_clients:      d.nouveaux_clients,
        nb_avis:               d.nb_avis,
        variantes_stock_faible: d.variantes_stock_faible,
        variantes_rupture:     d.variantes_rupture,
        total_clients:         d.total_clients,
        total_produits_actifs: d.total_produits_actifs,
      },
      variations: {
        nb_commandes:     delta(d.nb_commandes,     d.nb_commandes_prec),
        chiffre_affaires: delta(d.chiffre_affaires, d.chiffre_affaires_prec),
        nouveaux_clients: delta(d.nouveaux_clients, d.nouveaux_clients_prec),
      },
    });

  } catch (err) {
    console.error('statistiques resume error:', err);
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/statistiques/ventes  [admin]
// Chiffre d'affaires + nb commandes par jour/semaine/mois sur la période.
// ══════════════════════════════════════════════════════════════════════════════
async function ventes(req, res) {
  try {
    const { date_debut, date_fin, grouper = 'jour' } = req.query;
    const { debut, fin } = plageParDefaut(date_debut, date_fin);

    const groupesValides = ['jour', 'semaine', 'mois'];
    const groupe = groupesValides.includes(grouper) ? grouper : 'jour';

    // Expression de regroupement MySQL selon la granularité.
    // NB : WEEKDAY(created_at) vaut 0 pour lundi → DATE_SUB ramène chaque date
    // au lundi de sa semaine (semaine ISO, comme date_trunc('week', ...) sous
    // PostgreSQL). Différence mineure sans impact métier.
    const exprGroupe = {
      jour:    `DATE(created_at)`,
      semaine: `DATE_SUB(DATE(created_at), INTERVAL WEEKDAY(created_at) DAY)`,
      mois:    `DATE_FORMAT(created_at, '%Y-%m-01')`,
    }[groupe];

    const r = await getRequest();
    r.input('debut', sql.DateTime2, debut);
    r.input('fin',   sql.DateTime2, fin);

    const result = await r.query(`
      SELECT
        ${exprGroupe}                              AS periode,
        COUNT(*)                                   AS nb_commandes,
        COALESCE(SUM(total), 0)                      AS chiffre_affaires,
        COALESCE(AVG(total), 0)                      AS panier_moyen,
        COUNT(CASE WHEN statut = 'annulee' THEN 1 END) AS nb_annulations
      FROM commandes
      WHERE created_at BETWEEN @debut AND @fin
      GROUP BY ${exprGroupe}
      ORDER BY periode ASC
    `);

    return res.status(200).json({
      periode: { debut, fin, grouper: groupe },
      ventes:  result.recordset,
    });

  } catch (err) {
    console.error('statistiques ventes error:', err);
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/statistiques/produits  [admin]
// Top produits vendus (quantité + CA) et produits sans ventes sur la période.
// ══════════════════════════════════════════════════════════════════════════════
async function produits(req, res) {
  try {
    const { date_debut, date_fin, limite = 10 } = req.query;
    const { debut, fin } = plageParDefaut(date_debut, date_fin);
    const nbLigne = Math.min(50, Math.max(1, parseInt(limite)));

    const r = await getRequest();
    r.input('debut',   sql.DateTime2, debut);
    r.input('fin',     sql.DateTime2, fin);
    r.input('nbLigne', sql.Int,       nbLigne);

    // Top produits par quantité vendue
    const topProduits = await r.query(`
      SELECT
        v.produit_id,
        lc.produit_nom,
        SUM(lc.quantite)                       AS quantite_vendue,
        SUM(lc.quantite * lc.prix_unitaire)    AS chiffre_affaires,
        AVG(lc.prix_unitaire)                  AS prix_moyen,
        COUNT(DISTINCT c.id)                   AS nb_commandes,
        ROUND(AVG(a.note), 1)   AS note_moyenne
      FROM lignes_commande lc
      INNER JOIN commandes c  ON c.id  = lc.commande_id
      INNER JOIN variantes v  ON v.id  = lc.variante_id
      LEFT  JOIN avis      a  ON a.produit_id = v.produit_id AND a.approuve = true
      WHERE c.statut NOT IN ('annulee', 'remboursee')
        AND c.created_at BETWEEN @debut AND @fin
      GROUP BY v.produit_id, lc.produit_nom
      ORDER BY quantite_vendue DESC
      LIMIT @nbLigne
    `);

    // Répartition des ventes par catégorie
    const rCat = await getRequest();
    rCat.input('debut', sql.DateTime2, debut);
    rCat.input('fin',   sql.DateTime2, fin);

    const parCategorie = await rCat.query(`
      SELECT
        COALESCE(cat.nom, 'Sans catégorie') AS categorie,
        SUM(lc.quantite)                  AS quantite_vendue,
        SUM(lc.quantite * lc.prix_unitaire) AS chiffre_affaires
      FROM lignes_commande lc
      INNER JOIN commandes c  ON c.id  = lc.commande_id
      INNER JOIN variantes v  ON v.id  = lc.variante_id
      INNER JOIN produits  p  ON p.id  = v.produit_id
      LEFT  JOIN categories cat ON cat.id = p.categorie_id
      WHERE c.statut NOT IN ('annulee', 'remboursee')
        AND c.created_at BETWEEN @debut AND @fin
      GROUP BY cat.nom
      ORDER BY chiffre_affaires DESC
    `);

    // Stock critique (tous produits, hors période)
    const rStock = await getRequest();
    const stockCritique = await rStock.query(`
      SELECT
        p.id AS produit_id, p.nom AS produit_nom, p.slug,
        v.id AS variante_id, v.sku, v.taille, v.couleur, v.stock
      FROM variantes v
      INNER JOIN produits p ON p.id = v.produit_id
      WHERE v.actif = true AND p.actif = true AND v.stock <= 5
      ORDER BY v.stock ASC, p.nom ASC
      LIMIT 20
    `);

    return res.status(200).json({
      periode:       { debut, fin },
      top_produits:  topProduits.recordset,
      par_categorie: parCategorie.recordset,
      stock_critique: stockCritique.recordset,
    });

  } catch (err) {
    console.error('statistiques produits error:', err);
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/statistiques/clients  [admin]
// Nouveaux clients, répartition par rôle, top clients par CA.
// ══════════════════════════════════════════════════════════════════════════════
async function clients(req, res) {
  try {
    const { date_debut, date_fin, limite = 10 } = req.query;
    const { debut, fin } = plageParDefaut(date_debut, date_fin);
    const nbLigne = Math.min(50, Math.max(1, parseInt(limite)));

    // Nouveaux inscrits par jour sur la période
    const rInscrits = await getRequest();
    rInscrits.input('debut', sql.DateTime2, debut);
    rInscrits.input('fin',   sql.DateTime2, fin);

    const inscritsParJour = await rInscrits.query(`
      SELECT
        CAST(created_at AS DATE) AS jour,
        COUNT(*)                 AS nb_inscrits
      FROM utilisateurs
      WHERE role = 'client'
        AND created_at BETWEEN @debut AND @fin
      GROUP BY CAST(created_at AS DATE)
      ORDER BY jour ASC
    `);

    // Top clients par chiffre d'affaires sur la période
    const rTop = await getRequest();
    rTop.input('debut',   sql.DateTime2, debut);
    rTop.input('fin',     sql.DateTime2, fin);
    rTop.input('nbLigne', sql.Int,       nbLigne);

    const topClients = await rTop.query(`
      SELECT
        u.id, u.nom, u.prenom, u.email,
        COUNT(c.id)             AS nb_commandes,
        SUM(c.total)            AS chiffre_affaires,
        AVG(c.total)            AS panier_moyen,
        MAX(c.created_at)       AS derniere_commande
      FROM commandes c
      INNER JOIN utilisateurs u ON u.id = c.utilisateur_id
      WHERE c.statut NOT IN ('annulee', 'remboursee')
        AND c.created_at BETWEEN @debut AND @fin
      GROUP BY u.id, u.nom, u.prenom, u.email
      ORDER BY chiffre_affaires DESC
      LIMIT @nbLigne
    `);

    // Répartition par statut email vérifié
    const rRep = await getRequest();
    const repartition = await rRep.query(`
      SELECT
        email_verifie,
        COUNT(*) AS nb
      FROM utilisateurs
      WHERE role = 'client'
      GROUP BY email_verifie
    `);

    return res.status(200).json({
      periode:          { debut, fin },
      inscrits_par_jour: inscritsParJour.recordset,
      top_clients:      topClients.recordset,
      repartition_email: repartition.recordset,
    });

  } catch (err) {
    console.error('statistiques clients error:', err);
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/statistiques/commandes  [admin]
// Répartition des commandes par statut et par méthode de paiement.
// ══════════════════════════════════════════════════════════════════════════════
async function commandes(req, res) {
  try {
    const { date_debut, date_fin } = req.query;
    const { debut, fin } = plageParDefaut(date_debut, date_fin);

    const r = await getRequest();
    r.input('debut', sql.DateTime2, debut);
    r.input('fin',   sql.DateTime2, fin);

    // Répartition par statut
    const parStatut = await r.query(`
      SELECT
        statut,
        COUNT(*)          AS nb_commandes,
        COALESCE(SUM(total), 0) AS total_montant
      FROM commandes
      WHERE created_at BETWEEN @debut AND @fin
      GROUP BY statut
      ORDER BY nb_commandes DESC
    `);

    // Répartition par méthode de paiement
    const rPaie = await getRequest();
    rPaie.input('debut', sql.DateTime2, debut);
    rPaie.input('fin',   sql.DateTime2, fin);

    const parPaiement = await rPaie.query(`
      SELECT
        p.methode,
        COUNT(DISTINCT c.id)          AS nb_commandes,
        COALESCE(SUM(c.total), 0)       AS chiffre_affaires
      FROM commandes c
      INNER JOIN paiements p ON p.commande_id = c.id
      WHERE c.statut NOT IN ('annulee', 'remboursee')
        AND c.created_at BETWEEN @debut AND @fin
        AND p.statut = 'reussi'
      GROUP BY p.methode
      ORDER BY nb_commandes DESC
    `);

    // Utilisation des codes promo
    const rPromo = await getRequest();
    rPromo.input('debut', sql.DateTime2, debut);
    rPromo.input('fin',   sql.DateTime2, fin);

    const codesPromo = await rPromo.query(`
      SELECT
        cp.code,
        cp.type_remise,
        COUNT(c.id)             AS nb_utilisations,
        COALESCE(SUM(c.remise), 0) AS total_remises
      FROM commandes c
      INNER JOIN codes_promo cp ON cp.id = c.code_promo_id
      WHERE c.created_at BETWEEN @debut AND @fin
        AND c.statut NOT IN ('annulee', 'remboursee')
      GROUP BY cp.id, cp.code, cp.type_remise
      ORDER BY nb_utilisations DESC
    `);

    return res.status(200).json({
      periode:        { debut, fin },
      par_statut:     parStatut.recordset,
      par_paiement:   parPaiement.recordset,
      codes_promo:    codesPromo.recordset,
    });

  } catch (err) {
    console.error('statistiques commandes error:', err);
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
}

module.exports = {
  resume,
  ventes,
  produits,
  clients,
  commandes,
};