// src/routes/panier.routes.js
const router = require('express').Router();
const { body, param } = require('express-validator');

const ctrl         = require('../controllers/panier.controller');
const { valider }  = require('../middlewares/validate.middleware');
const { authentifier } = require('../middlewares/auth.middleware');

// ── Règles de validation ──────────────────────────────────────────────────────

const reglesAjout = [
  body('produit_id')
    .notEmpty().withMessage('produit_id est obligatoire.')
    .isUUID().withMessage('produit_id invalide.'),
  body('couleur')
    .optional({ nullable: true })
    .isLength({ max: 50 }).withMessage('couleur trop longue.'),
  body('couleur_hex')
    .optional({ nullable: true })
    .matches(/^#?[0-9A-Fa-f]{6}$/).withMessage('couleur_hex invalide.'),
  body('taille')
    .optional({ nullable: true })
    .isLength({ max: 20 }).withMessage('taille trop longue.'),
  body('quantite')
    .optional()
    .isInt({ min: 1 }).withMessage('quantite doit être un entier positif.'),
  body('date_evenement')
    .optional({ nullable: true })
    .isISO8601().withMessage('date_evenement doit être une date valide (YYYY-MM-DD).'),
];

const reglesQuantite = [
  body('quantite')
    .notEmpty().withMessage('quantite est obligatoire.')
    .isInt({ min: 1 }).withMessage('quantite doit être un entier positif (utilisez DELETE pour retirer un article).'),
  body('date_evenement')
    .optional({ nullable: true })
    .isISO8601().withMessage('date_evenement doit être une date valide (YYYY-MM-DD).'),
];

const reglesLigneParam = [
  param('ligneId').isUUID().withMessage('ID de ligne de panier invalide.'),
];

const reglesFusion = [
  body('session_id')
    .notEmpty().withMessage('session_id est obligatoire.')
    .isLength({ max: 255 }).withMessage('session_id trop long.'),
];

// ── Routes ────────────────────────────────────────────────────────────────────
// Le panier est accessible aux utilisateurs connectés (JWT) ET aux invités
// (en-tête "x-session-id"). L'identité est résolue dans le contrôleur.

/**
 * @route   GET /api/panier
 * @desc    Obtenir le panier courant (créé automatiquement s'il n'existe pas)
 * @access  Public (authentifié ou invité via x-session-id)
 */
router.get('/', ctrl.obtenir);

/**
 * @route   POST /api/panier/lignes
 * @desc    Ajouter un article au panier (incrémente la quantité si déjà présent)
 * @access  Public (authentifié ou invité via x-session-id)
 * @body    produit_id (obligatoire), couleur, couleur_hex, taille, quantite (défaut 1), date_evenement
 */
router.post('/lignes', reglesAjout, valider, ctrl.ajouterLigne);

/**
 * @route   PUT /api/panier/lignes/:ligneId
 * @desc    Définir la quantité exacte (et/ou la date d'événement) d'un article du panier
 * @access  Public (authentifié ou invité via x-session-id)
 * @body    quantite (obligatoire, >= 1), date_evenement (optionnel)
 */
router.put(
  '/lignes/:ligneId',
  reglesLigneParam,
  reglesQuantite,
  valider,
  ctrl.modifierLigne,
);

/**
 * @route   DELETE /api/panier/lignes/:ligneId
 * @desc    Retirer un article du panier
 * @access  Public (authentifié ou invité via x-session-id)
 */
router.delete(
  '/lignes/:ligneId',
  reglesLigneParam,
  valider,
  ctrl.supprimerLigne,
);

/**
 * @route   DELETE /api/panier
 * @desc    Vider entièrement le panier
 * @access  Public (authentifié ou invité via x-session-id)
 */
router.delete('/', ctrl.vider);

/**
 * @route   POST /api/panier/fusionner
 * @desc    Fusionne un panier invité (session_id) dans le panier de l'utilisateur
 *          connecté — à appeler juste après la connexion ou l'inscription
 * @access  Authentifié
 * @body    session_id (obligatoire) : identifiant du panier invité à fusionner
 */
router.post(
  '/fusionner',
  authentifier,
  reglesFusion,
  valider,
  ctrl.fusionner,
);

module.exports = router;
