// src/utils/slug.js

/**
 * Génère un slug URL-friendly à partir d'un texte français.
 * ex: "Robe Kabyle Brodée" → "robe-kabyle-brodee"
 */
function slugifier(texte) {
  return texte
    .normalize('NFD')                        // décompose les accents
    .replace(/[\u0300-\u036f]/g, '')         // supprime les diacritiques
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')           // garde lettres, chiffres, espaces, tirets
    .replace(/\s+/g, '-')                    // espaces → tirets
    .replace(/-+/g, '-');                    // tirets multiples → un seul
}

module.exports = { slugifier };
