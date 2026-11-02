// src/controllers/newsletter.controller.js
const { v4: uuidv4 } = require('uuid');
const { getPool } = require('../config/db');
const crypto = require('crypto');

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/newsletter/abonner
// Inscrit un email à la newsletter. Accessible sans authentification.
// Si l'email existe mais était inactif, il est réactivé.
// ══════════════════════════════════════════════════════════════════════════════
async function abonner(req, res) {
  try {
    const pool = await getPool();
    const { email } = req.body;

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ message: 'Adresse email invalide.' });
    }

    const utilisateurId = req.utilisateur?.id ?? null;

    // Vérifier si l'email existe déjà
    const existant = await pool.request()
      .input('email', email)
      .query(`SELECT id, actif FROM newsletter_abonnements WHERE email = @email`);

    if (existant.recordset.length > 0) {
      const abonnement = existant.recordset[0];

      if (abonnement.actif) {
        return res.json({ message: 'Vous êtes déjà inscrit(e) à notre newsletter.', deja_inscrit: true });
      }

      // Réactivation d'un abonnement inactif
      await pool.request()
        .input('id', abonnement.id)
        .query(`
          UPDATE newsletter_abonnements
          SET actif = true, updated_at = now()
          WHERE id = @id
        `);

      return res.json({ message: 'Votre inscription a été réactivée avec succès.' });
    }

    // Générer un token de désinscription unique
    const tokenDesabo = crypto.randomBytes(32).toString('hex');

    await pool.request()
      .input('id', uuidv4())
      .input('email', email)
      .input('utilisateur_id', utilisateurId)
      .input('token_desabo', tokenDesabo)
      .query(`
        INSERT INTO newsletter_abonnements (id, email, utilisateur_id, token_desabo)
        VALUES (@id, @email, @utilisateur_id, @token_desabo)
      `);

    return res.status(201).json({
      message: 'Inscription à la newsletter confirmée. Merci !',
    });

  } catch (err) {
    console.error('newsletter abonner error:', err);
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/newsletter/desabonner?token=xxx
// Désinscrit un email via son token (lien dans les emails).
// ══════════════════════════════════════════════════════════════════════════════
async function desabonner(req, res) {
  try {
    const pool = await getPool();
    const { token } = req.query;

    if (!token) {
      return res.status(400).json({ message: 'Token de désinscription manquant.' });
    }

    const result = await pool.request()
      .input('token', token)
      .query(`
        UPDATE newsletter_abonnements
        SET actif = false, updated_at = now()
        WHERE token_desabo = @token AND actif = true
      `);

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ message: 'Token invalide ou déjà utilisé.' });
    }

    return res.json({ message: 'Vous avez été désinscrit(e) de la newsletter avec succès.' });

  } catch (err) {
    console.error('newsletter desabonner error:', err);
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/newsletter/abonnes  [Admin uniquement]
// Liste les abonnés avec pagination.
// ══════════════════════════════════════════════════════════════════════════════
async function listerAbonnes(req, res) {
  try {
    const pool = await getPool();
    const page    = Math.max(1, parseInt(req.query.page) || 1);
    const limite  = Math.min(100, parseInt(req.query.limite) || 50);
    const offset  = (page - 1) * limite;
    const actif   = req.query.actif !== undefined ? (req.query.actif === 'false' ? false : true) : null;

    let whereClause = '';
    const request = pool.request()
      .input('limite', limite)
      .input('offset', offset);

    if (actif !== null) {
      whereClause = 'WHERE actif = @actif';
      request.input('actif', actif);
    }

    const [data, total] = await Promise.all([
      request.query(`
        SELECT
          id, email, utilisateur_id, actif, created_at, updated_at
        FROM newsletter_abonnements
        ${whereClause}
        ORDER BY created_at DESC
        LIMIT @limite OFFSET @offset
      `),
      pool.request().input('actif2', actif).query(`
        SELECT COUNT(*) AS total
        FROM newsletter_abonnements
        ${actif !== null ? 'WHERE actif = @actif2' : ''}
      `),
    ]);

    return res.json({
      abonnes:    data.recordset,
      total:      total.recordset[0].total,
      page,
      limite,
      pages:      Math.ceil(total.recordset[0].total / limite),
    });

  } catch (err) {
    console.error('newsletter listerAbonnes error:', err);
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
}

module.exports = { abonner, desabonner, listerAbonnes };
