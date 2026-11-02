// src/routes/contact.routes.js
const express  = require('express');
const router   = express.Router();
// ✅ CORRECTION : le middleware exporte `authentifier` et `autoriser`, pas `authenticate`/`requireRole`
const { authentifier, authentifierOptionnel, autoriser } = require('../middlewares/auth.middleware');
const { envoyer, listerMessages, majMessage, listerSujets, SUJETS } = require('../controllers/contact.controller');
const { body, validationResult } = require('express-validator');

// Middleware de validation du formulaire contact
const validerContact = [
  body('prenom').trim().notEmpty().isLength({ max: 100 }),
  body('nom').trim().notEmpty().isLength({ max: 100 }),
  body('email').isEmail().normalizeEmail(),
  body('sujet').isIn(SUJETS),
  body('message').trim().notEmpty().isLength({ min: 10, max: 5000 }),
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ erreurs: errors.array() });
    }
    next();
  },
];

// GET  /api/contact/sujets — liste publique des sujets
router.get('/sujets', listerSujets);

// POST /api/contact — envoi du formulaire (public, auth optionnelle)
router.post('/', authentifierOptionnel, validerContact, envoyer);

// GET  /api/contact/messages       [Admin] — liste des messages archivés
router.get('/messages', authentifier, autoriser('admin'), listerMessages);

// PATCH /api/contact/messages/:id  [Admin] — marquer lu / répondu
router.patch('/messages/:id', authentifier, autoriser('admin'), majMessage);

module.exports = router;