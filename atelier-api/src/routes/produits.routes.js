// src/routes/produits.routes.js
const router = require('express').Router();
const { body, param, query } = require('express-validator');

const ctrl            = require('../controllers/produits.controller');
const { valider }     = require('../middlewares/validate.middleware');
const { authentifier, autoriser } = require('../middlewares/auth.middleware');

// ── Règles de validation ──────────────────────────────────────────────────────

const reglesProduit = [
  body('nom')
    .trim().notEmpty().withMessage('Le nom est obligatoire.')
    .isLength({ max: 255 }).withMessage('Le nom ne peut pas dépasser 255 caractères.'),
  body('prix')
    .notEmpty().withMessage('Le prix est obligatoire.')
    .isFloat({ min: 0 }).withMessage('Le prix doit être un nombre positif.'),
  body('prix_solde')
    .optional({ nullable: true })
    .isFloat({ min: 0 }).withMessage('Le prix soldé doit être un nombre positif.'),
  body('categorie_id')
    .optional({ nullable: true })
    .isUUID().withMessage('categorie_id invalide.'),
  body('featured')
    .optional()
    .isBoolean().withMessage('featured doit être un booléen.'),
  body('actif')
    .optional()
    .isBoolean().withMessage('actif doit être un booléen.'),
  body('images').optional().isArray().withMessage('images doit être un tableau.'),
  body('images.*.url')
    .notEmpty().withMessage("L'URL de l'image est obligatoire.")
    .isURL().withMessage("URL d'image invalide."),
  body('type_produit')
    .optional()
    .isIn(['sur_mesure', 'stock']).withMessage('type_produit doit être "sur_mesure" ou "stock".'),
  body('variantes').optional().isArray().withMessage('variantes doit être un tableau.'),
  body('variantes.*.stock').optional().isInt({ min: 0 }).withMessage('Le stock doit être un entier positif.'),
];

const reglesListage = [
  query('page').optional().isInt({ min: 1 }),
  query('limite').optional().isInt({ min: 1, max: 50 }),
  query('prix_min').optional().isFloat({ min: 0 }),
  query('prix_max').optional().isFloat({ min: 0 }),
  query('type').optional().isIn(['sur_mesure', 'stock']),
  query('tri').optional().isIn(['created_at', 'prix', 'nom', 'featured', 'note_moyenne']),
  query('ordre').optional().isIn(['ASC', 'DESC', 'asc', 'desc']),
];

const reglesVariante = [
  body('taille').optional({ nullable: true }).isLength({ max: 20 }),
  body('couleur').optional({ nullable: true }).isLength({ max: 50 }),
  body('couleur_hex').optional({ nullable: true }).isLength({ max: 7 }),
  body('sku').optional({ nullable: true }).isLength({ max: 100 }),
  body('stock').optional().isInt({ min: 0 }).withMessage('Le stock doit être un entier positif.'),
  body('stock_alerte').optional().isInt({ min: 0 }),
  body('prix_supplement').optional().isFloat({ min: 0 }),
  body('actif').optional().isBoolean(),
];

// ── Routes publiques ──────────────────────────────────────────────────────────

/**
 * @route   GET /api/produits
 * @desc    Lister les produits avec filtres, recherche et pagination
 * @access  Public
 * @query   page, limite, recherche, categorie (slug), prix_min, prix_max, featured, tri, ordre
 */
router.get('/', reglesListage, valider, ctrl.lister);

/**
 * @route   GET /api/produits/:slug
 * @desc    Obtenir un produit complet (avec images, avis)
 * @access  Public
 */
router.get('/:slug', param('slug').notEmpty().trim(), valider, ctrl.obtenir);

// ── Routes admin ──────────────────────────────────────────────────────────────

/**
 * @route   POST /api/produits
 * @desc    Créer un nouveau produit (nom, description, prix, prix_solde, categorie, images)
 * @access  Admin
 */
router.post(
  '/',
  authentifier,
  autoriser('admin'),
  reglesProduit,
  valider,
  ctrl.creer,
);

