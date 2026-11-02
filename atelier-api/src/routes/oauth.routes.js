// src/routes/oauth.routes.js
// ─────────────────────────────────────────────────────────────────────────────
//  Routes OAuth — Google & Facebook
//
//  Flux complet :
//    GET /api/auth/google?returnTo=...          → redirige vers Google
//    GET /api/auth/google/callback               → Google renvoie ici → JWT → redirect frontend
//    GET /api/auth/facebook?returnTo=...          → redirige vers Facebook
//    GET /api/auth/facebook/callback              → idem
//
//  Le frontend récupère le JWT depuis l'URL :
//    http://<returnTo>/?oauth_token=xxx&oauth_user=yyy
//
//  ── Redirection dynamique (option B) ─────────────────────────────────────
//  Le frontend peut tourner sur plusieurs ports/origines en dev (Live Server
//  change parfois de port : 5500, 5501, 127.0.0.1 vs localhost...). On ne
//  fige donc plus l'origine de retour dans FRONTEND_URL : le frontend envoie
//  sa propre origine via ?returnTo=, elle est vérifiée contre la liste
//  blanche FRONTEND_URL (anti "open redirect"), puis transportée à travers
//  Google/Facebook via le paramètre OAuth standard `state`, et relue au
//  callback pour rediriger vers la bonne origine.
// ─────────────────────────────────────────────────────────────────────────────

const router   = require('express').Router();
const passport = require('../config/passport');
const { buildTokenResponse } = require('../utils/jwt');

// ─── Liste blanche des origines frontend autorisées ──────────────────────────
const FRONTEND_ORIGINS = (process.env.FRONTEND_URL || 'http://localhost:5500')
  .split(',')
  .map(s => s.trim().replace(/\/+$/, '')) // enlève un éventuel "/" final
  .filter(Boolean);
const DEFAULT_FRONTEND = FRONTEND_ORIGINS[0];

// ─── Valide qu'une origine demandée fait bien partie de la liste blanche,──────
// et conserve le CHEMIN de la page (pas juste l'origine) pour que la
// redirection finale ramène l'utilisateur exactement sur la page où il a
// cliqué (ex: /atelier_sl_client.html) et non sur la racine du dossier.
// (sécurité : sans la vérification de whitelist, `returnTo`/`state`
// deviendrait un open-redirect ; seul le CHEMIN, qui reste sur la même
// origine de confiance, n'a pas besoin d'être restreint)
function sanitizeReturnTo(candidate) {
  const fallback = `${DEFAULT_FRONTEND}/`;
  if (!candidate) return fallback;

  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    return fallback;
  }

  if (!FRONTEND_ORIGINS.includes(parsed.origin)) return fallback;

  const path = parsed.pathname && parsed.pathname !== '/' ? parsed.pathname : '/';
  return `${parsed.origin}${path}`;
}

// ─── Helper : construire l'URL de retour avec les tokens ─────────────────────
function buildRedirectURL(frontendTarget, user, isError = false, errorMsg = '') {
  const sep = frontendTarget.includes('?') ? '&' : '?';
  if (isError) {
    const msg = encodeURIComponent(errorMsg || 'Erreur de connexion OAuth.');
    return `${frontendTarget}${sep}oauth_error=${msg}`;
  }
  const tokens     = buildTokenResponse(user);
  const tokenParam = encodeURIComponent(tokens.access_token);
  const userParam  = encodeURIComponent(JSON.stringify(tokens.utilisateur));
  return `${frontendTarget}${sep}oauth_token=${tokenParam}&oauth_user=${userParam}`;
}

// ─── Lit le returnTo renvoyé par le fournisseur OAuth via `state` ────────────
function readReturnToFromState(req) {
  const raw = req.query.state;
  if (!raw) return DEFAULT_FRONTEND;
  try {
    return sanitizeReturnTo(decodeURIComponent(raw));
  } catch {
    return DEFAULT_FRONTEND;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  GOOGLE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @route  GET /api/auth/google
 * @desc   Lance le flux OAuth Google
 * @query  returnTo  Origine du frontend appelant (ex: http://127.0.0.1:5501),
 *                    doit figurer dans FRONTEND_URL sinon ignorée.
 */
router.get('/google', (req, res, next) => {
  const returnTo = sanitizeReturnTo(req.query.returnTo);
  passport.authenticate('google', {
    scope: ['profile', 'email'],
    session: true,
    state: encodeURIComponent(returnTo),
  })(req, res, next);
});

/**
 * @route  GET /api/auth/google/callback
 * @desc   Google redirige ici après authentification
 */
router.get('/google/callback',
  passport.authenticate('google', { session: true, failureRedirect: '/' }),
  (req, res) => {
    const frontendBase = readReturnToFromState(req);
    const url = buildRedirectURL(frontendBase, req.user);
    // Détruire la session après usage (on utilise JWT, pas de session persistante)
    req.session.destroy(() => res.redirect(url));
  }
);

// ─── En cas d'erreur Passport ─────────────────────────────────────────────────
router.use('/google/callback', (err, req, res, _next) => {
  console.error('Google OAuth error:', err.message);
  const frontendBase = readReturnToFromState(req);
  res.redirect(buildRedirectURL(frontendBase, null, true, err.message));
});

// ─────────────────────────────────────────────────────────────────────────────
//  FACEBOOK
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @route  GET /api/auth/facebook
 * @desc   Lance le flux OAuth Facebook
 * @query  returnTo  Origine du frontend appelant, voir /google ci-dessus.
 */
router.get('/facebook', (req, res, next) => {
  const returnTo = sanitizeReturnTo(req.query.returnTo);
  passport.authenticate('facebook', {
    scope: ['email'],
    session: true,
    state: encodeURIComponent(returnTo),
  })(req, res, next);
});

/**
 * @route  GET /api/auth/facebook/callback
 * @desc   Facebook redirige ici après authentification
 */
router.get('/facebook/callback',
  passport.authenticate('facebook', { session: true, failureRedirect: '/' }),
  (req, res) => {
    const frontendBase = readReturnToFromState(req);
    const url = buildRedirectURL(frontendBase, req.user);
    req.session.destroy(() => res.redirect(url));
  }
);

router.use('/facebook/callback', (err, req, res, _next) => {
  console.error('Facebook OAuth error:', err.message);
  const frontendBase = readReturnToFromState(req);
  res.redirect(buildRedirectURL(frontendBase, null, true, err.message));
});

module.exports = router;