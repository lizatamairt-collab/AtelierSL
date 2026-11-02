// src/routes/statistiques.routes.js
const router = require('express').Router();
const { query } = require('express-validator');

const ctrl        = require('../controllers/statistiques.controller');
const { valider } = require('../middlewares/validate.middleware');
const { authentifier, autoriser } = require('../middlewares/auth.middleware');

// ── Règles communes ───────────────────────────────────────────────────────────

const reglesPeriode = [
  query('date_debut')
    .optional()
    .isISO8601().withMessage('date_debut doit être une date ISO 8601 (ex : 2025-01-01).'),
  query('date_fin')
    .optional()
    .isISO8601().withMessage('date_fin doit être une date ISO 8601 (ex : 2025-12-31).')
    .custom((fin, { req }) => {
      if (req.query.date_debut && fin && new Date(fin) <= new Date(req.query.date_debut)) {
        throw new Error('date_fin doit être postérieure à date_debut.');
      }
      return true;
    }),
];

const reglesLimite = [
  query('limite')
    .optional()
    .isInt({ min: 1, max: 50 }).withMessage('limite doit être un entier entre 1 et 50.'),
];

// ── Routes (toutes réservées aux administrateurs) ─────────────────────────────
// Toutes les routes statistiques nécessitent une authentification admin.
// Le middleware est appliqué une fois au niveau du router.
router.use(authentifier, autoriser('admin'));

/**
 * @route   GET /api/statistiques/resume
 * @desc    Tableau de bord principal : chiffres clés de la période + delta vs période précédente
 *          (nb commandes, CA, panier moyen, taux d'annulation, nouveaux clients,
 *           avis, variantes en stock faible / rupture, totaux globaux)
 * @access  Admin
 * @query   date_debut, date_fin  (défaut : 30 derniers jours)
 */
router.get(
  '/resume',
  reglesPeriode,
  valider,
  ctrl.resume,
);

/**
 * @route   GET /api/statistiques/ventes
 * @desc    Évolution du CA et des commandes par jour / semaine / mois
 * @access  Admin
 * @query   date_debut, date_fin, grouper (jour | semaine | mois, défaut : jour)
 */
router.get(
  '/ventes',
  [
    ...reglesPeriode,
    query('grouper')
      .optional()
      .isIn(['jour', 'semaine', 'mois']).withMessage('grouper doit être jour, semaine ou mois.'),
  ],
  valider,
  ctrl.ventes,
);

/**
 * @route   GET /api/statistiques/produits
 * @desc    Top produits vendus (quantité + CA), répartition par catégorie, stock critique
 * @access  Admin
 * @query   date_debut, date_fin, limite (défaut : 10, max : 50)
 */
router.get(
  '/produits',
  [...reglesPeriode, ...reglesLimite],
  valider,
  ctrl.produits,
);

/**
 * @route   GET /api/statistiques/clients
 * @desc    Nouveaux inscrits par jour, top clients par CA, répartition email vérifié
 * @access  Admin
 * @query   date_debut, date_fin, limite (défaut : 10, max : 50)
 */
router.get(
  '/clients',
  [...reglesPeriode, ...reglesLimite],
  valider,
  ctrl.clients,
);

/**
 * @route   GET /api/statistiques/commandes
 * @desc    Répartition des commandes par statut, par méthode de paiement et utilisation des codes promo
 * @access  Admin
 * @query   date_debut, date_fin
 */
router.get(
  '/commandes',
  reglesPeriode,
  valider,
  ctrl.commandes,
);

module.exports = router;
