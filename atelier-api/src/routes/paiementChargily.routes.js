// src/routes/paiementChargily.routes.js
const router = require('express').Router();
const { body, param } = require('express-validator');

const ctrl         = require('../controllers/paiementChargily.controller');
const { valider }  = require('../middlewares/validate.middleware');
const { authentifierOptionnel } = require('../middlewares/auth.middleware');

/**
 * @route   POST /api/commandes/:id/paiement-chargily
 * @desc    Crée un checkout Chargily (CIB/EDAHABIA) pour une commande en attente
 * @access  Propriétaire de la commande (connecté) OU invité (commande sans
 *          utilisateur_id, accessible via son UUID non devinable)
 *
 *          FIX : cette route utilisait `authentifier` (JWT obligatoire), ce
 *          qui bloquait systématiquement les commandes invité (guest checkout)
 *          avec l'erreur "Token manquant ou invalide." avant même d'atteindre
 *          Chargily. `authentifierOptionnel` laisse passer la requête avec
 *          req.utilisateur = null si aucun token n'est fourni ; la
 *          vérification de propriétaire se fait maintenant dans le
 *          contrôleur (voir paiementChargily.controller.js).
 */
router.post(
  '/commandes/:id/paiement-chargily',
  authentifierOptionnel,
  param('id').isUUID().withMessage('ID commande invalide.'),
  body('methode').optional().isIn(['edahabia', 'cib']).withMessage('methode invalide.'),
  valider,
  ctrl.creerCheckout,
);

/**
 * @route   GET /api/commandes/:id/paiement-chargily/verifier
 * @desc    Filet de sécurité — re-vérifie l'état du paiement auprès de Chargily
 * @access  Propriétaire de la commande (connecté), invité, ou Admin/Modérateur
 *
 *          FIX : même correctif que ci-dessus — un client invité doit aussi
 *          pouvoir déclencher cette vérification manuelle (utile en dev
 *          local où le webhook Chargily ne peut pas atteindre localhost).
 */
router.get(
  '/commandes/:id/paiement-chargily/verifier',
  authentifierOptionnel,
  param('id').isUUID().withMessage('ID commande invalide.'),
  valider,
  ctrl.verifierCheckout,
);

/**
 * @route   POST /api/paiements/chargily/webhook
 * @desc    Endpoint public appelé par Chargily Pay pour notifier un paiement
 * @access  Public (protégé par vérification de signature HMAC, pas par JWT)
 */
router.post('/paiements/chargily/webhook', ctrl.webhook);

module.exports = router;