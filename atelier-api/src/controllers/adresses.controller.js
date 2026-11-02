// src/controllers/adresses.controller.js
const { v4: uuidv4 } = require('uuid');
const { sql, getRequest } = require('../config/db');

// ══════════════════════════════════════════════════════════════════════════════
// HELPER — vérifie que l'adresse appartient à l'utilisateur (ou admin)
// ══════════════════════════════════════════════════════════════════════════════
async function chargerAdresse(id) {
  const r = await getRequest();
  const res = await r
    .input('id', sql.UniqueIdentifier, id)
    .query(`
      SELECT id, utilisateur_id, prenom, nom, rue, complement,
             ville, pays, par_defaut, created_at
      FROM adresses
      WHERE id = @id
    `);
  return res.recordset[0] || null;
}

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/adresses
// Client : ses propres adresses.
// Admin  : toutes les adresses, filtrable par utilisateur_id.
// ══════════════════════════════════════════════════════════════════════════════
async function lister(req, res) {
  try {
    const estAdmin       = ['admin', 'moderateur'].includes(req.utilisateur.role);
    const { utilisateur_id } = req.query;

    const conditions = [];
    const r = await getRequest();

    if (estAdmin && utilisateur_id) {
      conditions.push('a.utilisateur_id = @utilisateur_id');
      r.input('utilisateur_id', sql.UniqueIdentifier, utilisateur_id);
    } else if (!estAdmin) {
      conditions.push('a.utilisateur_id = @utilisateur_id');
      r.input('utilisateur_id', sql.UniqueIdentifier, req.utilisateur.sub);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await r.query(`
      SELECT
        a.id, a.utilisateur_id, a.prenom, a.nom,
        a.rue, a.complement, a.ville, a.pays,
        a.par_defaut, a.created_at,
        u.nom  AS utilisateur_nom,
        u.prenom AS utilisateur_prenom,
        u.email  AS utilisateur_email
      FROM adresses a
      INNER JOIN utilisateurs u ON u.id = a.utilisateur_id
      ${where}
      ORDER BY a.par_defaut DESC, a.created_at DESC
    `);

    return res.status(200).json({ adresses: result.recordset });

  } catch (err) {
    console.error('adresses lister error:', err);
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/adresses/:id
// ══════════════════════════════════════════════════════════════════════════════
async function obtenir(req, res) {
  try {
    const estAdmin = ['admin', 'moderateur'].includes(req.utilisateur.role);
    const adresse  = await chargerAdresse(req.params.id);

    if (!adresse) {
      return res.status(404).json({ message: 'Adresse introuvable.' });
    }

    if (!estAdmin && adresse.utilisateur_id !== req.utilisateur.sub) {
      return res.status(403).json({ message: 'Accès refusé à cette adresse.' });
    }

    return res.status(200).json({ adresse });

  } catch (err) {
    console.error('adresses obtenir error:', err);
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/adresses
// ══════════════════════════════════════════════════════════════════════════════
async function creer(req, res) {
  try {
    const estAdmin = ['admin', 'moderateur'].includes(req.utilisateur.role);

    // Un admin peut créer une adresse pour n'importe quel utilisateur
    const utilisateur_id = (estAdmin && req.body.utilisateur_id)
      ? req.body.utilisateur_id
      : req.utilisateur.sub;

    const {
      prenom, nom, rue,
      complement  = null,
      ville,
      pays        = 'Algérie',
      par_defaut  = false,
    } = req.body;

    // Vérifier que l'utilisateur cible existe (utile quand l'admin crée pour un tiers)
    if (estAdmin && req.body.utilisateur_id) {
      const rUser = await getRequest();
      const userRes = await rUser
        .input('id', sql.UniqueIdentifier, utilisateur_id)
        .query('SELECT id FROM utilisateurs WHERE id = @id');
      if (userRes.recordset.length === 0) {
        return res.status(404).json({ message: 'Utilisateur cible introuvable.' });
      }
    }

    // Retirer le statut par_defaut des autres adresses si nécessaire
    if (par_defaut) {
      const rReset = await getRequest();
      await rReset
        .input('utilisateur_id', sql.UniqueIdentifier, utilisateur_id)
        .query('UPDATE adresses SET par_defaut = false WHERE utilisateur_id = @utilisateur_id');
    }

    const id = uuidv4();
    const r  = await getRequest();
    await r
      .input('id',             sql.UniqueIdentifier, id)
      .input('utilisateur_id', sql.UniqueIdentifier, utilisateur_id)
      .input('prenom',         sql.NVarChar(100),    prenom.trim())
      .input('nom',            sql.NVarChar(100),    nom.trim())
      .input('rue',            sql.NVarChar(255),    rue.trim())
      .input('complement',     sql.NVarChar(255),    complement || null)
      .input('ville',          sql.NVarChar(100),    ville.trim())
      .input('pays',           sql.NVarChar(100),    pays.trim())
      .input('par_defaut',     sql.Bit,              !!par_defaut)
      .query(`
        INSERT INTO adresses
          (id, utilisateur_id, prenom, nom, rue, complement, ville, pays, par_defaut)
        VALUES
          (@id, @utilisateur_id, @prenom, @nom, @rue, @complement, @ville, @pays, @par_defaut)
      `);

    const rResult = await getRequest();
    const result  = await rResult
      .input('id', sql.UniqueIdentifier, id)
      .query('SELECT * FROM adresses WHERE id = @id');

    return res.status(201).json({
      message: 'Adresse créée.',
      adresse: result.recordset[0],
    });

  } catch (err) {
    console.error('adresses creer error:', err);
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// PUT /api/adresses/:id
// ══════════════════════════════════════════════════════════════════════════════
async function modifier(req, res) {
  try {
    const estAdmin = ['admin', 'moderateur'].includes(req.utilisateur.role);
    const adresse  = await chargerAdresse(req.params.id);

    if (!adresse) {
      return res.status(404).json({ message: 'Adresse introuvable.' });
    }
    if (!estAdmin && adresse.utilisateur_id !== req.utilisateur.sub) {
      return res.status(403).json({ message: 'Accès refusé à cette adresse.' });
    }

    const { prenom, nom, rue, complement, ville, pays, par_defaut } = req.body;

    // Retirer le statut par_defaut des autres adresses si nécessaire
    if (par_defaut === true || par_defaut === 'true') {
      const rReset = await getRequest();
      await rReset
        .input('utilisateur_id', sql.UniqueIdentifier, adresse.utilisateur_id)
        .query('UPDATE adresses SET par_defaut = false WHERE utilisateur_id = @utilisateur_id');
    }

    const champs = [];
    const r = await getRequest();

    if (prenom      !== undefined) { champs.push('prenom = @prenom');           r.input('prenom',      sql.NVarChar(100), prenom.trim()); }
    if (nom         !== undefined) { champs.push('nom = @nom');                 r.input('nom',         sql.NVarChar(100), nom.trim()); }
    if (rue         !== undefined) { champs.push('rue = @rue');                 r.input('rue',         sql.NVarChar(255), rue.trim()); }
    if (complement  !== undefined) { champs.push('complement = @complement');   r.input('complement',  sql.NVarChar(255), complement || null); }
    if (ville       !== undefined) { champs.push('ville = @ville');             r.input('ville',       sql.NVarChar(100), ville.trim()); }
    if (pays        !== undefined) { champs.push('pays = @pays');               r.input('pays',        sql.NVarChar(100), pays.trim()); }
    if (par_defaut  !== undefined) { champs.push('par_defaut = @par_defaut');   r.input('par_defaut',  sql.Bit,           !!par_defaut); }

    if (champs.length === 0) {
      return res.status(400).json({ message: 'Aucun champ à mettre à jour.' });
    }

    r.input('id', sql.UniqueIdentifier, req.params.id);
    await r.query(`UPDATE adresses SET ${champs.join(', ')} WHERE id = @id`);

    const rResult = await getRequest();
    const result  = await rResult
      .input('id', sql.UniqueIdentifier, req.params.id)
      .query('SELECT * FROM adresses WHERE id = @id');

    return res.status(200).json({ message: 'Adresse mise à jour.', adresse: result.recordset[0] });

  } catch (err) {
    console.error('adresses modifier error:', err);
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// PATCH /api/adresses/:id/par-defaut
// Définit cette adresse comme adresse par défaut (retire le statut des autres).
// ══════════════════════════════════════════════════════════════════════════════
async function definirParDefaut(req, res) {
  try {
    const estAdmin = ['admin', 'moderateur'].includes(req.utilisateur.role);
    const adresse  = await chargerAdresse(req.params.id);

    if (!adresse) {
      return res.status(404).json({ message: 'Adresse introuvable.' });
    }
    if (!estAdmin && adresse.utilisateur_id !== req.utilisateur.sub) {
      return res.status(403).json({ message: 'Accès refusé à cette adresse.' });
    }

    if (adresse.par_defaut) {
      return res.status(200).json({ message: 'Cette adresse est déjà définie par défaut.' });
    }

    // Retirer le statut des autres
    const rReset = await getRequest();
    await rReset
      .input('utilisateur_id', sql.UniqueIdentifier, adresse.utilisateur_id)
      .query('UPDATE adresses SET par_defaut = false WHERE utilisateur_id = @utilisateur_id');

    // Définir celle-ci
    const r = await getRequest();
    await r
      .input('id', sql.UniqueIdentifier, req.params.id)
      .query('UPDATE adresses SET par_defaut = true WHERE id = @id');

    return res.status(200).json({ message: 'Adresse définie par défaut.' });

  } catch (err) {
    console.error('adresses definirParDefaut error:', err);
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// DELETE /api/adresses/:id
// ══════════════════════════════════════════════════════════════════════════════
async function supprimer(req, res) {
  try {
    const estAdmin = ['admin', 'moderateur'].includes(req.utilisateur.role);
    const adresse  = await chargerAdresse(req.params.id);

    if (!adresse) {
      return res.status(404).json({ message: 'Adresse introuvable.' });
    }
    if (!estAdmin && adresse.utilisateur_id !== req.utilisateur.sub) {
      return res.status(403).json({ message: 'Accès refusé à cette adresse.' });
    }

    const r = await getRequest();
    await r
      .input('id', sql.UniqueIdentifier, req.params.id)
      .query('DELETE FROM adresses WHERE id = @id');

    return res.status(200).json({ message: 'Adresse supprimée.' });

  } catch (err) {
    console.error('adresses supprimer error:', err);
    if (err.code === 'ER_ROW_IS_REFERENCED_2') { // violation de clé étrangère PostgreSQL
      return res.status(409).json({
        message: 'Cette adresse est utilisée par une commande et ne peut pas être supprimée.',
      });
    }
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
}

module.exports = {
  lister,
  obtenir,
  creer,
  modifier,
  definirParDefaut,
  supprimer,
};