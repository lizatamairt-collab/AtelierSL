// src/controllers/favoris.controller.js
const { v4: uuidv4 } = require('uuid');
const { getPool } = require('../config/db');

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/favoris
// Retourne la liste des produits favoris de l'utilisateur connecté.
// ══════════════════════════════════════════════════════════════════════════════
async function lister(req, res) {
  try {
    const pool = await getPool();
    const utilisateurId = req.utilisateur.sub;

    const result = await pool.request()
      .input('utilisateur_id', utilisateurId)
      .query(`
        SELECT
          f.id            AS favori_id,
          f.created_at    AS ajoute_le,
          p.id            AS produit_id,
          p.nom,
          p.slug,
          p.prix,
          p.prix_solde,
          p.actif,
          c.nom           AS categorie,
          (
            SELECT url
            FROM images_produit ip
            WHERE ip.produit_id = p.id AND ip.principale = true
            LIMIT 1
          )               AS image_principale,
          COALESCE(SUM(v.stock), 0) AS stock_total,
          ROUND(AVG(a.note), 1) AS note_moyenne,
          COUNT(DISTINCT a.id) AS nb_avis
        FROM favoris f
        INNER JOIN produits p    ON p.id = f.produit_id
        LEFT JOIN  categories c  ON c.id = p.categorie_id
        LEFT JOIN  variantes v   ON v.produit_id = p.id AND v.actif = true
        LEFT JOIN  avis a        ON a.produit_id = p.id AND a.approuve = true
        WHERE f.utilisateur_id = @utilisateur_id
        GROUP BY
          f.id, f.created_at,
          p.id, p.nom, p.slug, p.prix, p.prix_solde, p.actif,
          c.nom
        ORDER BY f.created_at DESC
      `);

    return res.json({ favoris: result.recordset });

  } catch (err) {
    console.error('favoris lister error:', err);
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/favoris/:produitId
// Ajoute un produit aux favoris. Idempotent : si déjà présent, retourne 200.
// ══════════════════════════════════════════════════════════════════════════════
async function ajouter(req, res) {
  try {
    const pool = await getPool();
    const utilisateurId = req.utilisateur.sub;
    const { produitId } = req.params;

    // Vérifier que le produit existe
    const produit = await pool.request()
      .input('produit_id', produitId)
      .query(`SELECT id FROM produits WHERE id = @produit_id AND actif = true`);

    if (produit.recordset.length === 0) {
      return res.status(404).json({ message: 'Produit introuvable.' });
    }

    // Vérifier si déjà en favori
    const existant = await pool.request()
      .input('utilisateur_id', utilisateurId)
      .input('produit_id', produitId)
      .query(`
        SELECT id FROM favoris
        WHERE utilisateur_id = @utilisateur_id AND produit_id = @produit_id
      `);

    if (existant.recordset.length > 0) {
      return res.json({ message: 'Produit déjà dans vos favoris.', deja_present: true });
    }

    await pool.request()
      .input('id', uuidv4())
      .input('utilisateur_id', utilisateurId)
      .input('produit_id', produitId)
      .query(`
        INSERT INTO favoris (id, utilisateur_id, produit_id)
        VALUES (@id, @utilisateur_id, @produit_id)
      `);

    return res.status(201).json({ message: 'Produit ajouté aux favoris.' });

  } catch (err) {
    console.error('favoris ajouter error:', err);
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// DELETE /api/favoris/:produitId
// Supprime un produit des favoris.
// ══════════════════════════════════════════════════════════════════════════════
async function supprimer(req, res) {
  try {
    const pool = await getPool();
    const utilisateurId = req.utilisateur.sub;
    const { produitId } = req.params;

    const result = await pool.request()
      .input('utilisateur_id', utilisateurId)
      .input('produit_id', produitId)
      .query(`
        DELETE FROM favoris
        WHERE utilisateur_id = @utilisateur_id AND produit_id = @produit_id
      `);

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ message: 'Ce produit n\'est pas dans vos favoris.' });
    }

    return res.json({ message: 'Produit retiré des favoris.' });

  } catch (err) {
    console.error('favoris supprimer error:', err);
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/favoris/ids
// Retourne uniquement les IDs des produits favoris (pour le bouton cœur côté front).
// ══════════════════════════════════════════════════════════════════════════════
async function listerIds(req, res) {
  try {
    const pool = await getPool();
    const utilisateurId = req.utilisateur.sub;

    const result = await pool.request()
      .input('utilisateur_id', utilisateurId)
      .query(`
        SELECT produit_id
        FROM favoris
        WHERE utilisateur_id = @utilisateur_id
      `);

    return res.json({
      favoris_ids: result.recordset.map(r => r.produit_id),
    });

  } catch (err) {
    console.error('favoris listerIds error:', err);
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
}

module.exports = { lister, ajouter, supprimer, listerIds };