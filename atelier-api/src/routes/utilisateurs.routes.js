// src/routes/utilisateurs.routes.js
const router = require('express').Router();
const { body, param, query } = require('express-validator');

const ctrl         = require('../controllers/utilisateurs.controller');
const { valider }  = require('../middlewares/validate.middleware');
const { authentifier, autoriser } = require('../middlewares/auth.middleware');

const ROLES = ['client', 'admin', 'moderateur'];

// ── Règles de validation ──────────────────────────────────────────────────────

const reglesListage = [
  query('page').optional().isInt({ min: 1 }),
  query('limite').optional().isInt({ min: 1, max: 100 }),
  query('role').optional().isIn(ROLES).withMessage('role doit être client, admin ou moderateur.'),
  query('recherche').optional().trim().isLength({ max: 255 }),
  query('email_verifie').optional().isIn(['true', 'false']),
  query('tri').optional().isIn(['created_at', 'nom', 'prenom', 'email', 'role']),
  query('ordre').optional().isIn(['ASC', 'DESC', 'asc', 'desc']),
];

const reglesModification = [
  body('nom')
    .optional().trim()
    .isLength({ min: 1, max: 100 }).withMessage('nom invalide.'),
  body('prenom')
    .optional().trim()
    .isLength({ min: 1, max: 100 }).withMessage('prenom invalide.'),
  body('email')
    .optional()
    .isEmail().withMessage('email invalide.')
    .isLength({ max: 255 }),
  body('telephone')
    .optional({ nullable: true })
    .isLength({ max: 20 }).withMessage('telephone trop long.'),
  body('role')
    .optional()
    .isIn(ROLES).withMessage('role doit être client, admin ou moderateur.'),
  body('email_verifie')
    .optional()
    .isBoolean().withMessage('email_verifie doit être un booléen.'),
];

// ── Routes (toutes réservées aux administrateurs) ──────────────────────────────

/**
 * @route   GET /api/utilisateurs
 * @desc    Lister les utilisateurs avec filtres et pagination
 * @access  Admin
 * @query   page, limite, role, recherche, email_verifie, tri, ordre
 */
router.get(
  '/',
  authentifier,
  autoriser('admin'),
  reglesListage,
  valider,
  ctrl.lister,
);

/**
 * @route   GET /api/utilisateurs/:id
 * @desc    Obtenir le détail d'un utilisateur (avec statistiques de commandes)
 * @access  Admin
 */
router.get(
  '/:id',
  authentifier,
  autoriser('admin'),
  param('id').isUUID().withMessage('ID utilisateur invalide.'),
  valider,
  ctrl.obtenir,
);

/**
 * @route   PATCH /api/utilisateurs/:id
 * @desc    Modifier un utilisateur (profil, rôle, statut de vérification email)
 * @access  Admin
 */
router.patch(
  '/:id',
  authentifier,
  autoriser('admin'),
  param('id').isUUID().withMessage('ID utilisateur invalide.'),
  reglesModification,
  valider,
  ctrl.modifier,
);

/**
 * @route   DELETE /api/utilisateurs/:id
 * @desc    Supprimer un utilisateur
 * @access  Admin
 */
router.delete(
  '/:id',
  authentifier,
  autoriser('admin'),
  param('id').isUUID().withMessage('ID utilisateur invalide.'),
  valider,
  ctrl.supprimer,
);

module.exports = router;
