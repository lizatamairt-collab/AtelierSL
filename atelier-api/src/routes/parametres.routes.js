// src/routes/parametres.routes.js
const express = require('express');
const router  = express.Router();
const { authentifier, autoriser } = require('../middlewares/auth.middleware');
const { obtenir, mettreAJour } = require('../controllers/parametres.controller');

router.use(authentifier, autoriser('admin'));

/**
 * @route   GET /api/parametres
 * @desc    Récupérer la configuration du site (ligne unique)
 * @access  Admin
 */
router.get('/', obtenir);

/**
 * @route   PUT /api/parametres
 * @desc    Mettre à jour la configuration du site
 * @access  Admin
 */
router.put('/', mettreAJour);

module.exports = router;
