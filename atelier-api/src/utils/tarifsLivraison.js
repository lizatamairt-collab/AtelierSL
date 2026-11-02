// src/utils/tarifsLivraison.js
// ══════════════════════════════════════════════════════════════════════════════
// Grille tarifaire de livraison — Yalidine Express, tarif [ECOMMERCE].
// Point de départ : Tizi Ouzou.
// Source : fiche tarifaire papier SPA Yalidine El Djazair Service.
//
// Clé = code wilaya sur 2 chiffres, exactement comme utilisé côté client
// (voir WILAYAS_DZ dans client/js/main.js). Montants en DZD.
//
// ⚠️ Si Yalidine change ses tarifs, il suffit de modifier les valeurs
//    ci-dessous (aucune autre partie du code n'a besoin d'être touchée).
// ══════════════════════════════════════════════════════════════════════════════

const TARIFS_LIVRAISON = {
  '01': { nom: 'Adrar',               zone: 4, delai: 5, domicile: 1050, stopdesk: 850  },
  '02': { nom: 'Chlef',               zone: 2, delai: 1, domicile: 900,  stopdesk: 650  },
  '03': { nom: 'Laghouat',            zone: 3, delai: 2, domicile: 950,  stopdesk: 750  },
  '04': { nom: 'Oum El Bouaghi',      zone: 2, delai: 1, domicile: 900,  stopdesk: 650  },
  '05': { nom: 'Batna',               zone: 2, delai: 1, domicile: 900,  stopdesk: 650  },
  '06': { nom: 'Béjaïa',              zone: 1, delai: 1, domicile: 700,  stopdesk: 550  },
  '07': { nom: 'Biskra',              zone: 3, delai: 1, domicile: 950,  stopdesk: 750  },
  '08': { nom: 'Béchar',              zone: 4, delai: 4, domicile: 1050, stopdesk: 850  },
  '09': { nom: 'Blida',               zone: 2, delai: 1, domicile: 900,  stopdesk: 650  },
  '10': { nom: 'Bouira',              zone: 1, delai: 1, domicile: 700,  stopdesk: 550  },
  '11': { nom: 'Tamanrasset',         zone: 5, delai: 5, domicile: 1600, stopdesk: 1400 },
  '12': { nom: 'Tébessa',             zone: 3, delai: 1, domicile: 950,  stopdesk: 750  },
  '13': { nom: 'Tlemcen',             zone: 2, delai: 1, domicile: 900,  stopdesk: 650  },
  '14': { nom: 'Tiaret',              zone: 2, delai: 1, domicile: 900,  stopdesk: 650  },
  '15': { nom: 'Tizi Ouzou',          zone: 0, delai: 1, domicile: 590,  stopdesk: 450  },
  '16': { nom: 'Alger',               zone: 1, delai: 1, domicile: 700,  stopdesk: 550  },
  '17': { nom: 'Djelfa',              zone: 3, delai: 2, domicile: 950,  stopdesk: 750  },
  '18': { nom: 'Jijel',               zone: 2, delai: 1, domicile: 900,  stopdesk: 650  },
  '19': { nom: 'Sétif',               zone: 2, delai: 1, domicile: 900,  stopdesk: 650  },
  '20': { nom: 'Saïda',               zone: 2, delai: 1, domicile: 900,  stopdesk: 650  },
  '21': { nom: 'Skikda',              zone: 2, delai: 1, domicile: 900,  stopdesk: 650  },
  '22': { nom: 'Sidi Bel Abbès',      zone: 2, delai: 1, domicile: 900,  stopdesk: 650  },
  '23': { nom: 'Annaba',              zone: 2, delai: 1, domicile: 900,  stopdesk: 650  },
  '24': { nom: 'Guelma',              zone: 2, delai: 1, domicile: 900,  stopdesk: 650  },
  '25': { nom: 'Constantine',         zone: 2, delai: 1, domicile: 900,  stopdesk: 650  },
  '26': { nom: 'Médéa',               zone: 2, delai: 1, domicile: 900,  stopdesk: 650  },
  '27': { nom: 'Mostaganem',          zone: 2, delai: 1, domicile: 900,  stopdesk: 650  },
  '28': { nom: "M'Sila",              zone: 2, delai: 1, domicile: 900,  stopdesk: 650  },
  '29': { nom: 'Mascara',             zone: 2, delai: 1, domicile: 900,  stopdesk: 650  },
  '30': { nom: 'Ouargla',             zone: 3, delai: 2, domicile: 950,  stopdesk: 750  },
  '31': { nom: 'Oran',                zone: 2, delai: 1, domicile: 900,  stopdesk: 650  },
  '32': { nom: 'El Bayadh',           zone: 4, delai: 3, domicile: 1050, stopdesk: 850  },
  '33': { nom: 'Illizi',              zone: 5, delai: 6, domicile: 1600, stopdesk: 1400 },
  '34': { nom: 'Bordj Bou Arreridj',  zone: 2, delai: 1, domicile: 900,  stopdesk: 650  },
  '35': { nom: 'Boumerdès',           zone: 1, delai: 1, domicile: 700,  stopdesk: 550  },
  '36': { nom: 'El Tarf',             zone: 2, delai: 1, domicile: 900,  stopdesk: 650  },
  '37': { nom: 'Tindouf',             zone: 5, delai: 5, domicile: 1600, stopdesk: 1400 },
  '38': { nom: 'Tissemsilt',          zone: 2, delai: 1, domicile: 900,  stopdesk: 650  },
  '39': { nom: 'El Oued',             zone: 3, delai: 1, domicile: 950,  stopdesk: 750  },
  '40': { nom: 'Khenchela',           zone: 2, delai: 1, domicile: 900,  stopdesk: 650  },
  '41': { nom: 'Souk Ahras',          zone: 2, delai: 1, domicile: 900,  stopdesk: 650  },
  '42': { nom: 'Tipaza',              zone: 2, delai: 1, domicile: 900,  stopdesk: 650  },
  '43': { nom: 'Mila',                zone: 2, delai: 1, domicile: 900,  stopdesk: 650  },
  '44': { nom: 'Aïn Defla',           zone: 2, delai: 1, domicile: 900,  stopdesk: 650  },
  '45': { nom: 'Naâma',               zone: 4, delai: 3, domicile: 1050, stopdesk: 850  },
  '46': { nom: 'Aïn Témouchent',      zone: 2, delai: 1, domicile: 900,  stopdesk: 650  },
  '47': { nom: 'Ghardaïa',            zone: 3, delai: 2, domicile: 950,  stopdesk: 750  },
  '48': { nom: 'Relizane',            zone: 2, delai: 1, domicile: 900,  stopdesk: 650  },
  '49': { nom: 'Timimoun',            zone: 4, delai: 5, domicile: 1050, stopdesk: 850  },
  '50': { nom: 'Bordj Badji Mokhtar', zone: 4, delai: 5, domicile: 1050, stopdesk: 850  },
  '51': { nom: 'Ouled Djellal',       zone: 3, delai: 1, domicile: 950,  stopdesk: 750  },
  '52': { nom: 'Béni Abbès',          zone: 4, delai: 4, domicile: 1050, stopdesk: 850  },
  '53': { nom: 'In Salah',            zone: 5, delai: 5, domicile: 1600, stopdesk: 1400 },
  '54': { nom: 'In Guezzam',          zone: 5, delai: 5, domicile: 1600, stopdesk: 1400 },
  '55': { nom: 'Touggourt',           zone: 3, delai: 2, domicile: 950,  stopdesk: 750  },
  '56': { nom: 'Djanet',              zone: 5, delai: 6, domicile: 1600, stopdesk: 1400 },
  '57': { nom: "El M'Ghair",          zone: 3, delai: 1, domicile: 950,  stopdesk: 750  },
  '58': { nom: 'El Menia',            zone: 4, delai: 5, domicile: 1050, stopdesk: 850  },
};

