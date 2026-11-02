// src/index.js
// ⚠️  VERSION CORRIGÉE — CORS durci :
//   - FRONTEND_URL peut contenir plusieurs origines séparées par des virgules.
//   - En production, si FRONTEND_URL est absent → refus de toutes les origines
//     (au lieu de '*' qui annule la protection CORS avec credentials).
//   - En développement, fallback explicite sur localhost:5173 et localhost:4173.
require('dotenv').config();

const express    = require('express');
const helmet     = require('helmet');
const cors       = require('cors');
const rateLimit  = require('express-rate-limit');

const { getPool, verifierConnexion } = require('./config/db');
const authRoutes          = require('./routes/auth.routes');
const profilRoutes        = require('./routes/profil.routes');
const produitsRoutes      = require('./routes/produits.routes');
const commandesRoutes     = require('./routes/commandes.routes');
const panierRoutes        = require('./routes/panier.routes');
const utilisateursRoutes  = require('./routes/utilisateurs.routes');
const categoriesRoutes    = require('./routes/categories.routes');
const codesPromoRoutes    = require('./routes/codesPromo.routes');
const avisRoutes          = require('./routes/avis.routes');
const statistiquesRoutes  = require('./routes/statistiques.routes');
const contactRoutes       = require('./routes/contact.routes');
const adressesRoutes      = require('./routes/adresses.routes');
const favorisRoutes       = require('./routes/favoris.routes');
const newsletterRoutes       = require('./routes/newsletter.routes');
const notificationsRoutes    = require('./routes/notifications.routes');
const visitesRoutes          = require('./routes/visites.routes');
const lookbookRoutes         = require('./routes/lookbook.routes');
const paiementChargilyRoutes = require('./routes/paiementChargily.routes');
const journauxAdminRoutes    = require('./routes/journauxAdmin.routes');
const parametresRoutes       = require('./routes/parametres.routes');
const session  = require('express-session');
const passport = require('./config/passport');
const oauthRoutes = require('./routes/oauth.routes');


const app  = express();
const PORT = process.env.PORT || 3000;

// ────────────────────────────────────────────────────────────────────────
// Filet de sécurité global : sans ces gestionnaires, une erreur imprévue
// n'importe où dans le code (promesse rejetée non interceptée, exception
// hors d'un try/catch de route) fait planter tout le processus Node —
// donc TOUT le site (admin + client) pour TOUS les visiteurs en même
// temps, même si un seul utilisateur a déclenché le bug. On journalise
// l'erreur au lieu de laisser le process s'arrêter, pour que le serveur
// continue de répondre aux autres requêtes.
// ────────────────────────────────────────────────────────────────────────
process.on('unhandledRejection', (raison, promesse) => {
  console.error('❌  Promesse rejetée non interceptée :', raison);
});
process.on('uncaughtException', (err) => {
  console.error('❌  Exception non interceptée :', err);
});

const NODE_ENV = process.env.NODE_ENV || 'development';
const estProduction = NODE_ENV === 'production';

// Render/Railway/Fly.io terminent le HTTPS en amont et transmettent en HTTP en
// interne : sans ceci, Express croit que la connexion est en HTTP (req.secure
// = false), et les cookies "secure" (voir express-session plus bas) ne sont
// alors jamais envoyés au navigateur → connexion admin/session cassée en prod.
if (estProduction) app.set('trust proxy', 1);

// ── Configuration CORS sécurisée ──────────────────────────────────────────────
const originesAutorisees = (process.env.FRONTEND_URL || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const originesParDefautDev = [
  'http://localhost:5173',
  'http://localhost:4173',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:4173',
];

let corsOrigines;
if (originesAutorisees.length > 0) {
  corsOrigines = originesAutorisees;
} else if (estProduction) {
  corsOrigines = [];
  console.error('❌  CORS : FRONTEND_URL n\'est pas défini en production. Aucune origine ne sera autorisée.');
} else {
  corsOrigines = originesParDefautDev;
  console.warn('⚠️  CORS : FRONTEND_URL non défini — fallback sur localhost (dev uniquement).');
}

// Secret de session : aucune valeur par défaut publique. À défaut de SESSION_SECRET,
// un secret aléatoire est généré au démarrage (suffisant : la session ne sert qu'au
// callback OAuth, 10 minutes).
if (!process.env.SESSION_SECRET) {
  console.warn('⚠️  SESSION_SECRET non défini — secret aléatoire généré pour ce processus. Définissez-le dans .env.');
}
const SESSION_SECRET = process.env.SESSION_SECRET || require('crypto').randomBytes(32).toString('hex');

app.use(helmet());
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: estProduction,    // true en HTTPS seulement
    httpOnly: true,
    maxAge: 10 * 60 * 1000,  // 10 minutes — juste le temps du callback OAuth
  },
}));

