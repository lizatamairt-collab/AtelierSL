// src/routes/newsletter.routes.js
const express = require('express');
const router  = express.Router();
// ✅ CORRECTION : le middleware exporte `authentifier` et `autoriser`, pas `authenticate`/`requireRole`
const { authentifier, autoriser } = require('../middlewares/auth.middleware');
const { abonner, desabonner, listerAbonnes } = require('../controllers/newsletter.controller');

// POST /api/newsletter/abonner
// Public — inscription (sans compte ou avec compte connecté)
router.post('/abonner', (req, res, next) => {
  // Authentification optionnelle : on essaie, mais on ne bloque pas si non connecté
  authentifier(req, res, (err) => {
    if (err) req.utilisateur = null;
    next();
  });
}, abonner);

// GET /api/newsletter/desabonner?token=xxx
// Public — désinscription via lien email
router.get('/desabonner', desabonner);

// GET /api/newsletter/abonnes  [Admin uniquement]
router.get('/abonnes', authentifier, autoriser('admin'), listerAbonnes);

module.exports = router;
