// src/server.js
//
// Serveur de pré-rendu (SSR-lite) pour le SPA Atelier S.L.
//
// Ce que ça fait :
//  - Sert le même fichier HTML que le SPA statique (atelier_sl_client.html),
//    MAIS avant de l'envoyer, pour les routes connues (accueil, catalogue,
//    catégorie, produit) il :
//      1) va chercher les vraies données via l'API JSON existante,
//      2) remplace <title>, meta description, canonical, Open Graph,
//         Twitter Card et le JSON-LD (Organization/Product/BreadcrumbList),
//      3) injecte un vrai extrait HTML du contenu (nom produit, prix,
//         description, cartes produits...) directement dans le HTML envoyé.
//  - Le JS du SPA s'exécute ensuite normalement par-dessus (hydratation) :
//    rien ne change pour l'utilisateur, tout continue à marcher en SPA.
//  - Toute route inconnue reçoit quand même le HTML (200), pour que le
//    routing client (pushState) fonctionne aussi en arrivée directe/refresh.
//
// Ce serveur remplace l'hébergement statique + les règles de rewrite SPA
// évoquées précédemment (Vercel/Netlify/Nginx) : il fait les deux à la fois.
//
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const compression = require('compression');

const { apiGet } = require('./api');
const { applyMeta, setJsonLd, injectInto, escapeHtml, setAttr, cloudinaryOptimize, cloudinaryResponsive } = require('./render');

const PORT = process.env.PORT || 8080;
const API_URL = process.env.API_URL || 'http://localhost:3000/api';
const SITE_URL = (process.env.SITE_URL || 'https://example.com').replace(/\/$/, '');

// ────────────────────────────────────────────────────────────
// Arborescence attendue au déploiement (structure "à plat", pour
// être compatible avec un déploiement Node.js par upload de .zip
// où package.json doit se trouver à la racine de l'app) :
//
//   / (racine de l'app Node déployée)
//   ├── package.json
//   ├── src/            ← ce serveur (src/server.js est ici)
//   ├── client/
//   │   ├── index.html
//   │   ├── css/main.css
//   │   └── js/main.js
//   └── admin/
//       ├── index.html
//       ├── css/main.css
//       └── js/main.js
//
// CLIENT_DIR / ADMIN_DIR restent surchageables via variables
// d'environnement si une autre disposition est utilisée.
// ────────────────────────────────────────────────────────────
const SITE_ROOT = path.join(__dirname, '..');
const CLIENT_DIR = process.env.CLIENT_DIR || path.join(SITE_ROOT, 'client');
const ADMIN_DIR  = process.env.ADMIN_DIR  || path.join(SITE_ROOT, 'admin');

const CLIENT_HTML_PATH = process.env.CLIENT_HTML_PATH
  || path.join(CLIENT_DIR, 'index.html');

const TEMPLATE_RAW = fs.readFileSync(CLIENT_HTML_PATH, 'utf-8');

