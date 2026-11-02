# Atelier S.L — Serveur de pré-rendu (SSR-lite)

Ce petit serveur Express remplace l'hébergement statique du fichier
`atelier_sl_client.html`. Il fait deux choses que le simple fichier statique
ne peut pas faire :

1. **Contenu réel dans le HTML initial** (problème n°2) : pour `/`, `/catalogue`,
   `/catalogue/:cat`, `/categorie/:cat` et `/produit/:slug`, il va chercher les
   données via l'API existante et les injecte directement dans le HTML envoyé
   (nom produit, prix, description, cartes produits...) — avant même que le JS
   du navigateur ne s'exécute. Un crawler qui ne rend pas le JS (ou mal) voit
   quand même le vrai contenu.
2. **Toutes les balises SEO par page** (problème n°3) : `<title>`, meta
   description, `<link rel="canonical">`, Open Graph, Twitter Card, et le
   JSON-LD (`Product`, `BreadcrumbList`, `ItemList`, `ClothingStore`).

Il sert aussi de solution au problème n°1 (URLs propres) : comme c'est un vrai
serveur qui répond à toutes les routes, plus besoin de règle de rewrite
séparée côté hébergeur — ce serveur EST le fallback SPA.

Le JS du fichier HTML continue de fonctionner à l'identique par-dessus
(navigation en SPA, `pushState`, fetch de données à jour) — ce serveur ne fait
qu'améliorer ce qui est envoyé au tout premier chargement de chaque page.

## Installation

```bash
npm install
cp .env.example .env
# éditer .env : API_URL (votre API en production), SITE_URL (votre domaine)
npm start
```

## Déploiement

Ce serveur remplace votre hébergeur statique actuel pour le front (Vercel/
Netlify/etc.) : déployez-le comme n'importe quelle app Node (Render, Fly.io,
un VPS derrière Nginx, un conteneur...). Gardez `auth-api` tel quel — ce
serveur ne fait qu'appeler son API JSON, il ne touche pas à la base de
données.

**Important** : mettez à jour `FRONTEND_URL` dans `auth-api/.env` avec le
nouveau domaine si l'origine change (CORS).

## Limites connues

- C'est un pré-rendu "maison" ciblé (regex sur des marqueurs `id="..."`
  stables dans le template), pas un vrai moteur SSR (pas d'hydratation React,
  pas de rendu de composants) — volontairement simple vu que le front est un
  seul fichier HTML/JS vanilla. Si le template `atelier_sl_client.html`
  change structurellement (renommage des id `seoTitle`, `productDetail`,
  `catalogue-grid`...), les fonctions dans `src/render.js` doivent suivre.
- Le cache mémoire (`SSR_CACHE_TTL_MS`) est local au process : avec plusieurs
  instances derrière un load balancer, chaque instance a son propre cache
  (pas de souci de cohérence, juste plus d'appels API cumulés).
- Pensez à générer un `sitemap.xml` listant `/`, `/catalogue`, une entrée par
  catégorie et une par produit (slug), pour que Google découvre les URLs sans
  attendre un crawl profond.

## Valeurs à configurer avant déploiement

Ce dépôt ne contient volontairement aucune valeur de production. Remplacez les valeurs d'exemple par les vôtres :

| Valeur d'exemple | Où la remplacer |
| --- | --- |
| `https://api.example.com/api` | `client/js/main.js` et `admin/js/main.js` (constante `API`), `.env` (`API_URL`) |
| `https://example.com` | `.env` (`SITE_URL`) et balises SEO de `client/index.html` |
| `votre-cloud-name` | `client/index.html`, `client/js/main.js`, `admin/index.html` (nom de compte Cloudinary) |
| `213XXXXXXXXX` / `+213 XXX XX XX XX` | `client/js/main.js` (`WHATSAPP_NUMBER`) et section contact de `client/index.html` |
| `contact@example.com` | section contact de `client/index.html` |
