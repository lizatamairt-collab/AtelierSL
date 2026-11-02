// src/render.js
// Petites fonctions d'injection dans le template HTML — volontairement sans
// dépendance de parsing DOM (cheerio/jsdom) pour rester rapide côté serveur ;
// le template est stable (une seule ligne par balise ciblée), donc du regex
// ciblé sur "id=" est fiable et largement suffisant ici.

function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(str) {
  return escapeHtml(str);
}

/** Remplace la valeur d'un attribut sur la balise portant id="id". */
function setAttr(html, id, attrName, value) {
  if (value === undefined || value === null) return html;
  const re = new RegExp(`(<[^>]*\\bid="${id}"[^>]*\\b${attrName}=")[^"]*(")`, 's');
  if (re.test(html)) return html.replace(re, `$1${escapeAttr(value)}$2`);
  // fallback : l'attribut ciblé peut apparaître avant id="..." dans la balise
  const re2 = new RegExp(`(<[^>]*\\b${attrName}=")[^"]*("[^>]*\\bid="${id}")`, 's');
  return html.replace(re2, `$1${escapeAttr(value)}$2`);
}

/** Remplace le texte entre <title id="seoTitle">...</title>. */
function setTitle(html, value) {
  const re = /(<title id="seoTitle">)([^<]*)(<\/title>)/;
  return html.replace(re, `$1${escapeHtml(value)}$3`);
}

/** Remplace le JSON du bloc <script type="application/ld+json" id="ldPage">. */
function setJsonLd(html, dataOrArray) {
  const json = dataOrArray ? JSON.stringify(dataOrArray) : '';
  const re = /(<script type="application\/ld\+json" id="ldPage">)([\s\S]*?)(<\/script>)/;
  return html.replace(re, `$1${json}$3`);
}

/** Injecte du HTML à l'intérieur d'un conteneur vide <... id="containerId">...</TAG>. */
function injectInto(html, containerId, innerHtml) {
  const re = new RegExp(`(<div[^>]*\\bid="${containerId}"[^>]*>)([\\s\\S]*?)(<\\/div>)`);
  if (!re.test(html)) return html;
  // On ne remplace que la 1ʳᵉ occurrence (le conteneur cible), pas les <div> imbriqués.
  let replaced = false;
  return html.replace(re, (m, open, _inner, close) => {
    if (replaced) return m;
    replaced = true;
    return open + innerHtml + close;
  });
}

/** Applique titre + description + canonical + OG + Twitter en un appel. */
function applyMeta(html, { title, description, path, siteUrl, image, type }) {
  let out = html;
  if (title) {
    out = setTitle(out, title);
    out = setAttr(out, 'ogTitle', 'content', title);
    out = setAttr(out, 'twTitle', 'content', title);
  }
  if (description) {
    out = setAttr(out, 'seoDescription', 'content', description);
    out = setAttr(out, 'ogDesc', 'content', description);
    out = setAttr(out, 'twDesc', 'content', description);
  }
  const url = siteUrl.replace(/\/$/, '') + path;
  out = setAttr(out, 'seoCanonical', 'href', url);
  out = setAttr(out, 'ogUrl', 'content', url);
  out = setAttr(out, 'ogType', 'content', type || 'website');
  if (image) {
    out = setAttr(out, 'ogImage', 'content', image);
    out = setAttr(out, 'twImage', 'content', image);
  }
  return out;
}

/**
 * Insère des transformations Cloudinary (format + qualité auto, largeur max)
 * dans une URL d'upload Cloudinary, pour servir automatiquement du
 * WebP/AVIF compressé à une taille raisonnable au lieu du fichier original.
 * Ex: https://res.cloudinary.com/x/image/upload/v123/foo.jpg
 *  -> https://res.cloudinary.com/x/image/upload/f_auto,q_auto,w_800/v123/foo.jpg
 * N'a aucun effet sur une URL qui n'est pas une URL Cloudinary /upload/.
 */
function cloudinaryOptimize(url, { width } = {}) {
  if (!url || typeof url !== 'string') return url;
  const marker = '/image/upload/';
  const idx = url.indexOf(marker);
  if (idx === -1) return url;
  // Ne pas re-transformer une URL qui a déjà des transformations.
  const afterMarker = url.slice(idx + marker.length);
  if (/^[a-z]_[^/]+\//.test(afterMarker)) return url;
  const transform = `f_auto,q_auto${width ? `,w_${width}` : ''}`;
  return url.slice(0, idx + marker.length) + transform + '/' + afterMarker;
}

/**
 * Variante "responsive" de cloudinaryOptimize : génère un attribut srcset
 * avec plusieurs largeurs, pour que le navigateur télécharge une image
 * adaptée à sa taille d'affichage réelle (essentiel sur mobile, où les
 * images sont affichées 2 à 3× plus petites que sur bureau — servir la
 * même taille partout est la première cause d'un mauvais LCP mobile).
 * Retourne { src, srcset } ; src est la variante la plus grande (fallback
 * pour navigateurs sans support srcset, et pour og:image).
 */
function cloudinaryResponsive(url, widths) {
  if (!url || typeof url !== 'string') return { src: url, srcset: '' };
  const srcset = widths.map(w => `${cloudinaryOptimize(url, { width: w })} ${w}w`).join(', ');
  return { src: cloudinaryOptimize(url, { width: widths[widths.length - 1] }), srcset };
}

module.exports = { escapeHtml, escapeAttr, setAttr, setTitle, setJsonLd, injectInto, applyMeta, cloudinaryOptimize, cloudinaryResponsive };
