// src/utils/journalAdmin.js
// Écrit une entrée dans journaux_admin (table créée par schema_additions.sql).
// Utilisé par les contrôleurs pour tracer les actions sensibles (rôle, suppression,
// changement de statut de commande, etc.) consultées ensuite via
// GET /api/journaux-admin (voir controllers/journauxAdmin.controller.js).
const { v4: uuidv4 } = require('uuid');
const { sql, getRequest } = require('../config/db');

/**
 * Enregistre une action admin dans le journal d'audit.
 * Ne doit jamais faire échouer l'action principale : les erreurs sont
 * loguées en console mais jamais propagées à l'appelant.
 *
 * @param {import('express').Request} req      Requête Express en cours (pour admin_id, ip, user-agent)
 * @param {Object}  params
 * @param {string}  params.action              ex: 'utilisateur.role', 'produit.supprimer'
 * @param {string}  [params.entite]             ex: 'utilisateur', 'produit', 'commande', 'code_promo'
 * @param {string}  [params.entite_id]          id de la ressource concernée
 * @param {Object|string} [params.details]      détails libres (sera stocké en JSON si objet)
 */
async function enregistrer(req, { action, entite = null, entite_id = null, details = null }) {
  try {
    const adminId = req?.utilisateur?.sub || req?.utilisateur?.id || null;

    // req.ip tient compte de `trust proxy` : on ne lit plus x-forwarded-for à la main
    // (son premier élément est fourni par le client, donc falsifiable).
    const ip = req?.ip
      || req?.socket?.remoteAddress
      || null;

    const userAgent = req?.headers?.['user-agent'] || null;

    const detailsStr = details && typeof details === 'object'
      ? JSON.stringify(details)
      : (details || null);

    const r = await getRequest();
    await r
      .input('id',         sql.UniqueIdentifier, uuidv4())
      .input('admin_id',   sql.UniqueIdentifier, adminId)
      .input('action',     sql.NVarChar(100),    action)
      .input('entite',     sql.NVarChar(50),     entite)
      .input('entite_id',  sql.NVarChar(100),    entite_id ? String(entite_id) : null)
      .input('details',    sql.NVarChar(sql.MAX), detailsStr)
      .input('ip_address', sql.NVarChar(45),     ip)
      .input('user_agent', sql.NVarChar(500),    userAgent)
      .query(`
        INSERT INTO journaux_admin (id, admin_id, action, entite, entite_id, details, ip_address, user_agent)
        VALUES (@id, @admin_id, @action, @entite, @entite_id, @details, @ip_address, @user_agent)
      `);
  } catch (err) {
    // L'audit log ne doit jamais bloquer l'action métier qui l'a déclenché.
    console.error('journalAdmin.enregistrer error:', err.message);
  }
}

module.exports = { enregistrer };
