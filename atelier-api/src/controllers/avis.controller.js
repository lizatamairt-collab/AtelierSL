// src/controllers/avis.controller.js
const { v4: uuidv4 } = require('uuid');
const { sql, getRequest } = require('../config/db');

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/avis
// Liste publique (avis approuvés) ou complète pour un admin.
// Peut être filtré par produit_id.
// ══════════════════════════════════════════════════════════════════════════════
async function lister(req, res) {
  try {
    const {
      page       = 1,
      limite     = 10,
      produit_id = '',
      note       = '',
      approuve   = '',
      verifie    = '',
      tri        = 'created_at',
      ordre      = 'DESC',
    } = req.query;

    const estAdmin = ['admin', 'moderateur'].includes(req.utilisateur?.role);

    const offset  = (Math.max(1, parseInt(page)) - 1) * Math.min(50, parseInt(limite));
    const nbLigne = Math.min(50, Math.max(1, parseInt(limite)));

    const colonnesTri = ['created_at', 'note'];
    const colonneTri  = colonnesTri.includes(tri) ? tri : 'created_at';
    const ordreTri    = ['ASC', 'DESC'].includes(ordre.toUpperCase()) ? ordre.toUpperCase() : 'DESC';

    const conditions = ['1=1'];
    const r = await getRequest();

    // Les visiteurs et clients ne voient que les avis approuvés
    if (!estAdmin) {
      conditions.push('a.approuve = true');
    } else {
      if (approuve === 'true' || approuve === 'false') {
        conditions.push('a.approuve = @approuve');
        r.input('approuve', sql.Bit, approuve === 'true');
      }
      if (verifie === 'true' || verifie === 'false') {
        conditions.push('a.verifie = @verifie');
        r.input('verifie', sql.Bit, verifie === 'true');
      }
    }

    if (produit_id) {
      conditions.push('a.produit_id = @produit_id');
      r.input('produit_id', sql.UniqueIdentifier, produit_id);
    }

    if (note && ['1','2','3','4','5'].includes(note)) {
      conditions.push('a.note = @note');
      r.input('note', sql.TinyInt, parseInt(note));
    }

    const where = conditions.join(' AND ');
    r.input('offset',  sql.Int, offset);
    r.input('nbLigne', sql.Int, nbLigne);

    const querySQL = `
      SELECT
        a.id, a.produit_id, a.utilisateur_id,
        a.note, a.titre, a.commentaire,
        a.verifie, a.approuve, a.created_at,
        u.nom  AS auteur_nom,
        u.prenom AS auteur_prenom,
        p.nom  AS produit_nom,
        p.slug AS produit_slug
      FROM avis a
      INNER JOIN utilisateurs u ON u.id = a.utilisateur_id
      INNER JOIN produits      p ON p.id = a.produit_id
      WHERE ${where}
      ORDER BY a.${colonneTri} ${ordreTri}
      LIMIT @nbLigne OFFSET @offset
    `;

    const rCount = await getRequest();
    if (!estAdmin) {
      // pas d'input supplémentaire, condition hardcodée
    } else {
      if (approuve === 'true' || approuve === 'false') rCount.input('approuve', sql.Bit, approuve === 'true');
      if (verifie  === 'true' || verifie  === 'false') rCount.input('verifie',  sql.Bit, verifie  === 'true');
    }
    if (produit_id) rCount.input('produit_id', sql.UniqueIdentifier, produit_id);
    if (note && ['1','2','3','4','5'].includes(note)) rCount.input('note', sql.TinyInt, parseInt(note));

    const countSQL = `SELECT COUNT(*) AS total FROM avis a WHERE ${where}`;

    const [avis, count] = await Promise.all([
      r.query(querySQL),
      rCount.query(countSQL),
    ]);

    const total = count.recordset[0].total;

    return res.status(200).json({
      avis: avis.recordset,
      pagination: {
        page:   parseInt(page),
        limite: nbLigne,
        total,
        pages:  Math.ceil(total / nbLigne),
      },
    });

  } catch (err) {
    console.error('lister avis error:', err);
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/avis/:id
// ══════════════════════════════════════════════════════════════════════════════
async function obtenir(req, res) {
  try {
    const { id } = req.params;
    const estAdmin = ['admin', 'moderateur'].includes(req.utilisateur?.role);

    const r = await getRequest();
    const result = await r
      .input('id', sql.UniqueIdentifier, id)
      .query(`
        SELECT
          a.id, a.produit_id, a.utilisateur_id,
          a.note, a.titre, a.commentaire,
          a.verifie, a.approuve, a.created_at,
          u.nom  AS auteur_nom,
          u.prenom AS auteur_prenom,
          p.nom  AS produit_nom,
          p.slug AS produit_slug
        FROM avis a
        INNER JOIN utilisateurs u ON u.id = a.utilisateur_id
        INNER JOIN produits      p ON p.id = a.produit_id
        WHERE a.id = @id
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ message: 'Avis introuvable.' });
    }

    const avis = result.recordset[0];

    // Un client ne peut voir un avis non approuvé que si c'est le sien
    if (!estAdmin && !avis.approuve) {
      if (!req.utilisateur || avis.utilisateur_id !== req.utilisateur.sub) {
        return res.status(404).json({ message: 'Avis introuvable.' });
      }
    }

    return res.status(200).json({ avis });

  } catch (err) {
    console.error('obtenir avis error:', err);
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/avis
// Un utilisateur ne peut déposer qu'un seul avis par produit (contrainte UQ).
// L'avis est automatiquement marqué "verifie" si l'utilisateur a acheté le produit.
// ══════════════════════════════════════════════════════════════════════════════
async function creer(req, res) {
  try {
    const utilisateur_id = req.utilisateur.sub;
    const { produit_id, note, titre = null, commentaire = null } = req.body;

    // Vérifier que le produit existe
    const rProd = await getRequest();
    const prodRes = await rProd
      .input('id', sql.UniqueIdentifier, produit_id)
      .query('SELECT id FROM produits WHERE id = @id AND actif = true');

    if (prodRes.recordset.length === 0) {
      return res.status(404).json({ message: 'Produit introuvable.' });
    }

    // Vérifier qu'un avis n'existe pas déjà (contrainte UQ schéma)
    const rDup = await getRequest();
    const dup = await rDup
      .input('produit_id',     sql.UniqueIdentifier, produit_id)
      .input('utilisateur_id', sql.UniqueIdentifier, utilisateur_id)
      .query('SELECT id FROM avis WHERE produit_id = @produit_id AND utilisateur_id = @utilisateur_id');

    if (dup.recordset.length > 0) {
      return res.status(409).json({ message: 'Vous avez déjà déposé un avis sur ce produit.' });
    }

    // Achat vérifié : l'utilisateur a une commande livrée contenant ce produit
    const rAchat = await getRequest();
    const achatRes = await rAchat
      .input('utilisateur_id', sql.UniqueIdentifier, utilisateur_id)
      .input('produit_id',     sql.UniqueIdentifier, produit_id)
      .query(`
        SELECT c.id
        FROM commandes c
        INNER JOIN lignes_commande lc ON lc.commande_id = c.id
        INNER JOIN variantes       v  ON v.id = lc.variante_id
        WHERE c.utilisateur_id = @utilisateur_id
          AND v.produit_id     = @produit_id
          AND c.statut         = 'livree'
        LIMIT 1
      `);

    const verifie = achatRes.recordset.length > 0;

    const id = uuidv4();
    const r  = await getRequest();
    await r
      .input('id',             sql.UniqueIdentifier, id)
      .input('produit_id',     sql.UniqueIdentifier, produit_id)
      .input('utilisateur_id', sql.UniqueIdentifier, utilisateur_id)
      .input('note',           sql.TinyInt,          parseInt(note))
      .input('titre',          sql.NVarChar(255),    titre)
      .input('commentaire',    sql.NVarChar(sql.MAX), commentaire)
      .input('verifie',        sql.Bit,              verifie)
      .input('approuve',       sql.Bit,              false)       // modération manuelle
      .query(`
        INSERT INTO avis (id, produit_id, utilisateur_id, note, titre, commentaire, verifie, approuve)
        VALUES (@id, @produit_id, @utilisateur_id, @note, @titre, @commentaire, @verifie, @approuve)
      `);

    return res.status(201).json({
      message: verifie
        ? 'Avis déposé avec succès. Il sera publié après modération.'
        : 'Avis déposé avec succès. Il sera publié après modération (achat non vérifié).',
      avis: { id, produit_id, utilisateur_id, note: parseInt(note), titre, commentaire, verifie, approuve: false },
    });

  } catch (err) {
    console.error('creer avis error:', err);
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'Vous avez déjà déposé un avis sur ce produit.' });
    }
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// PATCH /api/avis/:id
// Le propriétaire peut modifier note/titre/commentaire tant que non approuvé.
// Un admin/modérateur peut tout modifier, y compris approuve et verifie.
// ══════════════════════════════════════════════════════════════════════════════
async function modifier(req, res) {
  try {
    const { id } = req.params;
    const estAdmin = ['admin', 'moderateur'].includes(req.utilisateur.role);

    const rExiste = await getRequest();
    const existe = await rExiste
      .input('id', sql.UniqueIdentifier, id)
      .query('SELECT id, utilisateur_id, approuve FROM avis WHERE id = @id');

    if (existe.recordset.length === 0) {
      return res.status(404).json({ message: 'Avis introuvable.' });
    }

    const avis = existe.recordset[0];

    if (!estAdmin && avis.utilisateur_id !== req.utilisateur.sub) {
      return res.status(403).json({ message: 'Accès refusé à cet avis.' });
    }

    // Un client ne peut plus modifier un avis déjà approuvé
    if (!estAdmin && avis.approuve) {
      return res.status(400).json({ message: 'Cet avis a déjà été approuvé et ne peut plus être modifié.' });
    }

    const { note, titre, commentaire, approuve, verifie } = req.body;

    const champs = [];
    const r = await getRequest();

    if (note        !== undefined) { champs.push('note = @note');               r.input('note',        sql.TinyInt,          parseInt(note)); }
    if (titre       !== undefined) { champs.push('titre = @titre');             r.input('titre',       sql.NVarChar(255),    titre); }
    if (commentaire !== undefined) { champs.push('commentaire = @commentaire'); r.input('commentaire', sql.NVarChar(sql.MAX), commentaire); }

    // Champs réservés admin/modérateur
    if (estAdmin) {
      if (approuve !== undefined) { champs.push('approuve = @approuve'); r.input('approuve', sql.Bit, !!approuve); }
      if (verifie  !== undefined) { champs.push('verifie = @verifie');   r.input('verifie',  sql.Bit, !!verifie); }
    }

    if (champs.length === 0) {
      return res.status(400).json({ message: 'Aucun champ à mettre à jour.' });
    }

    r.input('id', sql.UniqueIdentifier, id);
    await r.query(`UPDATE avis SET ${champs.join(', ')} WHERE id = @id`);

    const rResult = await getRequest();
    const result  = await rResult
      .input('id', sql.UniqueIdentifier, id)
      .query(`
        SELECT a.*, u.nom AS auteur_nom, u.prenom AS auteur_prenom
        FROM avis a
        INNER JOIN utilisateurs u ON u.id = a.utilisateur_id
        WHERE a.id = @id
      `);

    return res.status(200).json({ message: 'Avis mis à jour.', avis: result.recordset[0] });

  } catch (err) {
    console.error('modifier avis error:', err);
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// PATCH /api/avis/:id/approuver  [admin / modérateur]
// Raccourci pour approuver ou rejeter (désapprouver) un avis.
// ══════════════════════════════════════════════════════════════════════════════
async function approuver(req, res) {
  try {
    const { id } = req.params;
    const { approuve } = req.body;

    const rExiste = await getRequest();
    const existe  = await rExiste
      .input('id', sql.UniqueIdentifier, id)
      .query('SELECT id FROM avis WHERE id = @id');

    if (existe.recordset.length === 0) {
      return res.status(404).json({ message: 'Avis introuvable.' });
    }

    const r = await getRequest();
    await r
      .input('id',       sql.UniqueIdentifier, id)
      .input('approuve', sql.Bit,              !!approuve)
      .query('UPDATE avis SET approuve = @approuve WHERE id = @id');

    return res.status(200).json({
      message: approuve ? 'Avis approuvé et publié.' : 'Avis rejeté (dépublié).',
    });

  } catch (err) {
    console.error('approuver avis error:', err);
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// DELETE /api/avis/:id
// Le propriétaire peut supprimer son avis (sauf si approuvé).
// Un admin/modérateur peut toujours supprimer.
// ══════════════════════════════════════════════════════════════════════════════
async function supprimer(req, res) {
  try {
    const { id } = req.params;
    const estAdmin = ['admin', 'moderateur'].includes(req.utilisateur.role);

    const rExiste = await getRequest();
    const existe  = await rExiste
      .input('id', sql.UniqueIdentifier, id)
      .query('SELECT id, utilisateur_id, approuve FROM avis WHERE id = @id');

    if (existe.recordset.length === 0) {
      return res.status(404).json({ message: 'Avis introuvable.' });
    }

    const avis = existe.recordset[0];

    if (!estAdmin && avis.utilisateur_id !== req.utilisateur.sub) {
      return res.status(403).json({ message: 'Accès refusé à cet avis.' });
    }

    if (!estAdmin && avis.approuve) {
      return res.status(400).json({ message: 'Cet avis a déjà été approuvé et ne peut plus être supprimé.' });
    }

    const r = await getRequest();
    await r
      .input('id', sql.UniqueIdentifier, id)
      .query('DELETE FROM avis WHERE id = @id');

    return res.status(200).json({ message: 'Avis supprimé.' });

  } catch (err) {
    console.error('supprimer avis error:', err);
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
}

module.exports = {
  lister,
  obtenir,
  creer,
  modifier,
  approuver,
  supprimer,
};
