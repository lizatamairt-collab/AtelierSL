// src/middlewares/validate.middleware.js
const { validationResult } = require('express-validator');

/**
 * Intercepte les erreurs express-validator et renvoie une 422 propre.
 */
function valider(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({
      message: 'Données invalides.',
      erreurs: errors.array().map(e => ({ champ: e.path, message: e.msg })),
    });
  }
  next();
}

module.exports = { valider };