// Cache-busting : un hash court du contenu de main.css/main.js est ajouté en
// ?v=... sur leurs <link>/<script>. Ça permet d'allonger la durée de cache
// navigateur (voir STATIC_OPTS plus bas) sans risquer de servir du JS/CSS
// périmé après un déploiement — le hash change dès que le fichier change,
// donc l'URL change, donc le navigateur va rechercher la nouvelle version.
const crypto = require('crypto');
function fileHash(p) {
  try { return crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex').slice(0, 8); }
  catch { return Date.now().toString(36); }
}
const CSS_VERSION = fileHash(path.join(CLIENT_DIR, 'css', 'main.css'));
const JS_VERSION  = fileHash(path.join(CLIENT_DIR, 'js', 'main.js'));
const TEMPLATE = TEMPLATE_RAW
  .replace('/css/main.css', `/css/main.css?v=${CSS_VERSION}`)
  .replace('/js/main.js', `/js/main.js?v=${JS_VERSION}`);

const app = express();
app.set('trust proxy', 1); // Render/Railway/Fly.io terminent le HTTPS en amont

// Compresse (gzip/brotli) toutes les réponses HTML/CSS/JS/JSON — le HTML
// pré-rendu comme les fichiers statiques ci-dessous. Gain typique : -70%
// sur du texte (main.js/main.css), sans rien changer côté client.
app.use(compression());

// CSS/JS du site client, servis à la racine (/css/main.css, /js/main.js) car
// le HTML pré-rendu est renvoyé sur des routes de profondeurs différentes
// (/, /catalogue, /produit/xyz...) — des chemins relatifs casseraient sur
// ces routes profondes, d'où des chemins absolus dans le HTML + ce mapping.
// maxAge : mis en cache navigateur/CDN 1 jour ; renommez le fichier (ou
// ajoutez un ?v=) lors d'un déploiement si vous voulez forcer le rechargement
// immédiat chez les visiteurs.
const STATIC_OPTS = { maxAge: '30d', etag: true, immutable: true };
app.use('/css', express.static(path.join(CLIENT_DIR, 'css'), STATIC_OPTS));
app.use('/js',  express.static(path.join(CLIENT_DIR, 'js'), STATIC_OPTS));

// Panneau admin : simple SPA statique, aucun pré-rendu SEO nécessaire
// (page non destinée à être indexée). Servi sous /admin, protégé par la
// connexion admin gérée côté auth-api — pas de contenu sensible exposé ici,
// juste la coquille HTML/CSS/JS.
app.use('/admin', express.static(ADMIN_DIR));

const STATIC_PAGE_META = {
  '/catalogue-only-fallback': null, // placeholder, non utilisé
};
const PAGE_TITLES = {
  '/galerie': ['Lookbook — Atelier S.L', 'Découvrez nos inspirations et looks kabyles : robes de cérémonie, caftans, tenues traditionnelles.'],
  '/a-propos': ['À propos — Atelier S.L', "L'histoire de l'Atelier S.L, notre savoir-faire dans la confection kabyle traditionnelle sur commande."],
  '/contact': ['Contact — Atelier S.L', 'Contactez l\'Atelier S.L pour toute question sur nos créations, commandes ou délais.'],
  '/panier': ['Mon panier — Atelier S.L', null],
  '/checkout': ['Commande — Atelier S.L', null],
  '/compte': ['Mon compte — Atelier S.L', null],
  '/connexion': ['Connexion — Atelier S.L', null],
};

// ────────────────────────────────────────────────────────────
// Cartes produit (résumé HTML minimal, crawlable) pour catalogue/catégorie
// ────────────────────────────────────────────────────────────
function fmtPrice(n) {
  return Math.round(Number(n) || 0).toLocaleString('fr-FR');
}

function productCardSnapshot(p) {
  const prix = p.prix_solde || p.prix;
  const onSale = p.prix_solde && p.prix_solde < p.prix;
  const href = `/produit/${encodeURIComponent(p.slug || p.id)}`;
  const rawImg = p.image_principale || p.image_url;
  const { src: img, srcset } = cloudinaryResponsive(rawImg, [220, 350, 500, 700]);
  return `<a class="ssr-product-card" href="${href}" style="display:block">
  ${rawImg ? `<img src="${escapeHtml(img)}" srcset="${escapeHtml(srcset)}" sizes="(max-width:480px) 170px, (max-width:900px) 220px, 260px" alt="${escapeHtml(p.nom)}" loading="lazy" width="500" height="650" style="width:100%;height:auto">` : ''}
  <h3>${escapeHtml(p.nom)}</h3>
  <p>${fmtPrice(prix)} DA${onSale ? ` <s>${fmtPrice(p.prix)} DA</s>` : ''}</p>
</a>`;
}

function itemListLd(products, path) {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    itemListElement: products.map((p, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      url: `${SITE_URL}/produit/${encodeURIComponent(p.slug || p.id)}`,
      name: p.nom,
    })),
  };
}

function breadcrumbLd(items) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: it.name,
      item: SITE_URL + it.path,
    })),
  };
}

// ────────────────────────────────────────────────────────────
// Routes
// ────────────────────────────────────────────────────────────

