// src/controllers/profil.controller.js
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { sql, getRequest } = require('../config/db');

const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS) || 12;

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/profil
// Informations complètes du compte connecté.
// ══════════════════════════════════════════════════════════════════════════════
async function obtenir(req, res) {
  try {
    const r = await getRequest();
    const result = await r
      .input('id', sql.UniqueIdentifier, req.utilisateur.sub)
      .query(`
        SELECT
          u.id, u.nom, u.prenom, u.email, u.telephone,
          u.role, u.email_verifie, u.created_at, u.updated_at,
          (SELECT COUNT(*) FROM commandes c WHERE c.utilisateur_id = u.id)                          AS nb_commandes,
          (SELECT COUNT(*) FROM avis      a WHERE a.utilisateur_id = u.id AND a.approuve = true)   AS nb_avis,
          (SELECT COUNT(*) FROM adresses  ad WHERE ad.utilisateur_id = u.id)                        AS nb_adresses
        FROM utilisateurs u
        WHERE u.id = @id
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ message: 'Utilisateur introuvable.' });
    }

    return res.status(200).json({ profil: result.recordset[0] });

  } catch (err) {
    console.error('profil obtenir error:', err);
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// PATCH /api/profil
// Modifier ses informations personnelles (hors email et mot de passe).
// ══════════════════════════════════════════════════════════════════════════════
async function modifier(req, res) {
  try {
    const { nom, prenom, telephone } = req.body;

    const champs = [];
    const r = await getRequest();

    if (nom       !== undefined) { champs.push('nom = @nom');           r.input('nom',       sql.NVarChar(100), nom.trim()); }
    if (prenom    !== undefined) { champs.push('prenom = @prenom');     r.input('prenom',    sql.NVarChar(100), prenom.trim()); }
    if (telephone !== undefined) { champs.push('telephone = @telephone'); r.input('telephone', sql.NVarChar(20),  telephone || null); }

    if (champs.length === 0) {
      return res.status(400).json({ message: 'Aucun champ à mettre à jour.' });
    }

    r.input('id', sql.UniqueIdentifier, req.utilisateur.sub);
    await r.query(`UPDATE utilisateurs SET ${champs.join(', ')} WHERE id = @id`);

    const rResult = await getRequest();
    const result  = await rResult
      .input('id', sql.UniqueIdentifier, req.utilisateur.sub)
      .query('SELECT id, nom, prenom, email, telephone, role, email_verifie, updated_at FROM utilisateurs WHERE id = @id');

    return res.status(200).json({ message: 'Profil mis à jour.', profil: result.recordset[0] });

  } catch (err) {
    console.error('profil modifier error:', err);
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// PATCH /api/profil/mot-de-passe
// Changer son propre mot de passe (mot de passe actuel requis).
// ══════════════════════════════════════════════════════════════════════════════
async function changerMotDePasse(req, res) {
  try {
    const { mot_de_passe_actuel, nouveau_mot_de_passe } = req.body;

    const r = await getRequest();
    const result = await r
      .input('id', sql.UniqueIdentifier, req.utilisateur.sub)
      .query('SELECT id, mot_de_passe_hash FROM utilisateurs WHERE id = @id');

    if (result.recordset.length === 0) {
      return res.status(404).json({ message: 'Utilisateur introuvable.' });
    }

    const valide = await bcrypt.compare(mot_de_passe_actuel, result.recordset[0].mot_de_passe_hash);
    if (!valide) {
      return res.status(401).json({ message: 'Mot de passe actuel incorrect.' });
    }

    if (mot_de_passe_actuel === nouveau_mot_de_passe) {
      return res.status(400).json({ message: 'Le nouveau mot de passe doit être différent de l\'actuel.' });
    }

    const hash = await bcrypt.hash(nouveau_mot_de_passe, BCRYPT_ROUNDS);

    const rMaj = await getRequest();
    await rMaj
      .input('hash', sql.NVarChar(255),    hash)
      .input('id',   sql.UniqueIdentifier, req.utilisateur.sub)
      .query('UPDATE utilisateurs SET mot_de_passe_hash = @hash WHERE id = @id');

    return res.status(200).json({ message: 'Mot de passe modifié avec succès.' });

  } catch (err) {
    console.error('profil changerMotDePasse error:', err);
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/profil/commandes
// Historique des commandes de l'utilisateur connecté.
// ══════════════════════════════════════════════════════════════════════════════
async function mesCommandes(req, res) {
  try {
    const { page = 1, limite = 10, statut = '' } = req.query;

    const offset  = (Math.max(1, parseInt(page)) - 1) * Math.min(20, parseInt(limite));
    const nbLigne = Math.min(20, Math.max(1, parseInt(limite)));

    const conditions = ['c.utilisateur_id = @utilisateur_id'];
    const r = await getRequest();
    r.input('utilisateur_id', sql.UniqueIdentifier, req.utilisateur.sub);

    if (statut) {
      conditions.push('c.statut = @statut');
      r.input('statut', sql.NVarChar(20), statut);
    }

    r.input('offset',  sql.Int, offset);
    r.input('nbLigne', sql.Int, nbLigne);

    const where = conditions.join(' AND ');

    const [commandes, count] = await Promise.all([
      r.query(`
        SELECT
          c.id, c.numero, c.statut, c.sous_total, c.remise,
          c.frais_livraison, c.total, c.created_at,
          (SELECT COUNT(*) FROM lignes_commande lc WHERE lc.commande_id = c.id) AS nb_articles,
          (
            SELECT lc2.produit_nom
            FROM lignes_commande lc2
            WHERE lc2.commande_id = c.id
            ORDER BY lc2.produit_nom
            LIMIT 1
          ) AS premier_article
        FROM commandes c
        WHERE ${where}
        ORDER BY c.created_at DESC
        LIMIT @nbLigne OFFSET @offset
      `),
      (async () => {
        const rc = await getRequest();
        rc.input('utilisateur_id', sql.UniqueIdentifier, req.utilisateur.sub);
        if (statut) rc.input('statut', sql.NVarChar(20), statut);
        return rc.query(`SELECT COUNT(*) AS total FROM commandes c WHERE ${where}`);
      })(),
    ]);

    return res.status(200).json({
      commandes: commandes.recordset,
      pagination: {
        page:   parseInt(page),
        limite: nbLigne,
        total:  count.recordset[0].total,
        pages:  Math.ceil(count.recordset[0].total / nbLigne),
      },
    });

  } catch (err) {
    console.error('profil mesCommandes error:', err);
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/profil/avis
// Avis déposés par l'utilisateur connecté (approuvés ou en attente).
// ══════════════════════════════════════════════════════════════════════════════
async function mesAvis(req, res) {
  try {
    const r = await getRequest();
    const result = await r
      .input('utilisateur_id', sql.UniqueIdentifier, req.utilisateur.sub)
      .query(`
        SELECT
          a.id, a.note, a.titre, a.commentaire, a.verifie, a.approuve, a.created_at,
          p.id   AS produit_id,
          p.nom  AS produit_nom,
          p.slug AS produit_slug,
          (
            SELECT url
            FROM images_produit ip
            WHERE ip.produit_id = p.id AND ip.principale = true
            LIMIT 1
          ) AS produit_image
        FROM avis a
        INNER JOIN produits p ON p.id = a.produit_id
        WHERE a.utilisateur_id = @utilisateur_id
        ORDER BY a.created_at DESC
      `);

    return res.status(200).json({ avis: result.recordset });

  } catch (err) {
    console.error('profil mesAvis error:', err);
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// ADRESSES
// ══════════════════════════════════════════════════════════════════════════════

// GET /api/profil/adresses
async function listerAdresses(req, res) {
  try {
    const r = await getRequest();
    const result = await r
      .input('utilisateur_id', sql.UniqueIdentifier, req.utilisateur.sub)
      .query(`
        SELECT id, prenom, nom, rue, complement, ville, pays, par_defaut, created_at
        FROM adresses
        WHERE utilisateur_id = @utilisateur_id
        ORDER BY par_defaut DESC, created_at DESC
      `);

    return res.status(200).json({ adresses: result.recordset });

  } catch (err) {
    console.error('profil listerAdresses error:', err);
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
}

// POST /api/profil/adresses
async function ajouterAdresse(req, res) {
  try {
    const { prenom, nom, rue, complement = null, ville, pays = 'Algérie', par_defaut = false } = req.body;
    const utilisateur_id = req.utilisateur.sub;

    // Si cette adresse est définie par défaut, on retire le statut des autres
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
        INSERT INTO adresses (id, utilisateur_id, prenom, nom, rue, complement, ville, pays, par_defaut)
        VALUES (@id, @utilisateur_id, @prenom, @nom, @rue, @complement, @ville, @pays, @par_defaut)
      `);

    return res.status(201).json({
      message: 'Adresse ajoutée.',
      adresse: { id, prenom, nom, rue, complement, ville, pays, par_defaut: !!par_defaut },
    });

  } catch (err) {
    console.error('profil ajouterAdresse error:', err);
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
}

// PUT /api/profil/adresses/:id
async function modifierAdresse(req, res) {
  try {
    const { id } = req.params;
    const utilisateur_id = req.utilisateur.sub;

    const rExiste = await getRequest();
    const existe  = await rExiste
      .input('id',             sql.UniqueIdentifier, id)
      .input('utilisateur_id', sql.UniqueIdentifier, utilisateur_id)
      .query('SELECT id FROM adresses WHERE id = @id AND utilisateur_id = @utilisateur_id');

    if (existe.recordset.length === 0) {
      return res.status(404).json({ message: 'Adresse introuvable.' });
    }

    const { prenom, nom, rue, complement, ville, pays, par_defaut } = req.body;

    // Si on passe cette adresse en défaut, on retire le statut des autres
    if (par_defaut === true || par_defaut === 'true') {
      const rReset = await getRequest();
      await rReset
        .input('utilisateur_id', sql.UniqueIdentifier, utilisateur_id)
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

    r.input('id', sql.UniqueIdentifier, id);
    await r.query(`UPDATE adresses SET ${champs.join(', ')} WHERE id = @id`);

    const rResult = await getRequest();
    const result  = await rResult
      .input('id', sql.UniqueIdentifier, id)
      .query('SELECT * FROM adresses WHERE id = @id');

    return res.status(200).json({ message: 'Adresse mise à jour.', adresse: result.recordset[0] });

  } catch (err) {
    console.error('profil modifierAdresse error:', err);
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
}

// DELETE /api/profil/adresses/:id
async function supprimerAdresse(req, res) {
  try {
    const { id } = req.params;
    const utilisateur_id = req.utilisateur.sub;

    const r = await getRequest();
    const result = await r
      .input('id',             sql.UniqueIdentifier, id)
      .input('utilisateur_id', sql.UniqueIdentifier, utilisateur_id)
      .query('DELETE FROM adresses WHERE id = @id AND utilisateur_id = @utilisateur_id');

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ message: 'Adresse introuvable.' });
    }

    return res.status(200).json({ message: 'Adresse supprimée.' });

  } catch (err) {
    console.error('profil supprimerAdresse error:', err);
    // FK : des commandes référencent encore cette adresse
    if (err.code === 'ER_ROW_IS_REFERENCED_2') {
      return res.status(409).json({ message: 'Cette adresse est utilisée par une commande et ne peut pas être supprimée.' });
    }
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
}

module.exports = {
  obtenir,
  modifier,
  changerMotDePasse,
  mesCommandes,
  mesAvis,
  listerAdresses,
  ajouterAdresse,
  modifierAdresse,
  supprimerAdresse,
};