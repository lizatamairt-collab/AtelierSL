// src/routes/notifications.routes.js
const express = require('express');
const router  = express.Router();
const { authentifier } = require('../middlewares/auth.middleware');
const {
  lister,
  marquerLue,
  marquerToutesLues,
  supprimer,
  compteur,
} = require('../controllers/notifications.controller');

// Toutes les routes nécessitent une authentification
router.use(authentifier);

/**
 * @route   GET /api/notifications
 * @desc    Lister les notifications (personnelles + globales si admin)
 * @query   page, limite, non_lues=true
 */
router.get('/', lister);

/**
 * @route   GET /api/notifications/compteur
 * @desc    Nombre de notifications non lues (pour le badge cloche)
 */
router.get('/compteur', compteur);

/**
 * @route   PATCH /api/notifications/lire-tout
 * @desc    Marquer toutes les notifications comme lues
 */
router.patch('/lire-tout', marquerToutesLues);

/**
 * @route   PATCH /api/notifications/:id/lue
 * @desc    Marquer une notification spécifique comme lue
 */
router.patch('/:id/lue', marquerLue);

/**
 * @route   DELETE /api/notifications/:id
 * @desc    Supprimer une notification
 */
router.delete('/:id', supprimer);

module.exports = router;