app.use(passport.initialize());
app.use(passport.session());

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (corsOrigines.length === 0) {
      return callback(new Error('CORS désactivé : FRONTEND_URL non configuré.'));
    }
    if (corsOrigines.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error(`Origine non autorisée par CORS : ${origin}`));
  },
  credentials: true,
}));

// Limite globale : 1000 requêtes / 15 min par IP.
// ⚠️  Le webhook Chargily est exclu : ces requêtes viennent des serveurs de
//     Chargily (IP mutualisée entre tous leurs marchands), pas d'un client
//     individuel — les compter dans le même quota bloquerait des paiements
//     légitimes en cas de pic de commandes.
// (Relevé de 100 → 1000 : sur l'hébergement mutualisé Hostinger, le proxy
// interne peut faire apparaître plusieurs visiteurs distincts sous la même
// IP côté Express, ce qui vidait le quota de 100 en quelques secondes pour
// TOUT LE MONDE à la fois. Un panneau admin à lui seul déclenche facilement
// 15-20 requêtes par page (produits + catégories + stats + notifications...).)
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === '/api/paiements/chargily/webhook',
}));

// ── Parsers ───────────────────────────────────────────────────────────────────
// ⚠️  On capture le corps brut (req.rawBody) via l'option `verify` : c'est ce
//     que le webhook Chargily Pay utilise pour vérifier la signature HMAC
//     (voir src/services/chargily.service.js). Le JSON parsé reste disponible
//     normalement dans req.body pour toutes les routes.
app.use(express.json({
  limit: '10kb',
  verify: (req, _res, buf) => { req.rawBody = buf; },
}));
app.use(express.urlencoded({ extended: true }));

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/auth',          authRoutes);
app.use('/api/auth', oauthRoutes);
app.use('/api/profil',        profilRoutes);
app.use('/api/adresses',      adressesRoutes);
app.use('/api/produits',      produitsRoutes);
app.use('/api/commandes',     commandesRoutes);
app.use('/api/panier',        panierRoutes);
app.use('/api/utilisateurs',  utilisateursRoutes);
app.use('/api/categories',    categoriesRoutes);
app.use('/api/codes-promo',   codesPromoRoutes);
app.use('/api/avis',          avisRoutes);
app.use('/api/statistiques',  statistiquesRoutes);
app.use('/api/contact',       contactRoutes);
app.use('/api/favoris',       favorisRoutes);
app.use('/api/newsletter',    newsletterRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/visites',       visitesRoutes);
app.use('/api/lookbook',      lookbookRoutes);
app.use('/api/journaux-admin', journauxAdminRoutes);
app.use('/api/parametres',    parametresRoutes);
app.use('/api',               paiementChargilyRoutes); // /api/commandes/:id/paiement-chargily(...) + /api/paiements/chargily/webhook

// Healthcheck
app.get('/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date() }));

// 404
app.use((_req, res) => res.status(404).json({ message: 'Route introuvable.' }));

// Gestionnaire d'erreurs global
app.use((err, _req, res, _next) => {
  if (err && err.message && err.message.startsWith('Origine non autorisée')) {
    console.warn('CORS bloqué :', err.message);
    return res.status(403).json({ message: 'Origine non autorisée par CORS.' });
  }
  if (err && err.message && err.message.includes('CORS désactivé')) {
    console.error('CORS désactivé :', err.message);
    return res.status(500).json({ message: 'Configuration CORS manquante côté serveur.' });
  }
  console.error('Erreur non gérée :', err);
  res.status(500).json({ message: 'Erreur serveur interne.' });
});

// ── Démarrage ─────────────────────────────────────────────────────────────────
async function demarrer() {
  try {
    await verifierConnexion();
    app.listen(PORT, () => {
      console.log(`🚀  API démarrée sur http://localhost:${PORT}`);
      console.log(`📦  Environnement : ${NODE_ENV}`);
      if (corsOrigines.length > 0) {
        console.log(`🌐  CORS autorisé pour : ${corsOrigines.join(', ')}`);
      } else {
        console.log(`🌐  CORS : aucune origine autorisée (configurez FRONTEND_URL)`);
      }
    });
  } catch (err) {
    console.error('❌  Impossible de démarrer :', err.message);
    process.exit(1);
  }
}

demarrer();