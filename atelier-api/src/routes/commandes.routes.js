// src/routes/commandes.routes.js
const router = require('express').Router();
const { body, param, query } = require('express-validator');

const ctrl         = require('../controllers/commandes.controller'); // genererFacture inclus
const { valider }  = require('../middlewares/validate.middleware');
const { authentifier, authentifierOptionnel, autoriser } = require('../middlewares/auth.middleware');

const STATUTS           = ['en_attente', 'confirmee', 'en_preparation', 'expediee', 'livree', 'annulee', 'remboursee'];
const STATUTS_PAIEMENT  = ['en_attente', 'reussi', 'echoue', 'rembourse'];
const METHODES_PAIEMENT = ['carte', 'a_la_livraison', 'virement', 'edahabia', 'cib', 'a_convenir_france'];

// ── Règles de validation ──────────────────────────────────────────────────────

const reglesListage = [
  query('page').optional().isInt({ min: 1 }),
  query('limite').optional().isInt({ min: 1, max: 50 }),
  query('statut').optional().isIn(STATUTS).withMessage('Statut invalide.'),
  query('utilisateur_id').optional().isUUID(),
  query('tri').optional().isIn(['created_at', 'total', 'statut', 'numero']),
  query('ordre').optional().isIn(['ASC', 'DESC', 'asc', 'desc']),
];

const reglesCreation = [
  // adresse_id (client connecté, adresse déjà enregistrée) OU adresse inline (invité) — vérifié dans le contrôleur
  body('adresse_id')
    .optional({ nullable: true })
    .isUUID().withMessage('adresse_id invalide.'),
  body('adresse')
    .optional({ nullable: true })
    .isObject().withMessage('adresse doit être un objet.'),
  body('adresse.prenom').if(body('adresse').exists()).trim().isLength({ min: 2, max: 100 }).withMessage('Le prénom est obligatoire.'),
  body('adresse.nom').if(body('adresse').exists()).trim().isLength({ min: 2, max: 100 }).withMessage('Le nom est obligatoire.'),
  body('adresse.rue').if(body('adresse').exists()).trim().isLength({ min: 5, max: 255 }).withMessage('L\'adresse est obligatoire.'),
  body('adresse.ville').if(body('adresse').exists()).trim().isLength({ min: 2, max: 100 }).withMessage('La ville est obligatoire.'),
  body('email')
    .optional({ nullable: true }).trim()
    .isEmail().withMessage('E-mail invalide.'),
  body('telephone')
    .optional({ nullable: true }).trim()
    .isLength({ max: 30 }).withMessage('Téléphone trop long.'),
  body('code_promo')
    .optional({ nullable: true }).trim()
    .isLength({ max: 50 }).withMessage('code_promo trop long.'),
  body('note_client')
    .optional({ nullable: true })
    .isLength({ max: 2000 }).withMessage('note_client ne peut pas dépasser 2000 caractères.'),
  body('methode_paiement')
    .optional().isIn(METHODES_PAIEMENT).withMessage('Méthode de paiement invalide.'),
  // date_evenement par ligne (objet variante_id → date)
  body('dates_evenement')
    .optional({ nullable: true })
    .isObject().withMessage('dates_evenement doit être un objet {variante_id: "YYYY-MM-DD"}.'),
];

const reglesStatut = [
  body('statut')
    .notEmpty().withMessage('statut est obligatoire.')
    .isIn(STATUTS).withMessage('Statut invalide.'),
];

const reglesPaiement = [
  body('methode')
    .notEmpty().withMessage('methode est obligatoire.')
    .isLength({ max: 50 }).withMessage('methode trop longue.'),
  body('transaction_id')
    .optional({ nullable: true })
    .isLength({ max: 255 }).withMessage('transaction_id trop long.'),
  body('statut')
    .optional().isIn(STATUTS_PAIEMENT).withMessage('Statut de paiement invalide.'),
  body('montant')
    .notEmpty().withMessage('montant est obligatoire.')
    .isFloat({ min: 0.01 }).withMessage('montant doit être un nombre positif.'),
  body('devise')
    .optional().isLength({ min: 3, max: 3 }).withMessage('devise doit faire 3 caractères (ex: DZD).'),
];

