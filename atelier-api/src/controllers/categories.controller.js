// src/controllers/categories.controller.js
const { v4: uuidv4 } = require('uuid');
const { sql, getRequest } = require('../config/db');
const { slugifier } = require('../utils/slug');

// ══════════════════════════════════════════════════════════════════════════════
// HELPERS INTERNES
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Génère un slug unique, en ajoutant un suffixe si le slug existe déjà.
 */
async function slugUnique(nom, excludeId = null) {
  const base = slugifier(nom);
  let slug = base;
  let compteur = 1;

  while (true) {
    const req = await getRequest();
    req.input('slug', sql.NVarChar(120), slug);
    if (excludeId) req.input('excl', sql.UniqueIdentifier, excludeId);

    const res = await req.query(
      `SELECT id FROM categories WHERE slug = @slug${excludeId ? ' AND id <> @excl' : ''}`
    );
    if (res.recordset.length === 0) break;
    slug = `${base}-${compteur++}`;
  }
  return slug;
}

/**
 * Transforme une liste plate de catégories en arborescence (enfants imbriqués).
 */
function construireArbre(categories, parentId = null) {
  return categories
    .filter(c => (c.parent_id || null) === parentId)
    .map(c => ({
      ...c,
      enfants: construireArbre(categories, c.id),
    }));
}

/**
 * Vérifie si `candidatParentId` est un descendant de `categorieId`.
 * Sert à empêcher la création d'un cycle dans la hiérarchie lors d'un changement de parent.
 */
