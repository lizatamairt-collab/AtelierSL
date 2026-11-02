// src/controllers/parametres.controller.js
const { sql, getRequest } = require('../config/db');
const journalAdmin = require('../utils/journalAdmin');
const { TARIFS_LIVRAISON, fusionnerTarifs } = require('../utils/tarifsLivraison');

const COLONNES = `
  nom_site, email_contact, telephone_contact, delai_livraison,
  frais_livraison, seuil_livraison_gratuite, livraison_gratuite_active,
  soldes_active, maintenance_active, instagram, facebook,
  tarifs_livraison_json, updated_at
`;

// Transforme la grille (objet clé = code wilaya) en tableau trié, pratique
// pour être affiché tel quel dans un tableau admin.
function tarifsEnTableau(overrideJson) {
  const grille = fusionnerTarifs(overrideJson);
  return Object.keys(grille)
    .sort()
    .map(code => ({ code, ...grille[code] }));
}

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/parametres  [admin]
// Retourne la ligne unique de configuration (id = 1), créée par la migration
// migration_parametres_site.sql. Si jamais absente (migration pas jouée), on la
// crée à la volée avec les valeurs par défaut plutôt que de renvoyer une erreur.
// ══════════════════════════════════════════════════════════════════════════════
async function obtenir(req, res) {
  try {
    const r = await getRequest();
    let result = await r.query(`SELECT ${COLONNES} FROM parametres_site WHERE id = 1`);

    if (result.recordset.length === 0) {
      const rInsert = await getRequest();
      await rInsert.query(`
        INSERT INTO parametres_site (id, nom_site)
        VALUES (1, 'Atelier S.L')
      `);
      const rRelu = await getRequest();
      result = await rRelu.query(`SELECT ${COLONNES} FROM parametres_site WHERE id = 1`);
    }

    return res.status(200).json({
      parametres: result.recordset[0],
      tarifs_livraison: tarifsEnTableau(result.recordset[0].tarifs_livraison_json),
    });

  } catch (err) {
    console.error('parametres obtenir error:', err);
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// PUT /api/parametres  [admin]
// Met à jour la ligne unique de configuration. Journalisé (action sensible :
// active le mode maintenance, les soldes, change les frais de livraison, etc.).
// ══════════════════════════════════════════════════════════════════════════════
async function mettreAJour(req, res) {
  try {
    const {
      nom_site,
      email_contact,
      telephone_contact,
      delai_livraison,
      frais_livraison,
      seuil_livraison_gratuite,
      livraison_gratuite_active,
      soldes_active,
      maintenance_active,
      instagram,
      facebook,
      // Tableau [{code, domicile, stopdesk}, ...] envoyé par le panneau admin.
      // Optionnel : si absent, la grille tarifaire existante est conservée.
      tarifs_livraison,
    } = req.body;

    // On ne garde que domicile/stopdesk, et seulement pour des codes wilaya
    // connus, pour éviter d'enregistrer n'importe quoi en base.
    let tarifsLivraisonJson = null;
    if (Array.isArray(tarifs_livraison)) {
      const objet = {};
      for (const ligne of tarifs_livraison) {
        if (!ligne || !TARIFS_LIVRAISON[ligne.code]) continue;
        const domicile = parseFloat(ligne.domicile);
        const stopdesk = parseFloat(ligne.stopdesk);
        if (!Number.isFinite(domicile) || !Number.isFinite(stopdesk)) continue;
        objet[ligne.code] = { domicile, stopdesk };
      }
      if (Object.keys(objet).length > 0) tarifsLivraisonJson = JSON.stringify(objet);
    }

    const r = await getRequest();
    await r
      .input('nom_site',                  sql.NVarChar(255), (nom_site || 'Atelier S.L').trim())
      .input('email_contact',             sql.NVarChar(255), email_contact ? email_contact.trim() : null)
      .input('telephone_contact',         sql.NVarChar(30),  telephone_contact ? telephone_contact.trim() : null)
      .input('delai_livraison',           sql.NVarChar(255), delai_livraison ? delai_livraison.trim() : null)
      .input('frais_livraison',           sql.Decimal(10, 2), parseFloat(frais_livraison) || 0)
      .input('seuil_livraison_gratuite',  sql.Decimal(10, 2), parseFloat(seuil_livraison_gratuite) || 0)
      .input('livraison_gratuite_active', sql.Bit, !!livraison_gratuite_active)
      .input('soldes_active',             sql.Bit, !!soldes_active)
      .input('maintenance_active',        sql.Bit, !!maintenance_active)
      .input('instagram',                 sql.NVarChar(255), instagram ? instagram.trim() : null)
      .input('facebook',                  sql.NVarChar(255), facebook ? facebook.trim() : null)
      .input('tarifs_livraison_json',     sql.NVarChar(sql.MAX), tarifsLivraisonJson)
      .query(`
        INSERT INTO parametres_site (
          id, nom_site, email_contact, telephone_contact, delai_livraison,
          frais_livraison, seuil_livraison_gratuite, livraison_gratuite_active,
          soldes_active, maintenance_active, instagram, facebook, tarifs_livraison_json
        ) VALUES (
          1, @nom_site, @email_contact, @telephone_contact, @delai_livraison,
          @frais_livraison, @seuil_livraison_gratuite, @livraison_gratuite_active,
          @soldes_active, @maintenance_active, @instagram, @facebook, @tarifs_livraison_json
        )
        ON DUPLICATE KEY UPDATE
          nom_site                  = VALUES(nom_site),
          email_contact             = VALUES(email_contact),
          telephone_contact         = VALUES(telephone_contact),
          delai_livraison           = VALUES(delai_livraison),
          frais_livraison           = VALUES(frais_livraison),
          seuil_livraison_gratuite  = VALUES(seuil_livraison_gratuite),
          livraison_gratuite_active = VALUES(livraison_gratuite_active),
          soldes_active             = VALUES(soldes_active),
          maintenance_active        = VALUES(maintenance_active),
          instagram                 = VALUES(instagram),
          facebook                  = VALUES(facebook),
          tarifs_livraison_json     = COALESCE(VALUES(tarifs_livraison_json), tarifs_livraison_json),
          updated_at                = NOW();
      `);

    const rRelu = await getRequest();
    const result = await rRelu.query(`SELECT ${COLONNES} FROM parametres_site WHERE id = 1`);

    await journalAdmin.enregistrer(req, {
      action:  'parametres.modifier',
      entite:  'parametres',
      details: { maintenance_active: !!maintenance_active, soldes_active: !!soldes_active, tarifs_livraison_modifies: !!tarifsLivraisonJson },
    });

    return res.status(200).json({
      message: 'Paramètres enregistrés.',
      parametres: result.recordset[0],
      tarifs_livraison: tarifsEnTableau(result.recordset[0].tarifs_livraison_json),
    });

  } catch (err) {
    console.error('parametres mettreAJour error:', err);
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
}

module.exports = { obtenir, mettreAJour };