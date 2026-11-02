// src/routes/categories.routes.js
const router = require('express').Router();
const { body, param, query } = require('express-validator');

const ctrl        = require('../controllers/categories.controller');
const { valider } = require('../middlewares/validate.middleware');
const { authentifier, autoriser } = require('../middlewares/auth.middleware');

// ── Règles de validation ──────────────────────────────────────────────────────

const reglesListage = [
  query('parent_id').optional().custom(v => v === 'racine' || /^[0-9a-f-]{36}$/i.test(v)).withMessage('parent_id invalide.'),
  query('actif').optional().isIn(['true', 'false', 'all']),
  query('arbre').optional().isIn(['true', 'false']),
  query('recherche').optional().trim().isLength({ max: 255 }),
  query('tri').optional().isIn(['ordre', 'nom', 'created_at']),
  query('ordre').optional().isIn(['ASC', 'DESC', 'asc', 'desc']),
];

const reglesCreation = [
  body('nom')
    .notEmpty().withMessage('nom est obligatoire.')
    .trim()
    .isLength({ min: 1, max: 100 }).withMessage('nom doit faire entre 1 et 100 caractères.'),
  body('parent_id')
    .optional({ nullable: true })
    .isUUID().withMessage('parent_id invalide.'),
  body('description')
    .optional({ nullable: true })
    .isLength({ max: 5000 }).withMessage('description trop longue.'),
  body('image_url')
    .optional({ nullable: true })
    .isURL().withMessage('image_url doit être une URL valide.'),
  body('ordre')
    .optional()
    .isInt({ min: 0 }).withMessage('ordre doit être un entier positif.'),
  body('active')
    .optional()
    .isBoolean().withMessage('active doit être un booléen.'),
];

const reglesModification = [
  body('nom')
    .optional().trim()
    .isLength({ min: 1, max: 100 }).withMessage('nom doit faire entre 1 et 100 caractères.'),
  body('parent_id')
    .optional({ nullable: true })
    .custom(v => v === null || /^[0-9a-f-]{36}$/i.test(v)).withMessage('parent_id invalide.'),
  body('description')
    .optional({ nullable: true })
    .isLength({ max: 5000 }).withMessage('description trop longue.'),
  body('image_url')
    .optional({ nullable: true })
    .custom(v => v === null || /^https?:\/\/.+/.test(v)).withMessage('image_url doit être une URL valide.'),
  body('ordre')
    .optional()
    .isInt({ min: 0 }).withMessage('ordre doit être un entier positif.'),
  body('active')
    .optional()
    .isBoolean().withMessage('active doit être un booléen.'),
];

// ── Routes ────────────────────────────────────────────────────────────────────

/**
 * @route   GET /api/categories
 * @desc    Lister les catégories (liste plate ou arborescence avec ?arbre=true)
 * @access  Public
 * @query   parent_id, actif, arbre, recherche, tri, ordre
 */
router.get('/', reglesListage, valider, ctrl.lister);

/**
 * @route   GET /api/categories/:slug
 * @desc    Obtenir une catégorie par son slug (avec ses sous-catégories)
 * @access  Public
 */
router.get(
  '/:slug',
  param('slug').trim().isLength({ min: 1, max: 120 }).withMessage('slug invalide.'),
  valider,
  ctrl.obtenir,
);

/**
 * @route   POST /api/categories
 * @desc    Créer une nouvelle catégorie (le slug est généré automatiquement)
 * @access  Admin
 * @body    nom (obligatoire), parent_id, description, image_url, ordre, active
 */
router.post(
  '/',
  authentifier,
  autoriser('admin'),
  reglesCreation,
  valider,
  ctrl.creer,
);

/**
 * @route   PUT /api/categories/:id
 * @desc    Modifier une catégorie (le slug est recalculé si le nom change)
 * @access  Admin
 * @body    nom, parent_id (null pour passer en racine), description, image_url, ordre, active
 */
router.put(
  '/:id',
  authentifier,
  autoriser('admin'),
  param('id').isUUID().withMessage('ID catégorie invalide.'),
  reglesModification,
  valider,
  ctrl.modifier,
);

/**
 * @route   DELETE /api/categories/:id
 * @desc    Supprimer une catégorie.
 *          Par défaut, bloque s'il reste des sous-catégories.
 *          Avec ?force=true, les sous-catégories sont détachées (deviennent des racines).
 *          Les produits liés repassent à categorie_id = NULL (ON DELETE SET NULL).
 * @access  Admin
 * @query   force (true | false)
 */
router.delete(
  '/:id',
  authentifier,
  autoriser('admin'),
  param('id').isUUID().withMessage('ID catégorie invalide.'),
  query('force').optional().isIn(['true', 'false']),
  valider,
  ctrl.supprimer,
);

module.exports = router;
