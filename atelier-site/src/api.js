// src/api.js
// Client HTTP minimal vers l'API JSON existante (auth-api), avec un cache
// mémoire à courte durée : les crawlers (Googlebot, facebookexternalhit...)
// tapent souvent les mêmes URLs en rafale, inutile de recharger la BDD à
// chaque fois.
const fetch = global.fetch || require('node-fetch');

const CACHE_TTL_MS = parseInt(process.env.SSR_CACHE_TTL_MS || '60000', 10);
const cache = new Map(); // url -> { data, expires }

async function apiGet(apiBaseUrl, path) {
  const url = apiBaseUrl.replace(/\/$/, '') + path;
  const hit = cache.get(url);
  if (hit && hit.expires > Date.now()) return hit.data;

  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(`API ${url} → ${res.status}`);
  }
  const data = await res.json();
  cache.set(url, { data, expires: Date.now() + CACHE_TTL_MS });
  return data;
}

module.exports = { apiGet };