app.get('/produit/:slug', async (req, res) => {
  const slug = req.params.slug;
  let html = TEMPLATE;
  try {
    const p = await apiGet(API_URL, `/produits/${encodeURIComponent(slug)}`);
    if (!p) return res.status(404).send(applyMeta(html, {
      title: 'Produit introuvable — Atelier S.L',
      description: 'Ce produit n\'existe pas ou n\'est plus disponible.',
      path: req.path, siteUrl: SITE_URL,
    }));

    const rawMainImg = (p.images && p.images.length)
      ? (p.images.find(i => i.principale) || p.images[0]).url
      : undefined;
    const mainImg = cloudinaryOptimize(rawMainImg, { width: 900 });
    const prix = p.prix_solde || p.prix;
    const description = (p.description || '').toString().slice(0, 155)
      || `${p.nom} — pièce confectionnée sur commande par l'Atelier S.L.`;

    html = applyMeta(html, {
      title: `${p.nom} — Atelier S.L`,
      description,
      path: req.path,
      siteUrl: SITE_URL,
      image: mainImg,
      type: 'product',
    });

    const ld = [
      {
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: p.nom,
        description: (p.description || '').toString(),
        sku: p.id,
        image: mainImg ? [mainImg] : undefined,
        brand: { '@type': 'Brand', name: p.marque || 'Atelier S.L' },
        offers: {
          '@type': 'Offer',
          url: `${SITE_URL}${req.path}`,
          priceCurrency: 'DZD',
          price: prix,
          availability: 'https://schema.org/MadeToOrder',
        },
        ...(p.note_moyenne && p.nb_avis ? {
          aggregateRating: { '@type': 'AggregateRating', ratingValue: p.note_moyenne, reviewCount: p.nb_avis },
        } : {}),
      },
      breadcrumbLd([
        { name: 'Accueil', path: '/' },
        { name: 'Catalogue', path: '/catalogue' },
        ...(p.categorie_nom ? [{ name: p.categorie_nom, path: `/categorie/${encodeURIComponent(p.categorie_nom)}` }] : []),
        { name: p.nom, path: req.path },
      ]),
    ];
    html = setJsonLd(html, ld);

    const snapshot = `
<h1>${escapeHtml(p.nom)}</h1>
${mainImg ? `<img src="${escapeHtml(mainImg)}" alt="${escapeHtml(p.nom)}" style="max-width:100%">` : ''}
<p class="ssr-price">${fmtPrice(prix)} DA${p.prix_solde ? ` <s>${fmtPrice(p.prix)} DA</s>` : ''}</p>
${p.categorie_nom ? `<p>Catégorie : <a href="/categorie/${encodeURIComponent(p.categorie_nom)}">${escapeHtml(p.categorie_nom)}</a></p>` : ''}
${p.description ? `<div>${escapeHtml(p.description)}</div>` : ''}
${p.note_moyenne ? `<p>Note moyenne : ${p.note_moyenne}/5 (${p.nb_avis} avis)</p>` : ''}
`;
    html = injectInto(html, 'productDetail', snapshot);

    res.send(html);
  } catch (err) {
    console.error('SSR /produit error:', err.message);
    res.send(applyMeta(TEMPLATE, { title: 'Atelier S.L', path: req.path, siteUrl: SITE_URL }));
  }
});

async function resolveCategoryBySlugOrName(nameOrSlug) {
  const data = await apiGet(API_URL, '/categories?parent_id=racine&actif=all');
  const cats = (data && (data.categories || data.data)) || [];
  return cats.find(c => c.slug === nameOrSlug || c.nom === nameOrSlug) || null;
}

async function renderCatalogue(req, res, catName) {
  let html = TEMPLATE;
  try {
    let apiPath = '/produits?limite=50';
    let cat = null;
    if (catName) {
      cat = await resolveCategoryBySlugOrName(catName);
      if (cat) apiPath += `&categorie=${encodeURIComponent(cat.slug)}`;
    }
    const data = await apiGet(API_URL, apiPath);
    const products = (data && (data.produits || data.data)) || [];

    const title = catName
      ? `${catName} — Catalogue — Atelier S.L`
      : 'Catalogue — Atelier S.L';
    const description = catName
      ? `Découvrez notre collection ${catName} : pièces kabyles confectionnées sur commande par l'Atelier S.L.`
      : `Toute la collection Atelier S.L : ${products.length} pièces kabyles confectionnées sur commande.`;

    html = applyMeta(html, { title, description, path: req.path, siteUrl: SITE_URL });

    const ld = [
      itemListLd(products, req.path),
      breadcrumbLd(catName
        ? [{ name: 'Accueil', path: '/' }, { name: 'Catalogue', path: '/catalogue' }, { name: catName, path: req.path }]
        : [{ name: 'Accueil', path: '/' }, { name: 'Catalogue', path: '/catalogue' }]),
    ];
    html = setJsonLd(html, ld);

    const snapshot = products.map(productCardSnapshot).join('\n');
    html = injectInto(html, 'catalogue-grid', snapshot);

    res.send(html);
  } catch (err) {
    console.error('SSR /catalogue error:', err.message);
    res.send(applyMeta(TEMPLATE, { title: 'Catalogue — Atelier S.L', path: req.path, siteUrl: SITE_URL }));
  }
}

app.get('/catalogue', (req, res) => renderCatalogue(req, res, null));
app.get('/catalogue/:cat', (req, res) => renderCatalogue(req, res, decodeURIComponent(req.params.cat)));
app.get('/categorie/:cat', (req, res) => renderCatalogue(req, res, decodeURIComponent(req.params.cat)));

