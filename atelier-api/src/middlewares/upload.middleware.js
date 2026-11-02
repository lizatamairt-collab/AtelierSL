// src/middlewares/upload.middleware.js
const multer = require('multer');
const { storageProduits } = require('../config/cloudinary');

const TYPES_AUTORISES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];
const TAILLE_MAX      = 5 * 1024 * 1024; // 5 Mo

function filtreImages(req, file, cb) {
  if (!TYPES_AUTORISES.includes(file.mimetype)) {
    return cb(new Error('Format non supporté. Utilisez JPG, PNG, WEBP ou AVIF.'), false);
  }
  cb(null, true);
}

/**
 * Upload d'une seule image produit vers Cloudinary.
 * Champ attendu dans le formulaire : "image"
 */
const uploadImageProduit = multer({
  storage: storageProduits,
  limits:  { fileSize: TAILLE_MAX },
  fileFilter: filtreImages,
}).single('image');

/**
 * Wrapper Express : transforme les erreurs multer en réponse JSON propre.
 */
function gererUpload(req, res, next) {
  uploadImageProduit(req, res, (err) => {
    if (!err) return next();

    if (err instanceof multer.MulterError) {
      const messages = {
        LIMIT_FILE_SIZE: `Fichier trop volumineux (max 5 Mo).`,
        LIMIT_UNEXPECTED_FILE: `Champ de fichier inattendu. Utilisez le champ "image".`,
      };
      return res.status(400).json({ message: messages[err.code] || err.message });
    }
    // Erreur de type (fileFilter)
    return res.status(400).json({ message: err.message });
  });
}

module.exports = { gererUpload };
