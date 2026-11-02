// src/routes/favoris.routes.js
const express = require('express');
const router  = express.Router();
// ✅ CORRECTION : le middleware exporte `authentifier`, pas `authenticate`
const { authentifier } = require('../middlewares/auth.middleware');
const { lister, ajouter, supprimer, listerIds } = require('../controllers/favoris.controller');

// Toutes les routes favoris nécessitent une authentification
router.use(authentifier);

// GET  /api/favoris         — liste complète des favoris avec détails produit
router.get('/',           lister);

// GET  /api/favoris/ids     — juste les IDs (pour l'état des boutons cœur)
router.get('/ids',        listerIds);

// POST /api/favoris/:produitId  — ajouter un produit aux favoris
router.post('/:produitId',   ajouter);

// DELETE /api/favoris/:produitId — retirer un produit des favoris
router.delete('/:produitId', supprimer);

module.exports = router;
