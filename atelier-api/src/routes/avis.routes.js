// src/routes/avis.routes.js
const router = require('express').Router();
const { body, param, query } = require('express-validator');

const ctrl        = require('../controllers/avis.controller');
const { valider } = require('../middlewares/validate.middleware');
const { authentifier, authentifierOptionnel, autoriser } = require('../middlewares/auth.middleware');

// ── Règles de validation ──────────────────────────────────────────────────────

const reglesListage = [
  query('page').optional().isInt({ min: 1 }),
  query('limite').optional().isInt({ min: 1, max: 50 }),
  query('produit_id').optional().isUUID().withMessage('produit_id invalide.'),
  query('note').optional().isInt({ min: 1, max: 5 }).withMessage('note doit être entre 1 et 5.'),
  query('approuve').optional().isIn(['true', 'false']),
  query('verifie').optional().isIn(['true', 'false']),
  query('tri').optional().isIn(['created_at', 'note']),
  query('ordre').optional().isIn(['ASC', 'DESC', 'asc', 'desc']),
];

const reglesCreation = [
  body('produit_id')
    .notEmpty().withMessage('produit_id est obligatoire.')
    .isUUID().withMessage('produit_id invalide.'),
  body('note')
    .notEmpty().withMessage('note est obligatoire.')
    .isInt({ min: 1, max: 5 }).withMessage('note doit être un entier entre 1 et 5.'),
  body('titre')
    .optional({ nullable: true })
    .trim()
    .isLength({ max: 255 }).withMessage('titre trop long.'),
  body('commentaire')
    .optional({ nullable: true })
    .isLength({ max: 5000 }).withMessage('commentaire trop long.'),
];

const reglesModification = [
  body('note')
    .optional()
    .isInt({ min: 1, max: 5 }).withMessage('note doit être un entier entre 1 et 5.'),
  body('titre')
    .optional({ nullable: true })
    .trim()
    .isLength({ max: 255 }).withMessage('titre trop long.'),
  body('commentaire')
    .optional({ nullable: true })
    .isLength({ max: 5000 }).withMessage('commentaire trop long.'),
  body('approuve')
    .optional()
    .isBoolean().withMessage('approuve doit être un booléen.'),
  body('verifie')
    .optional()
    .isBoolean().withMessage('verifie doit être un booléen.'),
];

// ── Routes ────────────────────────────────────────────────────────────────────

/**
 * @route   GET /api/avis
 * @desc    Lister les avis approuvés (public) ou tous les avis (admin/modérateur)
 * @access  Public (authentification optionnelle pour les filtres admin)
 * @query   page, limite, produit_id, note, approuve*, verifie*, tri, ordre
 *          (* filtres admin/modérateur uniquement)
 */
router.get('/', authentifierOptionnel, reglesListage, valider, ctrl.lister);

/**
 * @route   GET /api/avis/:id
 * @desc    Obtenir un avis par son ID
 *          (avis non approuvé visible uniquement par son auteur ou un admin/modérateur)
 * @access  Public
 */
router.get(
  '/:id',
  authentifierOptionnel,
  param('id').isUUID().withMessage('ID avis invalide.'),
  valider,
  ctrl.obtenir,
);

/**
 * @route   POST /api/avis
 * @desc    Déposer un avis sur un produit (1 avis par produit par utilisateur)
 *          L'avis est automatiquement marqué "verifie" si l'utilisateur a une
 *          commande livrée contenant ce produit.
 * @access  Authentifié
 * @body    produit_id (obligatoire), note (1-5, obligatoire), titre, commentaire
 */
router.post(
  '/',
  authentifier,
  reglesCreation,
  valider,
  ctrl.creer,
);

/**
 * @route   PATCH /api/avis/:id
 * @desc    Modifier un avis :
 *          - Propriétaire : note, titre, commentaire (uniquement si non encore approuvé)
 *          - Admin/Modérateur : idem + approuve, verifie
 * @access  Propriétaire ou Admin/Modérateur
 */
router.patch(
  '/:id',
  authentifier,
  param('id').isUUID().withMessage('ID avis invalide.'),
  reglesModification,
  valider,
  ctrl.modifier,
);

/**
 * @route   PATCH /api/avis/:id/approuver
 * @desc    Approuver ou rejeter un avis (raccourci de modération)
 * @access  Admin / Modérateur
 * @body    approuve (booléen obligatoire)
 */
router.patch(
  '/:id/approuver',
  authentifier,
  autoriser('admin', 'moderateur'),
  param('id').isUUID().withMessage('ID avis invalide.'),
  body('approuve').notEmpty().isBoolean().withMessage('approuve (booléen) est obligatoire.'),
  valider,
  ctrl.approuver,
);

/**
 * @route   DELETE /api/avis/:id
 * @desc    Supprimer un avis :
 *          - Propriétaire : uniquement si non encore approuvé
 *          - Admin/Modérateur : toujours possible
 * @access  Propriétaire ou Admin/Modérateur
 */
router.delete(
  '/:id',
  authentifier,
  param('id').isUUID().withMessage('ID avis invalide.'),
  valider,
  ctrl.supprimer,
);

module.exports = router;