// src/controllers/codesPromo.controller.js
const { v4: uuidv4 } = require('uuid');
const { sql, getRequest } = require('../config/db');
const journalAdmin = require('../utils/journalAdmin');

const TYPES_REMISE = ['pourcentage', 'montant_fixe', 'livraison_gratuite'];

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/codes-promo  [admin]
// ══════════════════════════════════════════════════════════════════════════════
async function lister(req, res) {
  try {
    const {
      page        = 1,
      limite      = 20,
      actif       = '',
      type_remise = '',
      recherche   = '',
      tri         = 'created_at',
      ordre       = 'DESC',
    } = req.query;

    const offset  = (Math.max(1, parseInt(page)) - 1) * Math.min(100, parseInt(limite));
    const nbLigne = Math.min(100, Math.max(1, parseInt(limite)));

    const colonnesTri = ['created_at', 'code', 'type_remise', 'valeur', 'expire_le', 'utilisations_count'];
    const colonneTri  = colonnesTri.includes(tri) ? tri : 'created_at';
    const ordreTri    = ['ASC', 'DESC'].includes(ordre.toUpperCase()) ? ordre.toUpperCase() : 'DESC';

    const conditions = ['1=1'];
    const r = await getRequest();

    if (actif === 'true' || actif === 'false') {
      conditions.push('actif = @actif');
      r.input('actif', sql.Bit, actif === 'true');
    }

    if (type_remise && TYPES_REMISE.includes(type_remise)) {
      conditions.push('type_remise = @type_remise');
      r.input('type_remise', sql.NVarChar(30), type_remise);
    }

    if (recherche) {
      conditions.push('(code LIKE @recherche OR description LIKE @recherche)');
      r.input('recherche', sql.NVarChar(255), `%${recherche}%`);
    }

    const where = conditions.join(' AND ');
    r.input('offset',  sql.Int, offset);
    r.input('nbLigne', sql.Int, nbLigne);

    const querySQL = `
      SELECT
        id, code, description, type_remise, valeur, montant_minimum,
        utilisations_max, utilisations_count, debut_le, expire_le, actif, created_at,
        CASE
          WHEN actif = false                          THEN 'inactif'
          WHEN expire_le IS NOT NULL
           AND expire_le < now()                       THEN 'expire'
          WHEN debut_le  IS NOT NULL
           AND debut_le  > now()                       THEN 'pas_encore_valide'
          WHEN utilisations_max IS NOT NULL
           AND utilisations_count >= utilisations_max THEN 'epuise'
          ELSE 'valide'
        END AS statut_effectif
      FROM codes_promo
      WHERE ${where}
      ORDER BY ${colonneTri} ${ordreTri}
      LIMIT @nbLigne OFFSET @offset
    `;

    const rCount = await getRequest();
    if (actif === 'true' || actif === 'false') rCount.input('actif', sql.Bit, actif === 'true');
    if (type_remise && TYPES_REMISE.includes(type_remise)) rCount.input('type_remise', sql.NVarChar(30), type_remise);
    if (recherche) rCount.input('recherche', sql.NVarChar(255), `%${recherche}%`);
    const countSQL = `SELECT COUNT(*) AS total FROM codes_promo WHERE ${where}`;

    const [codes, count] = await Promise.all([
      r.query(querySQL),
      rCount.query(countSQL),
    ]);

    return res.status(200).json({
      codes_promo: codes.recordset,
      pagination: {
        page:   parseInt(page),
        limite: nbLigne,
        total:  count.recordset[0].total,
        pages:  Math.ceil(count.recordset[0].total / nbLigne),
      },
    });

  } catch (err) {
    console.error('lister codes-promo error:', err);
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/codes-promo/:id  [admin]
// ══════════════════════════════════════════════════════════════════════════════
async function obtenir(req, res) {
  try {
    const { id } = req.params;

    const r = await getRequest();
    const result = await r
      .input('id', sql.UniqueIdentifier, id)
      .query(`
        SELECT
          cp.*,
          CASE
            WHEN cp.actif = false                                       THEN 'inactif'
            WHEN cp.expire_le IS NOT NULL AND cp.expire_le < now()      THEN 'expire'
            WHEN cp.debut_le  IS NOT NULL AND cp.debut_le  > now()      THEN 'pas_encore_valide'
            WHEN cp.utilisations_max IS NOT NULL
             AND cp.utilisations_count >= cp.utilisations_max           THEN 'epuise'
            ELSE 'valide'
          END AS statut_effectif,
          (SELECT COUNT(*) FROM commandes c WHERE c.code_promo_id = cp.id)             AS nb_commandes,
          (SELECT COALESCE(SUM(c.remise), 0) FROM commandes c WHERE c.code_promo_id = cp.id) AS total_remises
        FROM codes_promo cp
        WHERE cp.id = @id
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ message: 'Code promo introuvable.' });
    }

    return res.status(200).json({ code_promo: result.recordset[0] });

  } catch (err) {
    console.error('obtenir code-promo error:', err);
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/codes-promo/verifier
// Vérifie la validité d'un code depuis le front (panier / checkout).
// N'incrémente PAS le compteur — c'est la création de commande qui s'en charge.
// ══════════════════════════════════════════════════════════════════════════════
async function verifier(req, res) {
  try {
    const { code, montant_panier = 0 } = req.body;

    const r = await getRequest();
    const result = await r
      .input('code', sql.NVarChar(50), code.trim().toUpperCase())
      .query(`
        SELECT id, code, description, type_remise, valeur,
               montant_minimum, utilisations_max, utilisations_count,
               debut_le, expire_le, actif
        FROM codes_promo
        WHERE code = @code
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ valide: false, message: 'Code promo introuvable.' });
    }

    const promo     = result.recordset[0];
    const maintenant = new Date();

    if (!promo.actif) {
      return res.status(400).json({ valide: false, message: 'Ce code promo n\'est plus actif.' });
    }
    if (promo.debut_le && new Date(promo.debut_le) > maintenant) {
      return res.status(400).json({ valide: false, message: 'Ce code promo n\'est pas encore valide.' });
    }
    if (promo.expire_le && new Date(promo.expire_le) < maintenant) {
      return res.status(400).json({ valide: false, message: 'Ce code promo a expiré.' });
    }
    if (promo.utilisations_max !== null && promo.utilisations_count >= promo.utilisations_max) {
      return res.status(400).json({ valide: false, message: 'Ce code promo a atteint sa limite d\'utilisation.' });
    }

    const montant = parseFloat(montant_panier) || 0;
    if (promo.montant_minimum && montant < parseFloat(promo.montant_minimum)) {
      return res.status(400).json({
        valide: false,
        message: `Un montant minimum de ${promo.montant_minimum} DZD est requis pour ce code.`,
      });
    }

    // Calculer la remise estimée (pour affichage côté front)
    let remise_estimee = 0;
    if (promo.type_remise === 'pourcentage') {
      remise_estimee = Math.round(montant * (parseFloat(promo.valeur) / 100) * 100) / 100;
    } else if (promo.type_remise === 'montant_fixe') {
      remise_estimee = Math.min(parseFloat(promo.valeur), montant);
    }
    // livraison_gratuite → remise_estimee reste 0 (les frais sont supprimés au checkout)

    return res.status(200).json({
      valide: true,
      code_promo: {
        id:             promo.id,
        code:           promo.code,
        description:    promo.description,
        type_remise:    promo.type_remise,
        valeur:         promo.valeur,
        remise_estimee,
      },
    });

  } catch (err) {
    console.error('verifier code-promo error:', err);
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/codes-promo  [admin]
// ══════════════════════════════════════════════════════════════════════════════
async function creer(req, res) {
  try {
    const {
      code, description = null, type_remise, valeur,
      montant_minimum = null, utilisations_max = null,
      debut_le = null, expire_le = null, actif = true,
    } = req.body;

    const codeNormalise = code.trim().toUpperCase();

    // Unicité du code
    const rDup = await getRequest();
    const dup = await rDup
      .input('code', sql.NVarChar(50), codeNormalise)
      .query('SELECT id FROM codes_promo WHERE code = @code');

    if (dup.recordset.length > 0) {
      return res.status(409).json({ message: 'Ce code promo existe déjà.' });
    }

    // Cohérence des dates
    if (debut_le && expire_le && new Date(debut_le) >= new Date(expire_le)) {
      return res.status(400).json({ message: 'debut_le doit être antérieur à expire_le.' });
    }

    // livraison_gratuite n'a pas besoin d'une valeur métier mais le schéma
    // impose valeur > 0 — on force 1 si le front ne l'a pas fournie.
    const valeurFinale = type_remise === 'livraison_gratuite'
      ? (parseFloat(valeur) > 0 ? parseFloat(valeur) : 1)
      : parseFloat(valeur);

    const id = uuidv4();
    const r  = await getRequest();
    await r
      .input('id',               sql.UniqueIdentifier, id)
      .input('code',             sql.NVarChar(50),     codeNormalise)
      .input('description',      sql.NVarChar(255),    description)
      .input('type_remise',      sql.NVarChar(30),     type_remise)
      .input('valeur',           sql.Decimal(10, 2),   valeurFinale)
      .input('montant_minimum',  sql.Decimal(10, 2),   montant_minimum  ? parseFloat(montant_minimum)  : null)
      .input('utilisations_max', sql.Int,              utilisations_max ? parseInt(utilisations_max) : null)
      .input('debut_le',         sql.DateTime2,        debut_le  ? new Date(debut_le)  : null)
      .input('expire_le',        sql.DateTime2,        expire_le ? new Date(expire_le) : null)
      .input('actif',            sql.Bit,              !!actif)
      .query(`
        INSERT INTO codes_promo
          (id, code, description, type_remise, valeur, montant_minimum,
           utilisations_max, debut_le, expire_le, actif)
        VALUES
          (@id, @code, @description, @type_remise, @valeur, @montant_minimum,
           @utilisations_max, @debut_le, @expire_le, @actif)
      `);

    const rResult = await getRequest();
    const result  = await rResult
      .input('id', sql.UniqueIdentifier, id)
      .query('SELECT * FROM codes_promo WHERE id = @id');

    return res.status(201).json({
      message:    'Code promo créé avec succès.',
      code_promo: result.recordset[0],
    });

  } catch (err) {
    console.error('creer code-promo error:', err);
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'Ce code promo existe déjà.' });
    }
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// PATCH /api/codes-promo/:id  [admin]
// ══════════════════════════════════════════════════════════════════════════════
async function modifier(req, res) {
  try {
    const { id } = req.params;

    const rExiste = await getRequest();
    const existe  = await rExiste
      .input('id', sql.UniqueIdentifier, id)
      .query('SELECT id, code, debut_le, expire_le FROM codes_promo WHERE id = @id');

    if (existe.recordset.length === 0) {
      return res.status(404).json({ message: 'Code promo introuvable.' });
    }

    const actuel = existe.recordset[0];
    const {
      code, description, type_remise, valeur,
      montant_minimum, utilisations_max,
      debut_le, expire_le, actif,
    } = req.body;

    // Unicité du code si changement
    if (code !== undefined) {
      const codeNorm = code.trim().toUpperCase();
      if (codeNorm !== actuel.code) {
        const rDup = await getRequest();
        const dup  = await rDup
          .input('code', sql.NVarChar(50), codeNorm)
          .query('SELECT id FROM codes_promo WHERE code = @code');
        if (dup.recordset.length > 0) {
          return res.status(409).json({ message: 'Ce code promo existe déjà.' });
        }
      }
    }

    // Cohérence des dates (en tenant compte des valeurs actuelles si non fournies)
    const dateDebut  = debut_le  !== undefined ? (debut_le  ? new Date(debut_le)  : null) : (actuel.debut_le  ? new Date(actuel.debut_le)  : null);
    const dateExpire = expire_le !== undefined ? (expire_le ? new Date(expire_le) : null) : (actuel.expire_le ? new Date(actuel.expire_le) : null);
    if (dateDebut && dateExpire && dateDebut >= dateExpire) {
      return res.status(400).json({ message: 'debut_le doit être antérieur à expire_le.' });
    }

    const champs = [];
    const r = await getRequest();

    if (code             !== undefined) { champs.push('code = @code');                         r.input('code',             sql.NVarChar(50),    code.trim().toUpperCase()); }
    if (description      !== undefined) { champs.push('description = @description');           r.input('description',      sql.NVarChar(255),   description); }
    if (type_remise      !== undefined) { champs.push('type_remise = @type_remise');           r.input('type_remise',      sql.NVarChar(30),    type_remise); }
    if (valeur           !== undefined) { champs.push('valeur = @valeur');                     r.input('valeur',           sql.Decimal(10, 2),  parseFloat(valeur)); }
    if (montant_minimum  !== undefined) { champs.push('montant_minimum = @montant_minimum');   r.input('montant_minimum',  sql.Decimal(10, 2),  montant_minimum  ? parseFloat(montant_minimum)  : null); }
    if (utilisations_max !== undefined) { champs.push('utilisations_max = @utilisations_max'); r.input('utilisations_max', sql.Int,             utilisations_max ? parseInt(utilisations_max) : null); }
    if (debut_le         !== undefined) { champs.push('debut_le = @debut_le');                 r.input('debut_le',         sql.DateTime2,       dateDebut); }
    if (expire_le        !== undefined) { champs.push('expire_le = @expire_le');               r.input('expire_le',        sql.DateTime2,       dateExpire); }
    if (actif            !== undefined) { champs.push('actif = @actif');                       r.input('actif',            sql.Bit,             !!actif); }

    if (champs.length === 0) {
      return res.status(400).json({ message: 'Aucun champ à mettre à jour.' });
    }

    r.input('id', sql.UniqueIdentifier, id);
    await r.query(`UPDATE codes_promo SET ${champs.join(', ')} WHERE id = @id`);

    const rResult = await getRequest();
    const result  = await rResult
      .input('id', sql.UniqueIdentifier, id)
      .query('SELECT * FROM codes_promo WHERE id = @id');

    return res.status(200).json({ message: 'Code promo mis à jour.', code_promo: result.recordset[0] });

  } catch (err) {
    console.error('modifier code-promo error:', err);
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'Ce code promo existe déjà.' });
    }
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// DELETE /api/codes-promo/:id  [admin]
// ══════════════════════════════════════════════════════════════════════════════
async function supprimer(req, res) {
  try {
    const { id } = req.params;

    const rExiste = await getRequest();
    const existe  = await rExiste
      .input('id', sql.UniqueIdentifier, id)
      .query('SELECT id FROM codes_promo WHERE id = @id');

    if (existe.recordset.length === 0) {
      return res.status(404).json({ message: 'Code promo introuvable.' });
    }

    // Vérifier si des commandes l'utilisent encore (la FK est ON DELETE SET NULL,
    // donc on peut supprimer — mais on informe l'admin du nombre de commandes liées)
    const rCmds = await getRequest();
    const cmds  = await rCmds
      .input('id', sql.UniqueIdentifier, id)
      .query('SELECT COUNT(*) AS nb FROM commandes WHERE code_promo_id = @id');

    const r = await getRequest();
    await r
      .input('id', sql.UniqueIdentifier, id)
      .query('DELETE FROM codes_promo WHERE id = @id');

    const nbCommandes = cmds.recordset[0].nb;

    await journalAdmin.enregistrer(req, {
      action:    'code_promo.supprimer',
      entite:    'code_promo',
      entite_id: id,
      details:   { commandes_liees: nbCommandes },
    });

    return res.status(200).json({
      message: nbCommandes > 0
        ? `Code promo supprimé. ${nbCommandes} commande(s) liée(s) conservée(s) (code_promo_id passé à NULL).`
        : 'Code promo supprimé.',
    });

  } catch (err) {
    console.error('supprimer code-promo error:', err);
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
}

module.exports = {
  lister,
  obtenir,
  verifier,
  creer,
  modifier,
  supprimer,
};