const reglesPaiementMaj = [
  body('statut').optional().isIn(STATUTS_PAIEMENT).withMessage('Statut de paiement invalide.'),
  body('transaction_id').optional({ nullable: true }).isLength({ max: 255 }),
];

// ── Routes ────────────────────────────────────────────────────────────────────

/**
 * @route   GET /api/commandes
 * @desc    Lister mes commandes (client) ou toutes les commandes (admin/modérateur)
 * @access  Authentifié
 * @query   page, limite, statut, numero, utilisateur_id (admin), tri, ordre
 */
router.get('/', authentifier, reglesListage, valider, ctrl.lister);

/**
 * @route   GET /api/commandes/dashboard
 * @desc    Tableau de bord des ventes (chiffre d'affaires / commandes par jour)
 * @access  Admin
 */
router.get(
  '/dashboard',
  authentifier,
  autoriser('admin'),
  [
    query('date_debut').optional().isISO8601().withMessage('date_debut invalide.'),
    query('date_fin').optional().isISO8601().withMessage('date_fin invalide.'),
  ],
  valider,
  ctrl.dashboard,
);

/**
 * @route   GET /api/commandes/:id
 * @desc    Obtenir une commande complète (avec lignes et paiements)
 * @access  Propriétaire ou Admin/Modérateur
 */
router.get(
  '/:id',
  authentifier,
  param('id').isUUID().withMessage('ID commande invalide.'),
  valider,
  ctrl.obtenir,
);

/**
 * @route   POST /api/commandes
 * @desc    Créer une commande à partir du panier (utilisateur connecté OU invité via x-session-id)
 * @access  Public (authentifié ou invité)
 * @body    Client connecté : adresse_id (adresse enregistrée)
 *          Invité          : adresse {prenom,nom,rue,ville,pays?}, email, telephone
 *          + code_promo, note_client, methode_paiement, dates_evenement (tous deux cas)
 */
router.post(
  '/',
  authentifierOptionnel,
  reglesCreation,
  valider,
  ctrl.creer,
);

/**
 * @route   PATCH /api/commandes/:id/statut
 * @desc    Changer le statut d'une commande (suit la machine à états du schéma)
 * @access  Admin
 */
router.patch(
  '/:id/statut',
  authentifier,
  autoriser('admin'),
  param('id').isUUID().withMessage('ID commande invalide.'),
  reglesStatut,
  valider,
  ctrl.changerStatut,
);

/**
 * @route   POST /api/commandes/:id/annuler
 * @desc    Annuler une commande (client propriétaire ou admin) ; recrédite le
 *          stock si celui-ci avait déjà été décrémenté
 * @access  Propriétaire ou Admin/Modérateur
 */
router.post(
  '/:id/annuler',
  authentifier,
  param('id').isUUID().withMessage('ID commande invalide.'),
  valider,
  ctrl.annuler,
);

// ── Paiements ─────────────────────────────────────────────────────────────────

/**
 * @route   POST /api/commandes/:id/paiements
 * @desc    Enregistrer un paiement pour une commande (confirme la commande si "reussi")
 * @access  Admin
 */
router.post(
  '/:id/paiements',
  authentifier,
  autoriser('admin'),
  param('id').isUUID().withMessage('ID commande invalide.'),
  reglesPaiement,
  valider,
  ctrl.ajouterPaiement,
);

/**
 * @route   PATCH /api/commandes/:id/paiements/:paiementId
 * @desc    Mettre à jour le statut d'un paiement (confirme la commande si "reussi")
 * @access  Admin
 */
router.patch(
  '/:id/paiements/:paiementId',
  authentifier,
  autoriser('admin'),
  param('id').isUUID().withMessage('ID commande invalide.'),
  param('paiementId').isUUID().withMessage('ID paiement invalide.'),
  reglesPaiementMaj,
  valider,
  ctrl.modifierPaiement,
);


/**
 * @route   GET /api/commandes/:id/facture
 * @desc    Télécharger la facture PDF d'une commande
 * @access  Propriétaire ou Admin/Modérateur
 */
router.get(
  '/:id/facture',
  authentifier,
  param('id').isUUID().withMessage('ID commande invalide.'),
  valider,
  ctrl.genererFacture,
);

module.exports = router;