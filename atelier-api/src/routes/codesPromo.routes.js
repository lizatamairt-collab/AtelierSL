// src/routes/codesPromo.routes.js
const router = require('express').Router();
const { body, param, query } = require('express-validator');

const ctrl        = require('../controllers/codesPromo.controller');
const { valider } = require('../middlewares/validate.middleware');
const { authentifier, autoriser } = require('../middlewares/auth.middleware');

const TYPES_REMISE = ['pourcentage', 'montant_fixe', 'livraison_gratuite'];

// ── Règles de validation ──────────────────────────────────────────────────────

const reglesListage = [
  query('page').optional().isInt({ min: 1 }),
  query('limite').optional().isInt({ min: 1, max: 100 }),
  query('actif').optional().isIn(['true', 'false']),
  query('type_remise').optional().isIn(TYPES_REMISE).withMessage('type_remise invalide.'),
  query('recherche').optional().trim().isLength({ max: 255 }),
  query('tri').optional().isIn(['created_at', 'code', 'type_remise', 'valeur', 'expire_le', 'utilisations_count']),
  query('ordre').optional().isIn(['ASC', 'DESC', 'asc', 'desc']),
];

const reglesVerification = [
  body('code')
    .notEmpty().withMessage('code est obligatoire.')
    .trim()
    .isLength({ max: 50 }).withMessage('code trop long.'),
  body('montant_panier')
    .optional()
    .isFloat({ min: 0 }).withMessage('montant_panier doit être un nombre positif.'),
];

const reglesCreation = [
  body('code')
    .notEmpty().withMessage('code est obligatoire.')
    .trim()
    .isLength({ min: 2, max: 50 }).withMessage('code doit faire entre 2 et 50 caractères.')
    .matches(/^[A-Za-z0-9_-]+$/).withMessage('code ne peut contenir que des lettres, chiffres, tirets et underscores.'),
  body('type_remise')
    .notEmpty().withMessage('type_remise est obligatoire.')
    .isIn(TYPES_REMISE).withMessage(`type_remise doit être : ${TYPES_REMISE.join(', ')}.`),
  body('valeur')
    .notEmpty().withMessage('valeur est obligatoire.')
    .isFloat({ min: 0.01 }).withMessage('valeur doit être supérieure à 0.')
    .custom((val, { req }) => {
      if (req.body.type_remise === 'pourcentage' && parseFloat(val) > 100) {
        throw new Error('Un pourcentage ne peut pas dépasser 100.');
      }
      return true;
    }),
  body('description')
    .optional({ nullable: true })
    .isLength({ max: 255 }).withMessage('description trop longue.'),
  body('montant_minimum')
    .optional({ nullable: true })
    .isFloat({ min: 0 }).withMessage('montant_minimum doit être un nombre positif.'),
  body('utilisations_max')
    .optional({ nullable: true })
    .isInt({ min: 1 }).withMessage('utilisations_max doit être un entier positif.'),
  body('debut_le')
    .optional({ nullable: true })
    .isISO8601().withMessage('debut_le doit être une date ISO 8601.'),
  body('expire_le')
    .optional({ nullable: true })
    .isISO8601().withMessage('expire_le doit être une date ISO 8601.'),
  body('actif')
    .optional()
    .isBoolean().withMessage('actif doit être un booléen.'),
];

const reglesModification = [
  body('code')
    .optional().trim()
    .isLength({ min: 2, max: 50 }).withMessage('code doit faire entre 2 et 50 caractères.')
    .matches(/^[A-Za-z0-9_-]+$/).withMessage('code ne peut contenir que des lettres, chiffres, tirets et underscores.'),
  body('type_remise')
    .optional()
    .isIn(TYPES_REMISE).withMessage(`type_remise doit être : ${TYPES_REMISE.join(', ')}.`),
  body('valeur')
    .optional()
    .isFloat({ min: 0.01 }).withMessage('valeur doit être supérieure à 0.'),
  body('description')
    .optional({ nullable: true })
    .isLength({ max: 255 }).withMessage('description trop longue.'),
  body('montant_minimum')
    .optional({ nullable: true })
    .isFloat({ min: 0 }).withMessage('montant_minimum doit être un nombre positif.'),
  body('utilisations_max')
    .optional({ nullable: true })
    .isInt({ min: 1 }).withMessage('utilisations_max doit être un entier positif.'),
  body('debut_le')
    .optional({ nullable: true })
    .isISO8601().withMessage('debut_le doit être une date ISO 8601.'),
  body('expire_le')
    .optional({ nullable: true })
    .isISO8601().withMessage('expire_le doit être une date ISO 8601.'),
  body('actif')
    .optional()
    .isBoolean().withMessage('actif doit être un booléen.'),
];

// ── Routes ─────────────────────────────────────────────────────────────────────

/**
 * @route   GET /api/codes-promo
 * @desc    Lister les codes promo avec filtres et pagination
 * @access  Admin
 * @query   page, limite, actif, type_remise, recherche, tri, ordre
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
 * @route   POST /api/codes-promo/verifier
 * @desc    Vérifier la validité d'un code promo (depuis le panier / checkout)
 * @access  Authentifié
 * @body    code (obligatoire), montant_panier (optionnel, pour calculer la remise estimée)
 */
router.post(
  '/verifier',
  authentifier,
  reglesVerification,
  valider,
  ctrl.verifier,
);

/**
 * @route   GET /api/codes-promo/:id
 * @desc    Obtenir le détail d'un code promo (avec stats d'utilisation)
 * @access  Admin
 */
router.get(
  '/:id',
  authentifier,
  autoriser('admin'),
  param('id').isUUID().withMessage('ID code promo invalide.'),
  valider,
  ctrl.obtenir,
);

/**
 * @route   POST /api/codes-promo
 * @desc    Créer un nouveau code promo
 * @access  Admin
 * @body    code, type_remise, valeur (obligatoires) + description, montant_minimum,
 *          utilisations_max, debut_le, expire_le, actif
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
 * @route   PATCH /api/codes-promo/:id
 * @desc    Modifier un code promo (mise à jour partielle)
 * @access  Admin
 */
router.patch(
  '/:id',
  authentifier,
  autoriser('admin'),
  param('id').isUUID().withMessage('ID code promo invalide.'),
  reglesModification,
  valider,
  ctrl.modifier,
);

/**
 * @route   DELETE /api/codes-promo/:id
 * @desc    Supprimer un code promo (les commandes liées conservent leur historique,
 *          code_promo_id passe à NULL via ON DELETE SET NULL)
 * @access  Admin
 */
router.delete(
  '/:id',
  authentifier,
  autoriser('admin'),
  param('id').isUUID().withMessage('ID code promo invalide.'),
  valider,
  ctrl.supprimer,
);

module.exports = router;
