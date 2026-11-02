// src/utils/jwt.js
const jwt = require('jsonwebtoken');

const ACCESS_SECRET  = process.env.JWT_SECRET;
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;

/**
 * Génère un access token (courte durée).
 */
function signAccessToken(payload) {
  return jwt.sign(payload, ACCESS_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
}

/**
 * Génère un refresh token (longue durée).
 */
function signRefreshToken(payload) {
  return jwt.sign(payload, REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
  });
}

/**
 * Vérifie un access token. Lève une erreur si invalide/expiré.
 */
function verifyAccessToken(token) {
  return jwt.verify(token, ACCESS_SECRET);
}

/**
 * Vérifie un refresh token.
 */
function verifyRefreshToken(token) {
  return jwt.verify(token, REFRESH_SECRET);
}

/**
 * Construit la réponse standard avec les deux tokens.
 */
function buildTokenResponse(utilisateur) {
  const payload = {
    sub:   utilisateur.id,
    email: utilisateur.email,
    role:  utilisateur.role,
  };

  return {
    access_token:  signAccessToken(payload),
    refresh_token: signRefreshToken(payload),
    token_type:    'Bearer',
    expires_in:    process.env.JWT_EXPIRES_IN || '7d',
    utilisateur: {
      id:             utilisateur.id,
      nom:            utilisateur.nom,
      prenom:         utilisateur.prenom,
      email:          utilisateur.email,
      role:           utilisateur.role,
      email_verifie:  utilisateur.email_verifie,
    },
  };
}

module.exports = {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  buildTokenResponse,
};