app.get('/', async (req, res) => {
  let html = TEMPLATE;
  try {
    const data = await apiGet(API_URL, '/produits?limite=1&tri=created_at&ordre=DESC');
    const p = data && (data.produits || data.data) && (data.produits || data.data)[0];
    const rawImg = p && (p.image_principale || p.image_url || (p.images && p.images[0] && p.images[0].url));
    if (rawImg) {
      // Image responsive : srcset avec plusieurs largeurs pour que le
      // navigateur télécharge la taille adaptée à son écran (mobile ≈380px,
      // tablette ≈500px, bureau ≈700-900px) au lieu de la même image lourde
      // partout — c'est ce qui plombait le LCP mobile jusqu'ici.
      const HERO_SIZES = '(max-width:620px) 380px, (max-width:900px) 500px, 700px';
      const { src: heroImg, srcset: heroSrcset } = cloudinaryResponsive(rawImg, [380, 500, 700, 900]);
      html = setAttr(html, 'heroProductImage', 'src', heroImg);
      html = setAttr(html, 'heroProductImage', 'srcset', heroSrcset);
      html = setAttr(html, 'heroProductImage', 'sizes', HERO_SIZES);
      html = setAttr(html, 'heroProductImage', 'class', 'has-product');
      html = setAttr(html, 'heroPreload', 'href', heroImg);
      html = setAttr(html, 'heroPreload', 'imagesrcset', heroSrcset);
      html = setAttr(html, 'heroPreload', 'imagesizes', HERO_SIZES);
      html = applyMeta(html, {
        path: '/', siteUrl: SITE_URL,
        image: cloudinaryOptimize(rawImg, { width: 1200 }),
      });
    } else {
      html = applyMeta(html, { path: '/', siteUrl: SITE_URL });
    }
  } catch (err) {
    console.error('SSR / error:', err.message);
    html = applyMeta(TEMPLATE, { path: '/', siteUrl: SITE_URL });
  }
  res.send(html);
});

Object.keys(PAGE_TITLES).forEach((p) => {
  app.get(p, (req, res) => {
    const [title, description] = PAGE_TITLES[p];
    res.send(applyMeta(TEMPLATE, { title, description, path: p, siteUrl: SITE_URL }));
  });
});

// robots.txt / sitemap.xml / llms.txt — ajoutés AVANT le fallback SPA
// (sinon `app.get('*')` leur renvoie le HTML du site, que Google essaie
// d'interpréter comme des directives robots.txt : c'est la cause des
// "562 erreurs détectées" vues dans PageSpeed Insights).
app.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(
`User-agent: *
Allow: /
Disallow: /panier
Disallow: /checkout
Disallow: /compte
Disallow: /connexion
Disallow: /admin

Sitemap: ${SITE_URL}/sitemap.xml
`);
});

app.get('/sitemap.xml', async (req, res) => {
  const staticUrls = ['/', '/catalogue', '/a-propos', '/contact', '/galerie'];
  let productUrls = [];
  try {
    // L'API plafonne à 50 produits par appel : on parcourt toutes les pages.
    let produits = [];
    let pageNum = 1;
    let pagesTotal = 1;
    do {
      const data = await apiGet(API_URL, `/produits?limite=50&page=${pageNum}`);
      produits = produits.concat((data && (data.produits || data.data)) || []);
      pagesTotal = (data && data.pagination && data.pagination.pages) || 1;
      pageNum++;
    } while (pageNum <= pagesTotal && pageNum <= 20);
    productUrls = produits.map(p => `/produit/${encodeURIComponent(p.slug || p.id)}`);
  } catch (err) {
    console.error('sitemap.xml: erreur API', err.message);
  }
  const urls = [...staticUrls, ...productUrls];
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${
    urls.map(u => `  <url><loc>${SITE_URL}${u}</loc></url>`).join('\n')
  }\n</urlset>\n`;
  res.type('application/xml').send(body);
});

app.get('/llms.txt', (req, res) => {
  res.type('text/plain').send(
`# Atelier S.L

> Boutique en ligne de créations kabyles sur mesure — robes de cérémonie, caftans et tenues traditionnelles, confectionnées avec un savoir-faire artisanal.

## Pages principales
- [Accueil](${SITE_URL}/): présentation de l'Atelier S.L et des dernières créations.
- [Catalogue](${SITE_URL}/catalogue): l'ensemble des créations disponibles à la vente.
- [À propos](${SITE_URL}/a-propos): l'histoire et le savoir-faire de l'atelier.
- [Contact](${SITE_URL}/contact): coordonnées pour toute question ou commande.
`);
});


app.get('*', (req, res) => {
  res.send(applyMeta(TEMPLATE, { path: req.path, siteUrl: SITE_URL }));
});

app.listen(PORT, () => {
  console.log(`🚀  SSR server démarré sur http://localhost:${PORT}`);
  console.log(`🔗  API_URL  = ${API_URL}`);
  console.log(`🌐  SITE_URL = ${SITE_URL}`);
});