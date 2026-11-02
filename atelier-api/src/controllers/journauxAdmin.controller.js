// src/controllers/journauxAdmin.controller.js
const { sql, getRequest } = require('../config/db');

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/journaux-admin  [admin]
// Liste paginée du journal d'audit (table journaux_admin), avec l'email de
// l'admin qui a effectué l'action, filtrable par entité.
// Consommé par atelier-sl-admin.html → renderJournaux() / exportCSV('journaux').
// ══════════════════════════════════════════════════════════════════════════════
async function lister(req, res) {
  try {
    const page   = Math.max(1, parseInt(req.query.page) || 1);
    const limite = Math.min(50, Math.max(1, parseInt(req.query.limite) || 20));
    const offset = (page - 1) * limite;
    const entite = (req.query.entite || '').trim();

    const where = entite ? 'WHERE j.entite = @entite' : '';

    const buildRequest = async () => {
      const r = await getRequest();
      r.input('limite', sql.Int, limite).input('offset', sql.Int, offset);
      if (entite) r.input('entite', sql.NVarChar(50), entite);
      return r;
    };

    const rListe = await buildRequest();
    const rCount = await getRequest();
    if (entite) rCount.input('entite', sql.NVarChar(50), entite);

    const [data, count] = await Promise.all([
      rListe.query(`
        SELECT
          j.id, j.admin_id, u.email AS admin_email,
          j.action, j.entite, j.entite_id, j.details,
          j.ip_address, j.user_agent, j.created_at
        FROM journaux_admin j
        LEFT JOIN utilisateurs u ON u.id = j.admin_id
        ${where}
        ORDER BY j.created_at DESC
        LIMIT @limite OFFSET @offset
      `),
      rCount.query(`SELECT COUNT(*) AS total FROM journaux_admin j ${where}`),
    ]);

    const total = count.recordset[0].total;

    return res.status(200).json({
      journaux: data.recordset,
      pagination: {
        page,
        limite,
        total,
        pages: Math.ceil(total / limite),
      },
    });

  } catch (err) {
    console.error('journauxAdmin lister error:', err);
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
}

module.exports = { lister };
