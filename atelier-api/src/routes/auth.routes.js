// src/routes/auth.routes.js
const router  = require('express').Router();
const { body, query } = require('express-validator');
const rateLimit = require('express-rate-limit');

const ctrl     = require('../controllers/auth.controller');
const { valider }       = require('../middlewares/validate.middleware');
const { authentifier }  = require('../middlewares/auth.middleware');

// ── Rate limiters ─────────────────────────────────────────────────────────────

/** Limite stricte pour la connexion (anti brute-force) */
const limiterConnexion = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: { message: 'Trop de tentatives. Réessayez dans 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

/** Limite souple pour les inscriptions */
const limiterInscription = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 heure
  max: 5,
  message: { message: 'Trop d\'inscriptions depuis cette IP. Réessayez plus tard.' },
});

// ── Règles de validation ──────────────────────────────────────────────────────

const reglesInscription = [
  body('nom')
    .trim().notEmpty().withMessage('Le nom est obligatoire.')
    .isLength({ max: 100 }).withMessage('Le nom ne peut pas dépasser 100 caractères.'),
  body('prenom')
    .trim().notEmpty().withMessage('Le prénom est obligatoire.')
    .isLength({ max: 100 }).withMessage('Le prénom ne peut pas dépasser 100 caractères.'),
  body('email')
    .trim().notEmpty().withMessage('L\'email est obligatoire.')
    .isEmail().withMessage('Format d\'email invalide.')
    .isLength({ max: 255 }),
  body('mot_de_passe')
    .notEmpty().withMessage('Le mot de passe est obligatoire.')
    .isLength({ min: 8 }).withMessage('Le mot de passe doit contenir au moins 8 caractères.')
    .matches(/[A-Z]/).withMessage('Le mot de passe doit contenir au moins une majuscule.')
    .matches(/[0-9]/).withMessage('Le mot de passe doit contenir au moins un chiffre.'),
  body('telephone')
    .optional({ nullable: true })
    .isMobilePhone().withMessage('Numéro de téléphone invalide.'),
];

const reglesConnexion = [
  body('email')
    .trim().notEmpty().withMessage('L\'email est obligatoire.')
    .isEmail().withMessage('Format d\'email invalide.'),
  body('mot_de_passe')
    .notEmpty().withMessage('Le mot de passe est obligatoire.'),
];

const reglesMotDePasseOublie = [
  body('email')
    .trim().notEmpty().withMessage('L\'email est obligatoire.')
    .isEmail().withMessage('Format d\'email invalide.'),
];

const reglesReinitialisation = [
  body('token')
    .notEmpty().withMessage('Token manquant.'),
  body('nouveau_mot_de_passe')
    .notEmpty().withMessage('Le nouveau mot de passe est obligatoire.')
    .isLength({ min: 8 }).withMessage('Le mot de passe doit contenir au moins 8 caractères.')
    .matches(/[A-Z]/).withMessage('Le mot de passe doit contenir au moins une majuscule.')
    .matches(/[0-9]/).withMessage('Le mot de passe doit contenir au moins un chiffre.'),
];

// ── Routes ────────────────────────────────────────────────────────────────────

/**
 * @route   POST /api/auth/inscription
 * @desc    Créer un nouveau compte utilisateur
 * @access  Public
 */
router.post(
  '/inscription',
  limiterInscription,
  reglesInscription,
  valider,
  ctrl.inscription,
);

/**
 * @route   POST /api/auth/connexion
 * @desc    Authentifier un utilisateur et retourner un JWT
 * @access  Public
 */
router.post(
  '/connexion',
  limiterConnexion,
  reglesConnexion,
  valider,
  ctrl.connexion,
);

/**
 * @route   GET /api/auth/verify-email?token=xxx
 * @desc    Vérifier l'email après inscription
 * @access  Public
 */
router.get(
  '/verify-email',
  query('token').notEmpty().withMessage('Token manquant.'),
  valider,
  ctrl.verifierEmail,
);

/**
 * @route   POST /api/auth/refresh
 * @desc    Renouveler l'access token via le refresh token
 * @access  Public
 */
router.post(
  '/refresh',
  body('refresh_token').notEmpty().withMessage('Refresh token manquant.'),
  valider,
  ctrl.refreshToken,
);

/**
 * @route   POST /api/auth/mot-de-passe-oublie
 * @desc    Envoyer un email de réinitialisation du mot de passe
 * @access  Public
 */
router.post(
  '/mot-de-passe-oublie',
  reglesMotDePasseOublie,
  valider,
  ctrl.motDePasseOublie,
);

/**
 * @route   POST /api/auth/reinitialiser-mot-de-passe
 * @desc    Réinitialiser le mot de passe avec le token reçu par email
 * @access  Public
 */
router.post(
  '/reinitialiser-mot-de-passe',
  reglesReinitialisation,
  valider,
  ctrl.reinitialiserMotDePasse,
);

/**
 * @route   GET /api/auth/moi
 * @desc    Récupérer le profil de l'utilisateur connecté
 * @access  Privé (JWT requis)
 */
router.get(
  '/moi',
  authentifier,
  ctrl.moi,
);

module.exports = router;
