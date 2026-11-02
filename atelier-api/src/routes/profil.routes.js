// src/routes/profil.routes.js
const router = require('express').Router();
const { body, param, query } = require('express-validator');

const ctrl        = require('../controllers/profil.controller');
const { valider } = require('../middlewares/validate.middleware');
const { authentifier } = require('../middlewares/auth.middleware');

// Toutes les routes du profil nécessitent d'être authentifié
router.use(authentifier);

// ── Règles de validation ──────────────────────────────────────────────────────

const reglesModificationProfil = [
  body('nom')
    .optional().trim()
    .isLength({ min: 2, max: 100 }).withMessage('nom doit faire entre 2 et 100 caractères.'),
  body('prenom')
    .optional().trim()
    .isLength({ min: 2, max: 100 }).withMessage('prenom doit faire entre 2 et 100 caractères.'),
  body('telephone')
    .optional({ nullable: true })
    .isLength({ max: 20 }).withMessage('telephone trop long.'),
];

const reglesMotDePasse = [
  body('mot_de_passe_actuel')
    .notEmpty().withMessage('mot_de_passe_actuel est obligatoire.'),
  body('nouveau_mot_de_passe')
    .notEmpty().withMessage('nouveau_mot_de_passe est obligatoire.')
    .isLength({ min: 8 }).withMessage('nouveau_mot_de_passe doit faire au moins 8 caractères.')
    .matches(/[A-Z]/).withMessage('nouveau_mot_de_passe doit contenir au moins une majuscule.')
    .matches(/[0-9]/).withMessage('nouveau_mot_de_passe doit contenir au moins un chiffre.'),
];

const reglesAdresse = [
  body('prenom')
    .notEmpty().withMessage('prenom est obligatoire.')
    .trim().isLength({ min: 2, max: 100 }).withMessage('prenom invalide.'),
  body('nom')
    .notEmpty().withMessage('nom est obligatoire.')
    .trim().isLength({ min: 2, max: 100 }).withMessage('nom invalide.'),
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
    .optional().trim()
    .isLength({ max: 100 }).withMessage('pays trop long.'),
  body('par_defaut')
    .optional()
    .isBoolean().withMessage('par_defaut doit être un booléen.'),
];

const reglesAdresseMaj = reglesAdresse.map(r => {
  // Rendre tous les champs optionnels pour le PUT
  if (r.builder && r.builder.fields) return r; // garde les optionnels tels quels
  return r;
});

// ── Profil ────────────────────────────────────────────────────────────────────

/**
 * @route   GET /api/profil
 * @desc    Obtenir ses informations de compte avec compteurs (commandes, avis, adresses)
 * @access  Authentifié
 */
router.get('/', ctrl.obtenir);

/**
 * @route   PATCH /api/profil
 * @desc    Modifier ses informations personnelles (nom, prenom, telephone)
 * @access  Authentifié
 */
router.patch('/', reglesModificationProfil, valider, ctrl.modifier);

/**
 * @route   PATCH /api/profil/mot-de-passe
 * @desc    Changer son mot de passe (mot de passe actuel requis pour confirmation)
 * @access  Authentifié
 */
router.patch('/mot-de-passe', reglesMotDePasse, valider, ctrl.changerMotDePasse);

// ── Commandes ─────────────────────────────────────────────────────────────────

/**
 * @route   GET /api/profil/commandes
 * @desc    Historique paginé de ses commandes (avec nom du premier article)
 * @access  Authentifié
 * @query   page, limite, statut
 */
router.get(
  '/commandes',
  [
    query('page').optional().isInt({ min: 1 }),
    query('limite').optional().isInt({ min: 1, max: 20 }),
    query('statut').optional().isIn([
      'en_attente', 'confirmee', 'en_preparation', 'expediee', 'livree', 'annulee', 'remboursee',
    ]).withMessage('statut invalide.'),
  ],
  valider,
  ctrl.mesCommandes,
);

// ── Avis ──────────────────────────────────────────────────────────────────────

/**
 * @route   GET /api/profil/avis
 * @desc    Liste de tous ses avis (approuvés ou en attente de modération)
 * @access  Authentifié
 */
router.get('/avis', ctrl.mesAvis);

// ── Adresses ──────────────────────────────────────────────────────────────────

/**
 * @route   GET /api/profil/adresses
 * @desc    Lister ses adresses (adresse par défaut en premier)
 * @access  Authentifié
 */
router.get('/adresses', ctrl.listerAdresses);

/**
 * @route   POST /api/profil/adresses
 * @desc    Ajouter une adresse (si par_defaut=true, retire le statut des autres)
 * @access  Authentifié
 * @body    prenom, nom, rue (obligatoires) + complement, ville, pays, par_defaut
 */
router.post('/adresses', reglesAdresse, valider, ctrl.ajouterAdresse);

/**
 * @route   PUT /api/profil/adresses/:id
 * @desc    Modifier une adresse (mise à jour partielle)
 * @access  Authentifié (propriétaire uniquement)
 */
router.put(
  '/adresses/:id',
  param('id').isUUID().withMessage('ID adresse invalide.'),
  [
    body('prenom').optional().trim().isLength({ min: 2, max: 100 }),
    body('nom').optional().trim().isLength({ min: 2, max: 100 }),
    body('rue').optional().trim().isLength({ min: 5, max: 255 }),
    body('complement').optional({ nullable: true }).isLength({ max: 255 }),
    body('ville').optional().trim().isLength({ min: 2, max: 100 }),
    body('pays').optional().trim().isLength({ max: 100 }),
    body('par_defaut').optional().isBoolean().withMessage('par_defaut doit être un booléen.'),
  ],
  valider,
  ctrl.modifierAdresse,
);

/**
 * @route   DELETE /api/profil/adresses/:id
 * @desc    Supprimer une adresse (bloqué si référencée par une commande)
 * @access  Authentifié (propriétaire uniquement)
 */
router.delete(
  '/adresses/:id',
  param('id').isUUID().withMessage('ID adresse invalide.'),
  valider,
  ctrl.supprimerAdresse,
);

module.exports = router;