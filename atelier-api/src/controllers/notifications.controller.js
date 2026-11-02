// src/controllers/notifications.controller.js
const { getPool } = require('../config/db');

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/notifications
// Retourne les notifications de l'utilisateur connecté (ou globales si admin).
// ══════════════════════════════════════════════════════════════════════════════
async function lister(req, res) {
  try {
    const pool         = await getPool();
    const utilisateurId = req.utilisateur.sub || req.utilisateur.id;
    const estAdmin     = ['admin', 'moderateur'].includes(req.utilisateur.role);
    const page         = Math.max(1, parseInt(req.query.page) || 1);
    const limite       = Math.min(100, parseInt(req.query.limite) || 20);
    const offset       = (page - 1) * limite;
    const nonLueSeulem = req.query.non_lues === 'true';

    // Les admins voient les notifications globales (utilisateur_id IS NULL)
    // Les clients voient leurs notifications personnelles
    let whereClause;
    const request = pool.request()
      .input('utilisateur_id', utilisateurId)
      .input('limite', limite)
      .input('offset', offset);

    if (estAdmin) {
      whereClause = 'WHERE (utilisateur_id = @utilisateur_id OR utilisateur_id IS NULL)';
    } else {
      whereClause = 'WHERE utilisateur_id = @utilisateur_id';
    }

    if (nonLueSeulem) {
      whereClause += ' AND lue = false';
    }

    const [data, total, nbNonLues] = await Promise.all([
      request.query(`
        SELECT id, utilisateur_id, type, titre, contenu, lien, lue, created_at
        FROM notifications
        ${whereClause}
        ORDER BY created_at DESC
        LIMIT @limite OFFSET @offset
      `),
      pool.request()
        .input('uid2', utilisateurId)
        .query(`
          SELECT COUNT(*) AS total FROM notifications
          WHERE ${estAdmin ? '(utilisateur_id = @uid2 OR utilisateur_id IS NULL)' : 'utilisateur_id = @uid2'}
          ${nonLueSeulem ? 'AND lue = false' : ''}
        `),
      pool.request()
        .input('uid3', utilisateurId)
        .query(`
          SELECT COUNT(*) AS non_lues FROM notifications
          WHERE ${estAdmin ? '(utilisateur_id = @uid3 OR utilisateur_id IS NULL)' : 'utilisateur_id = @uid3'}
          AND lue = false
        `),
    ]);

    return res.json({
      notifications: data.recordset,
      total:         total.recordset[0].total,
      non_lues:      nbNonLues.recordset[0].non_lues,
      page,
      limite,
      pages:         Math.ceil(total.recordset[0].total / limite),
    });

  } catch (err) {
    console.error('notifications lister error:', err);
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// PATCH /api/notifications/:id/lue
// Marque une notification comme lue.
// ══════════════════════════════════════════════════════════════════════════════
async function marquerLue(req, res) {
  try {
    const pool          = await getPool();
    const utilisateurId = req.utilisateur.sub || req.utilisateur.id;
    const estAdmin      = ['admin', 'moderateur'].includes(req.utilisateur.role);
    const { id }        = req.params;

    const whereAcces = estAdmin
      ? '(utilisateur_id = @uid OR utilisateur_id IS NULL)'
      : 'utilisateur_id = @uid';

    const result = await pool.request()
      .input('id', id)
      .input('uid', utilisateurId)
      .query(`
        UPDATE notifications SET lue = true
        WHERE id = @id AND ${whereAcces}
      `);

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ message: 'Notification introuvable.' });
    }

    return res.json({ message: 'Notification marquée comme lue.' });

  } catch (err) {
    console.error('notifications marquerLue error:', err);
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// PATCH /api/notifications/lire-tout
// Marque toutes les notifications de l'utilisateur comme lues.
// ══════════════════════════════════════════════════════════════════════════════
async function marquerToutesLues(req, res) {
  try {
    const pool          = await getPool();
    const utilisateurId = req.utilisateur.sub || req.utilisateur.id;
    const estAdmin      = ['admin', 'moderateur'].includes(req.utilisateur.role);

    const whereAcces = estAdmin
      ? '(utilisateur_id = @uid OR utilisateur_id IS NULL)'
      : 'utilisateur_id = @uid';

    const result = await pool.request()
      .input('uid', utilisateurId)
      .query(`UPDATE notifications SET lue = true WHERE ${whereAcces} AND lue = false`);

    return res.json({
      message:  `${result.rowsAffected[0]} notification(s) marquée(s) comme lues.`,
      affectees: result.rowsAffected[0],
    });

  } catch (err) {
    console.error('notifications marquerToutesLues error:', err);
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// DELETE /api/notifications/:id
// Supprime une notification (admin peut supprimer les globales).
// ══════════════════════════════════════════════════════════════════════════════
async function supprimer(req, res) {
  try {
    const pool          = await getPool();
    const utilisateurId = req.utilisateur.sub || req.utilisateur.id;
    const estAdmin      = ['admin', 'moderateur'].includes(req.utilisateur.role);
    const { id }        = req.params;

    const whereAcces = estAdmin
      ? '(utilisateur_id = @uid OR utilisateur_id IS NULL)'
      : 'utilisateur_id = @uid';

    const result = await pool.request()
      .input('id', id)
      .input('uid', utilisateurId)
      .query(`DELETE FROM notifications WHERE id = @id AND ${whereAcces}`);

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ message: 'Notification introuvable.' });
    }

    return res.json({ message: 'Notification supprimée.' });

  } catch (err) {
    console.error('notifications supprimer error:', err);
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/notifications/compteur
// Retourne juste le nombre de notifications non lues (pour le badge).
// ══════════════════════════════════════════════════════════════════════════════
async function compteur(req, res) {
  try {
    const pool          = await getPool();
    const utilisateurId = req.utilisateur.sub || req.utilisateur.id;
    const estAdmin      = ['admin', 'moderateur'].includes(req.utilisateur.role);

    const whereAcces = estAdmin
      ? '(utilisateur_id = @uid OR utilisateur_id IS NULL)'
      : 'utilisateur_id = @uid';

    const result = await pool.request()
      .input('uid', utilisateurId)
      .query(`SELECT COUNT(*) AS non_lues FROM notifications WHERE ${whereAcces} AND lue = false`);

    return res.json({ non_lues: result.recordset[0].non_lues });

  } catch (err) {
    console.error('notifications compteur error:', err);
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
}

module.exports = { lister, marquerLue, marquerToutesLues, supprimer, compteur };
