// src/routes/lookbook.routes.js
const express  = require('express');
const router   = express.Router();
const { authentifier, autoriser } = require('../middlewares/auth.middleware');
const ctrl = require('../controllers/lookbook.controller');

// ── Public ────────────────────────────────────────────────────────────────────

// GET /api/lookbook          — galerie publique (items visibles)
// GET /api/lookbook?tag=robes — filtrée par tag
router.get('/', ctrl.lister);

// ── Admin ─────────────────────────────────────────────────────────────────────

// GET    /api/lookbook/admin         — tous les items (visibles + masqués)
router.get('/admin',
  authentifier, autoriser('admin', 'moderateur'),
  ctrl.listerAdmin
);

// POST   /api/lookbook               — créer un item
router.post('/',
  authentifier, autoriser('admin', 'moderateur'),
  ctrl.creer
);

// PUT    /api/lookbook/:id           — modifier un item
router.put('/:id',
  authentifier, autoriser('admin', 'moderateur'),
  ctrl.modifier
);

// PATCH  /api/lookbook/reordonner    — réordonner plusieurs items
// IMPORTANT : doit être déclaré AVANT /:id pour ne pas être capturé comme un id
router.patch('/reordonner',
  authentifier, autoriser('admin'),
  ctrl.reordonner
);

// DELETE /api/lookbook/:id           — supprimer un item
router.delete('/:id',
  authentifier, autoriser('admin'),
  ctrl.supprimer
);

module.exports = router;