async function estDansLaDescendance(categorieId, candidatParentId) {
  let courantId = candidatParentId;
  const visites = new Set();

  while (courantId) {
    if (courantId === categorieId) return true;
    if (visites.has(courantId)) break; // sécurité anti-boucle infinie
    visites.add(courantId);

    const r = await getRequest();
    const res = await r
      .input('id', sql.UniqueIdentifier, courantId)
      .query('SELECT parent_id FROM categories WHERE id = @id');

    courantId = res.recordset[0]?.parent_id || null;
  }
  return false;
}

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/categories
// ══════════════════════════════════════════════════════════════════════════════
async function lister(req, res) {
  try {
    const {
      parent_id = '',      // UUID, 'racine' pour le 1er niveau, ou vide = toutes
      actif     = 'true',  // 'true' | 'false' | 'all' (admin)
      recherche = '',
      arbre     = 'false',
      tri       = 'ordre',
      ordre     = 'ASC',
    } = req.query;

    const conditions = ['1=1'];
    const r = await getRequest();

    // Visibilité selon rôle
    if (actif === 'all' && req.utilisateur?.role === 'admin') {
      // admin peut voir tout
    } else if (actif === 'false') {
      conditions.push('c.active = false');
    } else {
      conditions.push('c.active = true');
    }

    if (parent_id === 'racine') {
      conditions.push('c.parent_id IS NULL');
    } else if (parent_id) {
      conditions.push('c.parent_id = @parent_id');
      r.input('parent_id', sql.UniqueIdentifier, parent_id);
    }

    if (recherche) {
      conditions.push('c.nom LIKE @recherche');
      r.input('recherche', sql.NVarChar(255), `%${recherche}%`);
    }

    const colonnesTri = ['ordre', 'nom', 'created_at'];
    const colonneTri  = colonnesTri.includes(tri) ? tri : 'ordre';
    const ordreTri    = ['ASC', 'DESC'].includes(ordre.toUpperCase()) ? ordre.toUpperCase() : 'ASC';

    const where = conditions.join(' AND ');

    const querySQL = `
      SELECT
        c.id, c.parent_id, c.nom, c.slug, c.description, c.image_url,
        c.ordre, c.active, c.created_at,
        p.nom  AS parent_nom,
        p.slug AS parent_slug,
        (SELECT COUNT(*) FROM categories sc WHERE sc.parent_id = c.id)                      AS nb_sous_categories,
        (SELECT COUNT(*) FROM produits pr WHERE pr.categorie_id = c.id AND pr.actif = true)  AS nb_produits
      FROM categories c
      LEFT JOIN categories p ON p.id = c.parent_id
      WHERE ${where}
      ORDER BY c.${colonneTri} ${ordreTri}
    `;

    const result = await r.query(querySQL);
    const categories = result.recordset;

    if (arbre === 'true') {
      return res.status(200).json({ categories: construireArbre(categories) });
    }

    return res.status(200).json({ categories });

  } catch (err) {
    console.error('lister categories error:', err);
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/categories/:slug
// ══════════════════════════════════════════════════════════════════════════════
async function obtenir(req, res) {
  try {
    const { slug } = req.params;

    const r = await getRequest();
    const result = await r
      .input('slug', sql.NVarChar(120), slug)
      .query(`
        SELECT
          c.id, c.parent_id, c.nom, c.slug, c.description, c.image_url,
          c.ordre, c.active, c.created_at,
          p.nom  AS parent_nom,
          p.slug AS parent_slug,
          (SELECT COUNT(*) FROM produits pr WHERE pr.categorie_id = c.id AND pr.actif = true) AS nb_produits
        FROM categories c
        LEFT JOIN categories p ON p.id = c.parent_id
        WHERE c.slug = @slug
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ message: 'Catégorie introuvable.' });
    }

    const categorie = result.recordset[0];

    const rEnfants = await getRequest();
    const enfantsRes = await rEnfants
      .input('parent_id', sql.UniqueIdentifier, categorie.id)
      .query(`
        SELECT
          sc.id, sc.nom, sc.slug, sc.image_url, sc.ordre, sc.active,
          (SELECT COUNT(*) FROM produits pr WHERE pr.categorie_id = sc.id AND pr.actif = true) AS nb_produits
        FROM categories sc
        WHERE sc.parent_id = @parent_id
        ORDER BY sc.ordre ASC, sc.nom ASC
      `);

    return res.status(200).json({ ...categorie, sous_categories: enfantsRes.recordset });

  } catch (err) {
    console.error('obtenir categorie error:', err);
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/categories  [admin]
// ══════════════════════════════════════════════════════════════════════════════
async function creer(req, res) {
  try {
    const {
      nom, parent_id = null, description = null,
      image_url = null, ordre = 0, active = true,
    } = req.body;

    if (parent_id) {
      const rParent = await getRequest();
      const parentRes = await rParent
        .input('id', sql.UniqueIdentifier, parent_id)
        .query('SELECT id FROM categories WHERE id = @id');

      if (parentRes.recordset.length === 0) {
        return res.status(404).json({ message: 'Catégorie parente introuvable.' });
      }
    }

    const id   = uuidv4();
    const slug = await slugUnique(nom);

    const r = await getRequest();
    await r
      .input('id',          sql.UniqueIdentifier, id)
      .input('parent_id',   sql.UniqueIdentifier, parent_id || null)
      .input('nom',         sql.NVarChar(100),    nom)
      .input('slug',        sql.NVarChar(120),    slug)
      .input('description', sql.NVarChar(sql.MAX), description)
      .input('image_url',   sql.NVarChar(500),    image_url)
      .input('ordre',       sql.Int,              parseInt(ordre) || 0)
      .input('active',      sql.Bit,              !!active)
      .query(`
        INSERT INTO categories (id, parent_id, nom, slug, description, image_url, ordre, active)
        VALUES (@id, @parent_id, @nom, @slug, @description, @image_url, @ordre, @active)
      `);

    return res.status(201).json({
      message: 'Catégorie créée avec succès.',
      categorie: {
        id, parent_id, nom, slug, description, image_url,
        ordre: parseInt(ordre) || 0, active: !!active,
      },
    });

  } catch (err) {
    console.error('creer categorie error:', err);
    if (err.code === 'ER_DUP_ENTRY') { // violation de contrainte unique SQL Server (slug)
      return res.status(409).json({ message: 'Une catégorie avec ce nom existe déjà.' });
    }
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// PUT /api/categories/:id  [admin]
// ══════════════════════════════════════════════════════════════════════════════
async function modifier(req, res) {
  try {
    const { id } = req.params;

    const rExiste = await getRequest();
    const existe = await rExiste
      .input('id', sql.UniqueIdentifier, id)
      .query('SELECT id, nom, parent_id FROM categories WHERE id = @id');

    if (existe.recordset.length === 0) {
      return res.status(404).json({ message: 'Catégorie introuvable.' });
    }

    const { nom, parent_id, description, image_url, ordre, active } = req.body;

    // Validation du nouveau parent (existence + absence de cycle)
    if (parent_id !== undefined && parent_id !== null) {
      if (parent_id === id) {
        return res.status(400).json({ message: 'Une catégorie ne peut pas être son propre parent.' });
      }

      const rParent = await getRequest();
      const parentRes = await rParent
        .input('id', sql.UniqueIdentifier, parent_id)
        .query('SELECT id FROM categories WHERE id = @id');

      if (parentRes.recordset.length === 0) {
        return res.status(404).json({ message: 'Catégorie parente introuvable.' });
      }

      if (await estDansLaDescendance(id, parent_id)) {
        return res.status(400).json({ message: 'Affectation impossible : cela créerait une boucle dans la hiérarchie.' });
      }
    }

    // Recalculer le slug uniquement si le nom a changé
    const nomActuel = existe.recordset[0].nom;
    const slug = nom && nom !== nomActuel
      ? await slugUnique(nom, id)
      : undefined;

    // Construire le SET dynamiquement
    const champs = [];
    const r = await getRequest();

    if (nom         !== undefined) { champs.push('nom = @nom');                 r.input('nom', sql.NVarChar(100), nom); }
    if (slug        !== undefined) { champs.push('slug = @slug');               r.input('slug', sql.NVarChar(120), slug); }
    if (parent_id   !== undefined) { champs.push('parent_id = @parent_id');     r.input('parent_id', sql.UniqueIdentifier, parent_id || null); }
    if (description !== undefined) { champs.push('description = @description'); r.input('description', sql.NVarChar(sql.MAX), description); }
    if (image_url   !== undefined) { champs.push('image_url = @image_url');     r.input('image_url', sql.NVarChar(500), image_url); }
    if (ordre       !== undefined) { champs.push('ordre = @ordre');             r.input('ordre', sql.Int, parseInt(ordre)); }
    if (active      !== undefined) { champs.push('active = @active');           r.input('active', sql.Bit, !!active); }

    if (champs.length === 0) {
      return res.status(400).json({ message: 'Aucun champ à mettre à jour.' });
    }

    r.input('id', sql.UniqueIdentifier, id);
    await r.query(`UPDATE categories SET ${champs.join(', ')} WHERE id = @id`);

    const rResult = await getRequest();
    const result = await rResult
      .input('id', sql.UniqueIdentifier, id)
      .query(`
        SELECT c.*, p.nom AS parent_nom, p.slug AS parent_slug
        FROM categories c
        LEFT JOIN categories p ON p.id = c.parent_id
        WHERE c.id = @id
      `);

    return res.status(200).json({ message: 'Catégorie mise à jour.', categorie: result.recordset[0] });

  } catch (err) {
    console.error('modifier categorie error:', err);
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'Une catégorie avec ce nom existe déjà.' });
    }
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// DELETE /api/categories/:id  [admin]
// ══════════════════════════════════════════════════════════════════════════════
async function supprimer(req, res) {
  try {
    const { id } = req.params;
    const { force } = req.query;

    const rExiste = await getRequest();
    const existe = await rExiste
      .input('id', sql.UniqueIdentifier, id)
      .query('SELECT id FROM categories WHERE id = @id');

    if (existe.recordset.length === 0) {
      return res.status(404).json({ message: 'Catégorie introuvable.' });
    }

    const rEnfants = await getRequest();
    const enfantsRes = await rEnfants
      .input('parent_id', sql.UniqueIdentifier, id)
      .query('SELECT id FROM categories WHERE parent_id = @parent_id');

    if (enfantsRes.recordset.length > 0) {
      if (force !== 'true') {
        return res.status(409).json({
          message: `Cette catégorie a ${enfantsRes.recordset.length} sous-catégorie(s). Réaffectez-les ou ajoutez ?force=true pour les détacher (elles deviendront des catégories racines).`,
        });
      }

      const rDetacher = await getRequest();
      await rDetacher
        .input('parent_id', sql.UniqueIdentifier, id)
        .query('UPDATE categories SET parent_id = NULL WHERE parent_id = @parent_id');
    }

    // Les produits liés repassent automatiquement à categorie_id = NULL (ON DELETE SET NULL)
    const r = await getRequest();
    await r
      .input('id', sql.UniqueIdentifier, id)
      .query('DELETE FROM categories WHERE id = @id');

    return res.status(200).json({ message: 'Catégorie supprimée.' });

  } catch (err) {
    console.error('supprimer categorie error:', err);
    if (err.code === 'ER_ROW_IS_REFERENCED_2') { // violation de contrainte FK SQL Server
      return res.status(409).json({ message: 'Impossible de supprimer cette catégorie : des éléments y sont encore liés.' });
    }
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
}

module.exports = {
  lister,
  obtenir,
  creer,
  modifier,
  supprimer,
};
