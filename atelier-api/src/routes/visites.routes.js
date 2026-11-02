// src/routes/visites.routes.js
const router    = require('express').Router();
const rateLimit = require('express-rate-limit');
const { signaler, statistiques, lister } = require('../controllers/visites.controller');
const { authentifier, autoriser } = require('../middlewares/auth.middleware');

// Garde-fou anti-abus : la route d'enregistrement est publique.
const limiterVisites = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * @route   POST /api/visites
 * @desc    Enregistre une visite + notifie l'admin (public)
 * @body    { page?: string, ref?: string }
 */
router.post('/', limiterVisites, signaler);

/**
 * @route   GET /api/visites/stats
 * @desc    Visiteurs par mois + chiffres clés (admin)
 * @query   mois (1-36, défaut 12)
 */
router.get('/stats', authentifier, autoriser('admin'), statistiques);

/**
 * @route   GET /api/visites
 * @desc    Liste détaillée des visites, paginée (admin)
 * @query   page, limite (max 100), mois (AAAA-MM)
 */
router.get('/', authentifier, autoriser('admin'), lister);

module.exports = router;
