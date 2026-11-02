// src/controllers/lookbook.controller.js
// Galerie lookbook — lecture publique, gestion admin complète.
// Converti pour MySQL (Hostinger) :
//   - RETURNING *                     →  INSERT/UPDATE puis SELECT (id généré en JS)
//   - GETDATE() / now()               →  NOW()
//   - visible = true / false          →  colonne tinyint(1), 1/0
//   - OFFSET...FETCH NEXT             →  LIMIT ... OFFSET ...
const { v4: uuidv4 } = require('uuid');
const { sql, getRequest } = require('../config/db');

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/lookbook
// Public — retourne uniquement les items visibles, triés par ordre puis date.
// ══════════════════════════════════════════════════════════════════════════════
async function lister(req, res) {
  try {
    const { tag = '', limite = 100 } = req.query;
    const nb = Math.min(200, Math.max(1, parseInt(limite) || 100));

    const r = await getRequest();
    let whereClause = 'WHERE visible = true';

    if (tag && tag !== 'tous') {
      whereClause += " AND tags LIKE @tag";
      r.input('tag', sql.NVarChar(255), `%${tag}%`);
    }

    r.input('nb', sql.Int, nb);

    const result = await r.query(`
      SELECT
        id, titre, description, image_url, tags, hauteur, ordre, visible, created_at
      FROM lookbook
      ${whereClause}
      ORDER BY ordre ASC, created_at DESC
      LIMIT @nb
    `);

    return res.json({ lookbook: result.recordset });
  } catch (err) {
    console.error('lookbook.lister :', err);
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/lookbook/admin
// Admin — retourne tous les items (visibles + masqués).
// ══════════════════════════════════════════════════════════════════════════════
async function listerAdmin(req, res) {
  try {
    const { page = 1, limite = 50, visible = '' } = req.query;
    const nb     = Math.min(100, Math.max(1, parseInt(limite) || 50));
    const offset = (Math.max(1, parseInt(page)) - 1) * nb;

    const r = await getRequest();
    let whereClause = 'WHERE 1=1';

    if (visible === '1' || visible === 'true')  { whereClause += ' AND visible = true'; }
    if (visible === '0' || visible === 'false') { whereClause += ' AND visible = false'; }

    r.input('nb',     sql.Int, nb);
    r.input('offset', sql.Int, offset);

    const result = await r.query(`
      SELECT id, titre, description, image_url, tags, hauteur, ordre, visible, created_at, updated_at
      FROM lookbook
      ${whereClause}
      ORDER BY ordre ASC, created_at DESC
      LIMIT @nb OFFSET @offset
    `);

    const total = await (await getRequest())
      .query(`SELECT COUNT(*) AS total FROM lookbook ${whereClause}`);

    return res.json({
      lookbook: result.recordset,
      total:    total.recordset[0].total,
      page:     parseInt(page),
      limite:   nb,
    });
  } catch (err) {
    console.error('lookbook.listerAdmin :', err);
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/lookbook
// Admin — créer un nouvel item.
// ══════════════════════════════════════════════════════════════════════════════
async function creer(req, res) {
  try {
    const { titre, description, image_url, tags, hauteur, ordre, visible } = req.body;

    if (!titre || !titre.trim()) {
      return res.status(400).json({ message: 'Le titre est obligatoire.' });
    }

    const id = uuidv4();
    const r = await getRequest();
    r.input('id',           sql.UniqueIdentifier, id);
    r.input('titre',       sql.NVarChar(255),  titre.trim());
    r.input('description', sql.NVarChar(sql.MAX), description ?? null);
    r.input('image_url',   sql.NVarChar(500),  image_url   ?? null);
    r.input('tags',        sql.NVarChar(255),  tags        ?? null);
    r.input('hauteur',     sql.Int,            hauteur     ?? null);
    r.input('ordre',       sql.Int,            ordre       ?? 0);
    r.input('visible',     sql.Bit,            visible !== undefined ? !!visible : true);

    await r.query(`
      INSERT INTO lookbook (id, titre, description, image_url, tags, hauteur, ordre, visible)
      VALUES (@id, @titre, @description, @image_url, @tags, @hauteur, @ordre, @visible)
    `);

    const nouveau = await (await getRequest())
      .input('id', sql.UniqueIdentifier, id)
      .query('SELECT * FROM lookbook WHERE id = @id');

    return res.status(201).json({ item: nouveau.recordset[0] });
  } catch (err) {
    console.error('lookbook.creer :', err);
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// PUT /api/lookbook/:id
// Admin — mettre à jour un item.
// ══════════════════════════════════════════════════════════════════════════════
async function modifier(req, res) {
  try {
    const { id } = req.params;
    const { titre, description, image_url, tags, hauteur, ordre, visible } = req.body;

    // Vérifier existence
    const check = await (await getRequest())
      .input('id', sql.UniqueIdentifier, id)
      .query('SELECT id FROM lookbook WHERE id = @id');

    if (!check.recordset.length) {
      return res.status(404).json({ message: 'Item introuvable.' });
    }

    const champs = [];
    const r = await getRequest();
    r.input('id', sql.UniqueIdentifier, id);

    if (titre       !== undefined) { champs.push('titre = @titre');             r.input('titre',       sql.NVarChar(255),      titre.trim()); }
    if (description !== undefined) { champs.push('description = @description'); r.input('description', sql.NVarChar(sql.MAX),  description); }
    if (image_url   !== undefined) { champs.push('image_url = @image_url');     r.input('image_url',   sql.NVarChar(500),      image_url); }
    if (tags        !== undefined) { champs.push('tags = @tags');               r.input('tags',        sql.NVarChar(255),      tags); }
    if (hauteur     !== undefined) { champs.push('hauteur = @hauteur');         r.input('hauteur',     sql.Int,                hauteur); }
    if (ordre       !== undefined) { champs.push('ordre = @ordre');             r.input('ordre',       sql.Int,                ordre); }
    if (visible     !== undefined) { champs.push('visible = @visible');         r.input('visible',     sql.Bit,                !!visible); }

    if (!champs.length) {
      return res.status(400).json({ message: 'Aucun champ à modifier.' });
    }

    champs.push('updated_at = NOW()');

    await r.query(`
      UPDATE lookbook
      SET ${champs.join(', ')}
      WHERE id = @id
    `);

    const maj = await (await getRequest())
      .input('id', sql.UniqueIdentifier, id)
      .query('SELECT * FROM lookbook WHERE id = @id');

    return res.json({ item: maj.recordset[0] });
  } catch (err) {
    console.error('lookbook.modifier :', err);
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// DELETE /api/lookbook/:id
// Admin — supprimer un item.
// ══════════════════════════════════════════════════════════════════════════════
async function supprimer(req, res) {
  try {
    const { id } = req.params;

    const check = await (await getRequest())
      .input('id', sql.UniqueIdentifier, id)
      .query('SELECT id FROM lookbook WHERE id = @id');

    if (!check.recordset.length) {
      return res.status(404).json({ message: 'Item introuvable.' });
    }

    const r = await getRequest();
    await r
      .input('id', sql.UniqueIdentifier, id)
      .query('DELETE FROM lookbook WHERE id = @id');

    return res.json({ message: 'Item supprimé.' });
  } catch (err) {
    console.error('lookbook.supprimer :', err);
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// PATCH /api/lookbook/reordonner
// Admin — réordonner plusieurs items en une requête.
// Body: { items: [{ id, ordre }, ...] }
// ══════════════════════════════════════════════════════════════════════════════
async function reordonner(req, res) {
  try {
    const { items } = req.body;
    if (!Array.isArray(items) || !items.length) {
      return res.status(400).json({ message: 'items[] est requis.' });
    }

    for (const item of items) {
      if (!item.id || item.ordre === undefined) continue;
      const r = await getRequest();
      await r
        .input('id',    sql.UniqueIdentifier, item.id)
        .input('ordre', sql.Int,              item.ordre)
        .query('UPDATE lookbook SET ordre = @ordre, updated_at = NOW() WHERE id = @id');
    }

    return res.json({ message: 'Ordre mis à jour.' });
  } catch (err) {
    console.error('lookbook.reordonner :', err);
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
}

module.exports = { lister, listerAdmin, creer, modifier, supprimer, reordonner };
