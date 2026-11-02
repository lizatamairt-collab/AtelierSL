// src/middlewares/auth.middleware.js
const { verifyAccessToken } = require('../utils/jwt');

// Seul cet email peut exercer les droits admin.
// Valeur lue depuis .env (ADMIN_EMAIL) — jamais commitée en dur dans le code.
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').toLowerCase();

/**
 * Middleware : vérifie le JWT dans le header Authorization.
 * Injecte req.utilisateur si valide.
 */
function authentifier(req, res, next) {
  const header = req.headers['authorization'];
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Token manquant ou invalide.' });
  }

  const token = header.slice(7);
  try {
    req.utilisateur = verifyAccessToken(token);
    next();
  } catch (err) {
    const message = err.name === 'TokenExpiredError'
      ? 'Session expirée, veuillez vous reconnecter.'
      : 'Token invalide.';
    return res.status(401).json({ message });
  }
}

/**
 * Middleware : authentification OPTIONNELLE.
 * Si un JWT valide est fourni, req.utilisateur est renseigné (comme authentifier).
 * Sinon (pas de token, ou token invalide/expiré), la requête continue quand
 * même avec req.utilisateur = null → utilisée pour les routes accessibles
 * aux invités (ex: création de commande sans compte).
 */
function authentifierOptionnel(req, res, next) {
  const header = req.headers['authorization'];
  if (header && header.startsWith('Bearer ')) {
    try {
      req.utilisateur = verifyAccessToken(header.slice(7));
    } catch (err) {
      req.utilisateur = null;
    }
  } else {
    req.utilisateur = null;
  }
  next();
}

/**
 * Middleware : restreint l'accès à certains rôles.
 * Pour le rôle 'admin', vérifie aussi que l'email correspond à ADMIN_EMAIL.
 * @param  {...string} roles  ex: autoriser('admin', 'moderateur')
 */
function autoriser(...roles) {
  return (req, res, next) => {
    if (!req.utilisateur) {
      return res.status(401).json({ message: 'Non authentifié.' });
    }
    if (!roles.includes(req.utilisateur.role)) {
      return res.status(403).json({
        message: `Accès refusé. Rôle requis : ${roles.join(' ou ')}.`,
      });
    }
    // Garde supplémentaire : si la route exige admin, l'email doit correspondre exactement.
    if (req.utilisateur.role === 'admin') {
      if (req.utilisateur.email?.toLowerCase() !== ADMIN_EMAIL) {
        return res.status(403).json({
          message: 'Accès administrateur non autorisé pour cet email.',
        });
      }
    }
    next();
  };
}

module.exports = { authentifier, authentifierOptionnel, autoriser };