/**
 * @route   PUT /api/produits/:id
 * @desc    Modifier un produit (mise à jour partielle)
 * @access  Admin
 */
router.put(
  '/:id',
  authentifier,
  autoriser('admin'),
  param('id').isUUID().withMessage('ID produit invalide.'),
  reglesProduit.map(r => r.optional()),
  valider,
  ctrl.modifier,
);

/**
 * @route   DELETE /api/produits/:id
 * @desc    Désactiver (soft delete) ou supprimer définitivement (?force=true)
 * @access  Admin
 */
router.delete(
  '/:id',
  authentifier,
  autoriser('admin'),
  param('id').isUUID().withMessage('ID produit invalide.'),
  valider,
  ctrl.supprimer,
);

// ── Images ────────────────────────────────────────────────────────────────────
const { gererUpload } = require('../middlewares/upload.middleware');

/**
 * @route   POST /api/produits/:id/images
 * @desc    Uploader une image vers Cloudinary et l'associer au produit
 * @access  Admin
 * @body    multipart/form-data → champ "image" (fichier) + "alt", "ordre", "principale" (0|1)
 */
router.post(
  '/:id/images',
  authentifier,
  autoriser('admin'),
  param('id').isUUID().withMessage('ID produit invalide.'),
  valider,
  gererUpload,
  [
    body('ordre').optional().isInt({ min: 0 }),
    body('principale').optional().isIn(['0', '1', 'true', 'false']),
  ],
  valider,
  ctrl.ajouterImage,
);

/**
 * @route   DELETE /api/produits/:id/images/:imageId
 * @desc    Supprimer une image de Cloudinary ET de la base de données
 * @access  Admin
 */
router.delete(
  '/:id/images/:imageId',
  authentifier,
  autoriser('admin'),
  param('id').isUUID().withMessage('ID produit invalide.'),
  param('imageId').isUUID().withMessage('ID image invalide.'),
  valider,
  ctrl.supprimerImage,
);

// ── Variantes (produits de type "stock") ────────────────────────────────────

/**
 * @route   POST /api/produits/:id/variantes
 * @desc    Ajouter une variante (taille/couleur/stock) à un produit "stock"
 * @access  Admin
 */
router.post(
  '/:id/variantes',
  authentifier,
  autoriser('admin'),
  param('id').isUUID().withMessage('ID produit invalide.'),
  reglesVariante,
  valider,
  ctrl.ajouterVariante,
);

/**
 * @route   PUT /api/produits/:id/variantes/:varianteId
 * @desc    Modifier une variante existante
 * @access  Admin
 */
router.put(
  '/:id/variantes/:varianteId',
  authentifier,
  autoriser('admin'),
  param('id').isUUID().withMessage('ID produit invalide.'),
  param('varianteId').isUUID().withMessage('ID variante invalide.'),
  reglesVariante,
  valider,
  ctrl.modifierVariante,
);

/**
 * @route   DELETE /api/produits/:id/variantes/:varianteId
 * @desc    Supprimer une variante
 * @access  Admin
 */
router.delete(
  '/:id/variantes/:varianteId',
  authentifier,
  autoriser('admin'),
  param('id').isUUID().withMessage('ID produit invalide.'),
  param('varianteId').isUUID().withMessage('ID variante invalide.'),
  valider,
  ctrl.supprimerVariante,
);

/**
 * @route   PATCH /api/produits/:id/variantes/:varianteId/stock
 * @desc    Ajuster le stock d'une variante (set | add | subtract)
 * @access  Admin
 */
router.patch(
  '/:id/variantes/:varianteId/stock',
  authentifier,
  autoriser('admin'),
  param('id').isUUID().withMessage('ID produit invalide.'),
  param('varianteId').isUUID().withMessage('ID variante invalide.'),
  body('quantite').notEmpty().isInt({ min: 0 }).withMessage('quantite doit être un entier positif.'),
  body('operation').optional().isIn(['set', 'add', 'subtract']),
  valider,
  ctrl.ajusterStock,
);

module.exports = router;