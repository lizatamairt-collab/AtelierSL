// src/routes/journauxAdmin.routes.js
const express = require('express');
const router  = express.Router();
const { authentifier, autoriser } = require('../middlewares/auth.middleware');
const { lister } = require('../controllers/journauxAdmin.controller');

// Journal d'audit réservé à l'administrateur.
router.use(authentifier, autoriser('admin'));

/**
 * @route   GET /api/journaux-admin
 * @desc    Liste paginée du journal d'audit (actions sensibles des admins)
 * @access  Admin
 * @query   page, limite (max 50), entite (filtre optionnel)
 */
router.get('/', lister);

module.exports = router;
