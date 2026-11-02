// src/routes/adresses.routes.js
const router = require('express').Router();
const { body, param, query } = require('express-validator');

const ctrl        = require('../controllers/adresses.controller');
const { valider } = require('../middlewares/validate.middleware');
const { authentifier, autoriser } = require('../middlewares/auth.middleware');

// Toutes les routes nécessitent d'être authentifié
router.use(authentifier);

// ── Règles de validation ──────────────────────────────────────────────────────

const reglesCreation = [
  body('utilisateur_id')
    .optional()
    .isUUID().withMessage('utilisateur_id invalide.'),
  body('prenom')
    .notEmpty().withMessage('prenom est obligatoire.')
    .trim().isLength({ min: 2, max: 100 }).withMessage('prenom doit faire entre 2 et 100 caractères.'),
  body('nom')
    .notEmpty().withMessage('nom est obligatoire.')
    .trim().isLength({ min: 2, max: 100 }).withMessage('nom doit faire entre 2 et 100 caractères.'),
  body('rue')
    .notEmpty().withMessage('rue est obligatoire.')
    .trim().isLength({ min: 5, max: 255 }).withMessage('rue invalide.'),
  body('complement')
    .optional({ nullable: true })
    .isLength({ max: 255 }).withMessage('complement trop long.'),
  body('ville')
    .notEmpty().withMessage('ville est obligatoire.')
    .trim().isLength({ min: 2, max: 100 }).withMessage('ville invalide.'),
  body('pays')
    .optional()
    .trim().isLength({ max: 100 }).withMessage('pays trop long.'),
  body('par_defaut')
    .optional()
    .isBoolean().withMessage('par_defaut doit être un booléen.'),
];

const reglesModification = [
  body('prenom')
    .optional().trim()
    .isLength({ min: 2, max: 100 }).withMessage('prenom invalide.'),
  body('nom')
    .optional().trim()
    .isLength({ min: 2, max: 100 }).withMessage('nom invalide.'),
  body('rue')
    .optional().trim()
    .isLength({ min: 5, max: 255 }).withMessage('rue invalide.'),
  body('complement')
    .optional({ nullable: true })
    .isLength({ max: 255 }).withMessage('complement trop long.'),
  body('ville')
    .optional().trim()
    .isLength({ min: 2, max: 100 }).withMessage('ville invalide.'),
  body('pays')
    .optional().trim()
    .isLength({ max: 100 }).withMessage('pays trop long.'),
  body('par_defaut')
    .optional()
    .isBoolean().withMessage('par_defaut doit être un booléen.'),
];

const reglesId = [
  param('id').isUUID().withMessage('ID adresse invalide.'),
];

// ── Routes ────────────────────────────────────────────────────────────────────

/**
 * @route   GET /api/adresses
 * @desc    Lister ses adresses (client) ou toutes les adresses (admin),
 *          filtrable par ?utilisateur_id= (admin uniquement)
 * @access  Authentifié
 */
router.get(
  '/',
  query('utilisateur_id').optional().isUUID().withMessage('utilisateur_id invalide.'),
  valider,
  ctrl.lister,
);

/**
 * @route   GET /api/adresses/:id
 * @desc    Obtenir une adresse par son ID
 * @access  Propriétaire ou Admin/Modérateur
 */
router.get('/:id', reglesId, valider, ctrl.obtenir);

/**
 * @route   POST /api/adresses
 * @desc    Créer une adresse (pour soi-même ou pour un utilisateur cible si admin)
 * @access  Authentifié
 * @body    prenom, nom, rue, ville (obligatoires)
 *          + complement, pays, par_defaut, utilisateur_id (admin)
 */
router.post('/', reglesCreation, valider, ctrl.creer);

/**
 * @route   PUT /api/adresses/:id
 * @desc    Modifier une adresse (mise à jour partielle)
 * @access  Propriétaire ou Admin/Modérateur
 */
router.put('/:id', reglesId, reglesModification, valider, ctrl.modifier);

/**
 * @route   PATCH /api/adresses/:id/par-defaut
 * @desc    Définir cette adresse comme adresse par défaut
 *          (retire automatiquement le statut des autres adresses du même utilisateur)
 * @access  Propriétaire ou Admin/Modérateur
 */
router.patch(
  '/:id/par-defaut',
  reglesId,
  valider,
  ctrl.definirParDefaut,
);

/**
 * @route   DELETE /api/adresses/:id
 * @desc    Supprimer une adresse (bloqué si référencée par une commande)
 * @access  Propriétaire ou Admin/Modérateur
 */
router.delete('/:id', reglesId, valider, ctrl.supprimer);

module.exports = router;