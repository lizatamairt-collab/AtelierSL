// src/config/cloudinary.js
const cloudinary            = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

/**
 * Stockage Cloudinary pour les images produits.
 * Dossier : boutique-kabyle/produits/<produit_id>
 * Format  : webp (compression automatique)
 */
const storageProduits = new CloudinaryStorage({
  cloudinary,
  params: (req, file) => ({
    folder:         `boutique-kabyle/produits/${req.params.id}`,
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp', 'avif'],
    transformation: [{ width: 1200, height: 1200, crop: 'limit', quality: 'auto', fetch_format: 'webp' }],
    public_id: `${Date.now()}-${file.originalname.replace(/\.[^/.]+$/, '').replace(/\s+/g, '-')}`,
  }),
});

module.exports = { cloudinary, storageProduits };
