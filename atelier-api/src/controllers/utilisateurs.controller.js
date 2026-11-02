// src/controllers/utilisateurs.controller.js
const { sql, getRequest } = require('../config/db');
const journalAdmin = require('../utils/journalAdmin');

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/utilisateurs  [admin]
// ══════════════════════════════════════════════════════════════════════════════
async function lister(req, res) {
  try {
    const {
      page          = 1,
      limite        = 20,
      role          = '',
      recherche     = '',
      email_verifie = '',
      tri           = 'created_at',
      ordre         = 'DESC',
    } = req.query;

    const offset  = (Math.max(1, parseInt(page)) - 1) * Math.min(100, parseInt(limite));
    const nbLigne = Math.min(100, Math.max(1, parseInt(limite)));

    // Colonnes autorisées pour le tri (whitelist anti-injection)
    const colonnesTri = ['created_at', 'nom', 'prenom', 'email', 'role'];
    const colonneTri  = colonnesTri.includes(tri) ? tri : 'created_at';
    const ordreTri    = ['ASC', 'DESC'].includes(ordre.toUpperCase()) ? ordre.toUpperCase() : 'DESC';

    // ── Construction des filtres ──────────────────────────────────────────────
    const conditions = ['1=1'];
    const r = await getRequest();

    if (role) {
      conditions.push('u.role = @role');
      r.input('role', sql.NVarChar(20), role);
    }

    if (email_verifie === 'true' || email_verifie === 'false') {
      conditions.push('u.email_verifie = @email_verifie');
      r.input('email_verifie', sql.Bit, email_verifie === 'true');
    }

    if (recherche) {
      conditions.push('(u.nom LIKE @recherche OR u.prenom LIKE @recherche OR u.email LIKE @recherche)');
      r.input('recherche', sql.NVarChar(255), `%${recherche}%`);
    }

    const where = conditions.join(' AND ');

    // ── Requête principale ────────────────────────────────────────────────────
    r.input('offset',  sql.Int, offset);
    r.input('nbLigne', sql.Int, nbLigne);

    const querySQL = `
      SELECT
        u.id, u.nom, u.prenom, u.email, u.telephone, u.role,
        u.email_verifie, u.created_at, u.updated_at,
        (SELECT COUNT(*) FROM commandes c WHERE c.utilisateur_id = u.id) AS nb_commandes
      FROM utilisateurs u
      WHERE ${where}
      ORDER BY u.${colonneTri} ${ordreTri}
      LIMIT @nbLigne OFFSET @offset
    `;

    // ── Compte total ──────────────────────────────────────────────────────────
    const rCount = await getRequest();
    if (role) rCount.input('role', sql.NVarChar(20), role);
    if (email_verifie === 'true' || email_verifie === 'false') {
      rCount.input('email_verifie', sql.Bit, email_verifie === 'true');
    }
    if (recherche) rCount.input('recherche', sql.NVarChar(255), `%${recherche}%`);

    const countSQL = `SELECT COUNT(*) AS total FROM utilisateurs u WHERE ${where}`;

    const [utilisateurs, count] = await Promise.all([
      r.query(querySQL),
      rCount.query(countSQL),
    ]);

    const total = count.recordset[0].total;

    return res.status(200).json({
      utilisateurs: utilisateurs.recordset,
      pagination: {
        page:   parseInt(page),
        limite: nbLigne,
        total,
        pages:  Math.ceil(total / nbLigne),
      },
    });

  } catch (err) {
    console.error('lister utilisateurs error:', err);
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/utilisateurs/:id  [admin]
// ══════════════════════════════════════════════════════════════════════════════
async function obtenir(req, res) {
  try {
    const { id } = req.params;

    const r = await getRequest();
    const result = await r
      .input('id', sql.UniqueIdentifier, id)
      .query(`
        SELECT
          u.id, u.nom, u.prenom, u.email, u.telephone, u.role,
          u.email_verifie, u.created_at, u.updated_at,
          (SELECT COUNT(*) FROM commandes c WHERE c.utilisateur_id = u.id) AS nb_commandes,
          (
            SELECT COALESCE(SUM(c.total), 0)
            FROM commandes c
            WHERE c.utilisateur_id = u.id AND c.statut NOT IN ('annulee', 'remboursee')
          ) AS total_depense,
          (SELECT COUNT(*) FROM adresses a  WHERE a.utilisateur_id  = u.id) AS nb_adresses,
          (SELECT COUNT(*) FROM avis      av WHERE av.utilisateur_id = u.id) AS nb_avis
        FROM utilisateurs u
        WHERE u.id = @id
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ message: 'Utilisateur introuvable.' });
    }

    return res.status(200).json({ utilisateur: result.recordset[0] });

  } catch (err) {
    console.error('obtenir utilisateur error:', err);
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// PATCH /api/utilisateurs/:id  [admin]
// ══════════════════════════════════════════════════════════════════════════════
async function modifier(req, res) {
  try {
    const { id } = req.params;

    const rExiste = await getRequest();
    const existe = await rExiste
      .input('id', sql.UniqueIdentifier, id)
      .query('SELECT id, email, role FROM utilisateurs WHERE id = @id');

    if (existe.recordset.length === 0) {
      return res.status(404).json({ message: 'Utilisateur introuvable.' });
    }

    const { nom, prenom, telephone, email, role, email_verifie } = req.body;

    // Empêcher un admin de modifier son propre rôle (évite l'auto-verrouillage)
    if (role !== undefined && id === req.utilisateur.sub && role !== existe.recordset[0].role) {
      return res.status(400).json({ message: 'Vous ne pouvez pas modifier votre propre rôle.' });
    }

    // Si l'email change, vérifier qu'il n'est pas déjà utilisé par un autre compte
    let emailNormalise;
    if (email !== undefined) {
      emailNormalise = email.toLowerCase().trim();
      if (emailNormalise !== existe.recordset[0].email) {
        const rDup = await getRequest();
        const dup = await rDup
          .input('email', sql.NVarChar(255), emailNormalise)
          .query('SELECT id FROM utilisateurs WHERE email = @email');

        if (dup.recordset.length > 0) {
          return res.status(409).json({ message: 'Cet email est déjà utilisé par un autre compte.' });
        }
      }
    }

    // ── Construction du SET dynamique ─────────────────────────────────────────
    const champs = [];
    const r = await getRequest();

    if (nom            !== undefined) { champs.push('nom = @nom');                   r.input('nom', sql.NVarChar(100), nom.trim()); }
    if (prenom         !== undefined) { champs.push('prenom = @prenom');             r.input('prenom', sql.NVarChar(100), prenom.trim()); }
    if (telephone      !== undefined) { champs.push('telephone = @telephone');       r.input('telephone', sql.NVarChar(20), telephone || null); }
    if (emailNormalise !== undefined) { champs.push('email = @email');               r.input('email', sql.NVarChar(255), emailNormalise); }
    if (role           !== undefined) { champs.push('role = @role');                 r.input('role', sql.NVarChar(20), role); }
    if (email_verifie  !== undefined) { champs.push('email_verifie = @email_verifie'); r.input('email_verifie', sql.Bit, !!email_verifie); }

    if (champs.length === 0) {
      return res.status(400).json({ message: 'Aucun champ à mettre à jour.' });
    }

    r.input('id', sql.UniqueIdentifier, id);
    await r.query(`UPDATE utilisateurs SET ${champs.join(', ')} WHERE id = @id`);

    // ── Retourner l'utilisateur mis à jour ────────────────────────────────────
    const rResult = await getRequest();
    const result = await rResult
      .input('id', sql.UniqueIdentifier, id)
      .query(`
        SELECT id, nom, prenom, email, telephone, role, email_verifie, created_at, updated_at
        FROM utilisateurs
        WHERE id = @id
      `);

    // Le changement de rôle est irréversible depuis l'interface admin (voir
    // atelier-sl-admin.html) → toujours journalisé, avec l'ancien et le nouveau rôle.
    if (role !== undefined && role !== existe.recordset[0].role) {
      await journalAdmin.enregistrer(req, {
        action:    'utilisateur.role',
        entite:    'utilisateur',
        entite_id: id,
        details:   { avant: existe.recordset[0].role, apres: role, email: existe.recordset[0].email },
      });
    }

    return res.status(200).json({
      message: 'Utilisateur mis à jour.',
      utilisateur: result.recordset[0],
    });

  } catch (err) {
    console.error('modifier utilisateur error:', err);
    if (err.code === 'ER_DUP_ENTRY') { // violation de contrainte unique SQL Server (email)
      return res.status(409).json({ message: 'Cet email est déjà utilisé.' });
    }
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// DELETE /api/utilisateurs/:id  [admin]
// ══════════════════════════════════════════════════════════════════════════════
async function supprimer(req, res) {
  try {
    const { id } = req.params;

    if (id === req.utilisateur.sub) {
      return res.status(400).json({ message: 'Vous ne pouvez pas supprimer votre propre compte.' });
    }

    const rExiste = await getRequest();
    const existe = await rExiste
      .input('id', sql.UniqueIdentifier, id)
      .query('SELECT id FROM utilisateurs WHERE id = @id');

    if (existe.recordset.length === 0) {
      return res.status(404).json({ message: 'Utilisateur introuvable.' });
    }

    const r = await getRequest();
    await r
      .input('id', sql.UniqueIdentifier, id)
      .query('DELETE FROM utilisateurs WHERE id = @id');

    await journalAdmin.enregistrer(req, {
      action:    'utilisateur.supprimer',
      entite:    'utilisateur',
      entite_id: id,
    });

    return res.status(200).json({ message: 'Utilisateur supprimé.' });

  } catch (err) {
    console.error('supprimer utilisateur error:', err);
    // Violation de contrainte FK : des commandes/avis sont encore liés à ce compte
    // (commandes n'a pas de ON DELETE CASCADE vers utilisateurs)
    if (err.code === 'ER_ROW_IS_REFERENCED_2') {
      return res.status(409).json({
        message: 'Impossible de supprimer cet utilisateur : des commandes ou avis lui sont encore associés.',
      });
    }
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
}

module.exports = {
  lister,
  obtenir,
  modifier,
  supprimer,
};