// Tarif appliqué si le code wilaya est absent/inconnu (ancien flux, ou
// codes hérités du sélecteur front qui ne correspondent pas à une wilaya
// officielle — ex. anciennes daïras listées au-delà du code 58).
const FRAIS_LIVRAISON_PAR_DEFAUT = 900;

/**
 * Fusionne une éventuelle grille personnalisée (éditée depuis le panneau
 * admin, stockée en JSON dans parametres_site.tarifs_livraison_json) avec la
 * grille par défaut. Seuls domicile/stopdesk peuvent être surchargés ; zone,
 * délai et nom restent ceux de la grille par défaut.
 * @param {string|object|null} overrideJson  JSON (string) ou objet déjà parsé
 * @returns {object} grille fusionnée, même forme que TARIFS_LIVRAISON
 */
function fusionnerTarifs(overrideJson) {
  if (!overrideJson) return TARIFS_LIVRAISON;

  let override = overrideJson;
  if (typeof overrideJson === 'string') {
    try { override = JSON.parse(overrideJson); } catch { return TARIFS_LIVRAISON; }
  }
  if (!override || typeof override !== 'object') return TARIFS_LIVRAISON;

  const fusion = {};
  for (const code of Object.keys(TARIFS_LIVRAISON)) {
    const base = TARIFS_LIVRAISON[code];
    const surcharge = override[code];
    fusion[code] = surcharge
      ? {
          ...base,
          domicile: Number.isFinite(+surcharge.domicile) ? +surcharge.domicile : base.domicile,
          stopdesk: Number.isFinite(+surcharge.stopdesk) ? +surcharge.stopdesk : base.stopdesk,
        }
      : base;
  }
  return fusion;
}

/**
 * Calcule le frais de livraison (avant remise / seuil gratuit) pour une
 * wilaya et un type de livraison donnés.
 * @param {string} wilayaCode  code à 2 chiffres, ex. "16" pour Alger
 * @param {string} typeLivraison 'domicile' (défaut) ou 'stopdesk'
 * @param {string|object|null} [overrideJson]  grille personnalisée (admin), optionnelle
 * @returns {number} montant en DZD
 */
function calculerFraisLivraison(wilayaCode, typeLivraison, overrideJson) {
  const grille = fusionnerTarifs(overrideJson);
  const code = String(wilayaCode || '').padStart(2, '0');
  const tarif = grille[code];
  if (!tarif) return FRAIS_LIVRAISON_PAR_DEFAUT;
  return typeLivraison === 'stopdesk' ? tarif.stopdesk : tarif.domicile;
}

module.exports = { TARIFS_LIVRAISON, FRAIS_LIVRAISON_PAR_DEFAUT, fusionnerTarifs, calculerFraisLivraison };