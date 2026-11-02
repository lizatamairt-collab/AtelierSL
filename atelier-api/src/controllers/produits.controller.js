// src/controllers/produits.controller.js
const { v4: uuidv4 } = require('uuid');
const { sql, getRequest, getPool, getClient, SqlRequest } = require('../config/db');
const { slugifier } = require('../utils/slug');
const journalAdmin = require('../utils/journalAdmin');

/**
 * Normalise la liste de champs de mesures personnalisés envoyée par l'admin
 * pour un produit "sur_mesure" : [{ key, label, essentiel }, ...].
 * - `key` est régénéré à partir du label (slug), pour éviter les doublons/
 *   valeurs incohérentes envoyées depuis le front.
 * - Retourne `null` si la liste est vide/absente → le produit utilisera
 *   alors la grille par défaut côté client (comportement historique).
 */
function normaliserChampsMesures(champs) {
  if (!Array.isArray(champs) || champs.length === 0) return null;

  const vues = new Set();
  const out = [];
  for (const c of champs) {
    const label = (c && c.label ? String(c.label) : '').trim();
    if (!label) continue;

    let key = slugifier(label).replace(/-/g, '_');
    if (!key) continue;
    let keyFinal = key;
    let i = 2;
    while (vues.has(keyFinal)) { keyFinal = `${key}_${i}`; i += 1; }
    vues.add(keyFinal);

    out.push({ key: keyFinal, label, essentiel: !!(c && c.essentiel) });
  }
  return out.length > 0 ? out : null;
}

// ══════════════════════════════════════════════════════════════════════════════
// HELPERS INTERNES
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Charge les variantes d'un produit.
 */
async function chargerVariantes(produit_id) {
  const req = await getRequest();
  const res = await req
    .input('produit_id', sql.UniqueIdentifier, produit_id)
    .query(`
      SELECT id, taille, couleur, couleur_hex, sku,
             stock, stock_alerte, prix_supplement,
             poids_grammes, actif, created_at
      FROM variantes
      WHERE produit_id = @produit_id
      ORDER BY taille, couleur
    `);
  return res.recordset;
}

/**
 * Charge les images d'un produit.
 */
async function chargerImages(produit_id) {
  const req = await getRequest();
  const res = await req
    .input('produit_id', sql.UniqueIdentifier, produit_id)
    .query(`
      SELECT id, variante_id, url, alt, ordre, principale, created_at
      FROM images_produit
      WHERE produit_id = @produit_id
      ORDER BY principale DESC, ordre ASC
    `);
  return res.recordset;
}

/**
 * Génère un slug unique, en ajoutant un suffixe si le slug existe déjà.
 */
async function slugUnique(nom, excludeId = null) {
  const base = slugifier(nom);
  let slug = base;
  let compteur = 1;

  while (true) {
    const req = await getRequest();
    req.input('slug', sql.NVarChar(280), slug);
    if (excludeId) req.input('excl', sql.UniqueIdentifier, excludeId);

    const res = await req.query(
      `SELECT id FROM produits WHERE slug = @slug${excludeId ? ' AND id <> @excl' : ''}`
    );
    if (res.recordset.length === 0) break;
    slug = `${base}-${compteur++}`;
  }
  return slug;
}

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/produits
// ══════════════════════════════════════════════════════════════════════════════
async function lister(req, res) {
  try {
    const {
      page        = 1,
      limite      = 12,
      recherche   = '',
      categorie   = '',      // slug de catégorie
      marque      = '',
      prix_min    = null,
      prix_max    = null,
      featured    = null,    // 'true' | 'false'
      actif       = 'true',  // 'true' | 'false' | 'all'  (admin)
      type        = '',      // 'sur_mesure' | 'stock'
      tri         = 'created_at',
      ordre       = 'DESC',
    } = req.query;

    const offset  = (Math.max(1, parseInt(page)) - 1) * Math.min(50, parseInt(limite));
    const nbLigne = Math.min(50, Math.max(1, parseInt(limite)));

    // Colonnes autorisées pour le tri (whitelist anti-injection)
    const colonnesTri  = ['created_at', 'prix', 'nom', 'featured', 'note_moyenne'];
    const ordresValides = ['ASC', 'DESC'];
    const colonneTri = colonnesTri.includes(tri)    ? tri    : 'created_at';
    const ordreTri   = ordresValides.includes(ordre.toUpperCase()) ? ordre.toUpperCase() : 'DESC';

    // ── Construction des filtres ──────────────────────────────────────────────
    const conditions = ['1=1'];
    const r = await getRequest();

    // Visibilité selon rôle
    if (actif === 'all' && req.utilisateur?.role === 'admin') {
      // admin peut voir tout
    } else {
      conditions.push('p.actif = true');
    }

    if (recherche) {
      conditions.push(`(p.nom LIKE @recherche OR p.description LIKE @recherche OR p.marque LIKE @recherche)`);
      r.input('recherche', sql.NVarChar(255), `%${recherche}%`);
    }

    if (categorie) {
      conditions.push(`c.slug = @categorie`);
      r.input('categorie', sql.NVarChar(120), categorie);
    }

    if (marque) {
      conditions.push(`p.marque = @marque`);
      r.input('marque', sql.NVarChar(100), marque);
    }

    if (prix_min !== null) {
      conditions.push(`COALESCE(p.prix_solde, p.prix) >= @prix_min`);
      r.input('prix_min', sql.Decimal(10, 2), parseFloat(prix_min));
    }

    if (prix_max !== null) {
      conditions.push(`COALESCE(p.prix_solde, p.prix) <= @prix_max`);
      r.input('prix_max', sql.Decimal(10, 2), parseFloat(prix_max));
    }

    if (featured === 'true')  { conditions.push('p.featured = true'); }
    if (featured === 'false') { conditions.push('p.featured = false'); }

    if (type === 'sur_mesure' || type === 'stock') {
      conditions.push('p.type_produit = @type');
      r.input('type', sql.NVarChar(20), type);
    }

    const where = conditions.join(' AND ');

    // ── Requête principale ────────────────────────────────────────────────────
    r.input('offset',   sql.Int, offset);
    r.input('nbLigne',  sql.Int, nbLigne);

    const querySQL = `
      SELECT
        p.id, p.nom, p.slug, p.prix, p.prix_solde, p.marque,
        p.actif, p.featured, p.created_at, p.type_produit,
        p.pourcentage_eur,
        ROUND(p.prix * p.pourcentage_eur / 100, 2)       AS prix_eur,
        CASE WHEN p.prix_solde IS NOT NULL
             THEN ROUND(p.prix_solde * p.pourcentage_eur / 100, 2)
             ELSE NULL END                                AS prix_solde_eur,
        c.nom          AS categorie_nom,
        c.slug         AS categorie_slug,
        COALESCE(SUM(v.stock), 0)              AS stock_total,
        ROUND(AVG(a.note), 1) AS note_moyenne,
        COUNT(DISTINCT a.id)                 AS nb_avis,
        (
          SELECT url
          FROM images_produit ip
          WHERE ip.produit_id = p.id AND ip.principale = true
          LIMIT 1
        ) AS image_principale
      FROM produits p
      LEFT JOIN categories      c ON c.id = p.categorie_id
      LEFT JOIN variantes       v ON v.produit_id = p.id AND v.actif = true
      LEFT JOIN avis            a ON a.produit_id = p.id AND a.approuve = true
      WHERE ${where}
      GROUP BY p.id, p.nom, p.slug, p.prix, p.prix_solde, p.marque,
               p.actif, p.featured, p.created_at, p.type_produit, p.pourcentage_eur, c.nom, c.slug
      ORDER BY ${colonneTri === 'note_moyenne' ? 'note_moyenne' : 'p.' + colonneTri} ${ordreTri}
      LIMIT @nbLigne OFFSET @offset
    `;

    // ── Compte total ──────────────────────────────────────────────────────────
    const rCount = await getRequest();
    if (recherche)  rCount.input('recherche', sql.NVarChar(255), `%${recherche}%`);
    if (categorie)  rCount.input('categorie', sql.NVarChar(120), categorie);
    if (marque)     rCount.input('marque',    sql.NVarChar(100), marque);
    if (prix_min !== null) rCount.input('prix_min', sql.Decimal(10, 2), parseFloat(prix_min));
    if (prix_max !== null) rCount.input('prix_max', sql.Decimal(10, 2), parseFloat(prix_max));
    if (type === 'sur_mesure' || type === 'stock') rCount.input('type', sql.NVarChar(20), type);

    const countSQL = `
      SELECT COUNT(DISTINCT p.id) AS total
      FROM produits p
      LEFT JOIN categories c ON c.id = p.categorie_id
      WHERE ${where}
    `;

    const [produits, count] = await Promise.all([
      r.query(querySQL),
      rCount.query(countSQL),
    ]);

    const total = count.recordset[0].total;

    return res.status(200).json({
      produits:  produits.recordset,
      pagination: {
        page:        parseInt(page),
        limite:      nbLigne,
        total,
        pages:       Math.ceil(total / nbLigne),
      },
    });

  } catch (err) {
    console.error('lister produits error:', err);
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/produits/:slug
// ══════════════════════════════════════════════════════════════════════════════
async function obtenir(req, res) {
  try {
    const { slug } = req.params;

    const r = await getRequest();
    const result = await r
      .input('slug', sql.NVarChar(280), slug)
      .query(`
        SELECT
          p.id, p.nom, p.slug, p.description, p.prix, p.prix_solde,
          p.marque, p.matiere, p.entretien, p.actif, p.featured,
          p.categorie_id, p.created_at, p.updated_at, p.type_produit,
          p.pourcentage_eur, p.champs_mesures,
          ROUND(p.prix * p.pourcentage_eur / 100, 2)       AS prix_eur,
          CASE WHEN p.prix_solde IS NOT NULL
               THEN ROUND(p.prix_solde * p.pourcentage_eur / 100, 2)
               ELSE NULL END                                AS prix_solde_eur,
          c.nom  AS categorie_nom,
          c.slug AS categorie_slug,
          ROUND(AVG(a.note), 1) AS note_moyenne,
          COUNT(DISTINCT a.id)                 AS nb_avis
        FROM produits p
        LEFT JOIN categories c ON c.id = p.categorie_id
        LEFT JOIN avis        a ON a.produit_id = p.id AND a.approuve = true
        WHERE p.slug = @slug
        GROUP BY
          p.id, p.nom, p.slug, p.description, p.prix, p.prix_solde,
          p.marque, p.matiere, p.entretien, p.actif, p.featured,
          p.categorie_id, p.created_at, p.updated_at, p.type_produit, p.pourcentage_eur,
          p.champs_mesures, c.nom, c.slug
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ message: 'Produit introuvable.' });
    }

    const produit = result.recordset[0];

    // Charger les images (+ variantes si le produit est géré en stock)
    const [images, variantes] = await Promise.all([
      chargerImages(produit.id),
      produit.type_produit === 'stock' ? chargerVariantes(produit.id) : Promise.resolve([]),
    ]);

    return res.status(200).json({ ...produit, images, variantes });

  } catch (err) {
    console.error('obtenir produit error:', err);
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/produits  [admin]
// ══════════════════════════════════════════════════════════════════════════════
async function creer(req, res) {
  try {
    const {
      nom, description = null, prix, prix_solde = null,
      matiere = null, entretien = null,
      categorie_id = null, featured = false, actif = true,
      images = [],
      type_produit = 'sur_mesure', // 'sur_mesure' | 'stock'
      variantes = [],              // uniquement utilisé si type_produit === 'stock'
      pourcentage_eur = null,      // % du prix DA pour le prix France (€), NULL = pas vendu en France
      champs_mesures = null,       // uniquement pertinent si type_produit === 'sur_mesure'
    } = req.body;

    const typeProduitFinal = ['sur_mesure', 'stock'].includes(type_produit) ? type_produit : 'sur_mesure';
    const champsMesuresFinal = typeProduitFinal === 'sur_mesure' ? normaliserChampsMesures(champs_mesures) : null;

    const id   = uuidv4();
    let slug = await slugUnique(nom);

    // ── Insérer le produit ────────────────────────────────────────────────────
    // (retry défensif : en cas de double-soumission quasi simultanée, deux
    // requêtes peuvent calculer le même slug avant que l'une des deux insère —
    // on regénère alors un slug frais et on retente une seule fois.)
    const insererProduit = async (slugAEssayer) => {
      const r = await getRequest();
      await r
        .input('id',           sql.UniqueIdentifier, id)
        .input('categorie_id', sql.UniqueIdentifier, categorie_id || null)
        .input('nom',          sql.NVarChar(255),    nom)
        .input('slug',         sql.NVarChar(280),    slugAEssayer)
        .input('description',  sql.NVarChar(sql.MAX), description)
        .input('prix',         sql.Decimal(10, 2),   parseFloat(prix))
        .input('prix_solde',   sql.Decimal(10, 2),   prix_solde ? parseFloat(prix_solde) : null)
        .input('matiere',      sql.NVarChar(255),    matiere)
        .input('entretien',    sql.NVarChar(sql.MAX), entretien)
        .input('actif',        sql.Bit,              !!actif)
        .input('featured',     sql.Bit,              !!featured)
        .input('type_produit', sql.NVarChar(20),     typeProduitFinal)
        .input('pourcentage_eur', sql.Decimal(6, 2), (pourcentage_eur !== null && pourcentage_eur !== '') ? parseFloat(pourcentage_eur) : null)
        .input('champs_mesures', sql.NVarChar(sql.MAX), champsMesuresFinal ? JSON.stringify(champsMesuresFinal) : null)
        .query(`
          INSERT INTO produits
            (id, categorie_id, nom, slug, description, prix, prix_solde,
             matiere, entretien, actif, featured, type_produit, pourcentage_eur, champs_mesures)
          VALUES
            (@id, @categorie_id, @nom, @slug, @description, @prix, @prix_solde,
             @matiere, @entretien, @actif, @featured, @type_produit, @pourcentage_eur, @champs_mesures)
        `);
    };

    try {
      await insererProduit(slug);
    } catch (errInsert) {
      if (errInsert.code === 'ER_DUP_ENTRY') {
        // Collision (course entre deux soumissions simultanées) : on regénère
        // un slug frais (qui tient compte du produit concurrent déjà inséré)
        // et on retente une seule fois.
        slug = await slugUnique(nom);
        await insererProduit(slug);
      } else {
        throw errInsert;
      }
    }

    // ── Insérer les images si fournies (URLs déjà uploadées) ─────────────────
    for (let i = 0; i < images.length; i++) {
      const img = images[i];
      const ri = await getRequest();
      await ri
        .input('id',          sql.UniqueIdentifier, uuidv4())
        .input('produit_id',  sql.UniqueIdentifier, id)
        .input('url',         sql.NVarChar(500),    img.url)
        .input('alt',         sql.NVarChar(255),    img.alt  || nom)
        .input('ordre',       sql.Int,              img.ordre ?? i)
        .input('principale',  sql.Bit,              !!(img.principale || i === 0))
        .query(`
          INSERT INTO images_produit (id, produit_id, url, alt, ordre, principale)
          VALUES (@id, @produit_id, @url, @alt, @ordre, @principale)
        `);
    }

    // ── Insérer les variantes si le produit est géré en stock ────────────────
    const variantesCreees = [];
    if (typeProduitFinal === 'stock') {
      for (const v of variantes) {
        const varianteId = uuidv4();
        const rv = await getRequest();
        await rv
          .input('id',              sql.UniqueIdentifier, varianteId)
          .input('produit_id',      sql.UniqueIdentifier, id)
          .input('taille',          sql.NVarChar(20),     v.taille || null)
          .input('couleur',         sql.NVarChar(50),     v.couleur || null)
          .input('couleur_hex',     sql.NVarChar(7),      v.couleur_hex || null)
          .input('sku',             sql.NVarChar(100),    v.sku || null)
          .input('stock',           sql.Int,              parseInt(v.stock) || 0)
          .input('stock_alerte',    sql.Int,              v.stock_alerte != null ? parseInt(v.stock_alerte) : 5)
          .input('prix_supplement', sql.Decimal(10, 2),   parseFloat(v.prix_supplement) || 0)
          .input('poids_grammes',   sql.Int,              v.poids_grammes || null)
          .input('actif',           sql.Bit,              v.actif === false ? 0 : 1)
          .query(`
            INSERT INTO variantes
              (id, produit_id, taille, couleur, couleur_hex, sku,
               stock, stock_alerte, prix_supplement, poids_grammes, actif)
            VALUES
              (@id, @produit_id, @taille, @couleur, @couleur_hex, @sku,
               @stock, @stock_alerte, @prix_supplement, @poids_grammes, @actif)
          `);
        variantesCreees.push({
          id: varianteId, produit_id: id, taille: v.taille || null, couleur: v.couleur || null,
          couleur_hex: v.couleur_hex || null, sku: v.sku || null, stock: parseInt(v.stock) || 0,
          stock_alerte: v.stock_alerte != null ? parseInt(v.stock_alerte) : 5,
          prix_supplement: parseFloat(v.prix_supplement) || 0, poids_grammes: v.poids_grammes || null,
          actif: v.actif !== false,
        });
      }
    }

    // ── Retourner le produit complet ──────────────────────────────────────────
    const imagesCreees = await chargerImages(id);

    return res.status(201).json({
      message: 'Produit créé avec succès.',
      produit: {
        id, nom, slug, description, prix, prix_solde,
        matiere, entretien, actif, featured, categorie_id,
        type_produit: typeProduitFinal,
        pourcentage_eur: (pourcentage_eur !== null && pourcentage_eur !== '') ? parseFloat(pourcentage_eur) : null,
        champs_mesures: champsMesuresFinal,
        images: imagesCreees,
        variantes: variantesCreees,
      },
    });

  } catch (err) {
    console.error('creer produit error:', err);
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'Un produit avec ce slug existe déjà.' });
    }
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// PUT /api/produits/:id  [admin]
// ══════════════════════════════════════════════════════════════════════════════
async function modifier(req, res) {
  try {
    const { id } = req.params;

    // Vérifier que le produit existe
    const rExiste = await getRequest();
    const existe = await rExiste
      .input('id', sql.UniqueIdentifier, id)
      .query('SELECT id, nom, type_produit FROM produits WHERE id = @id');

    if (existe.recordset.length === 0) {
      return res.status(404).json({ message: 'Produit introuvable.' });
    }

    const {
      nom, description, prix, prix_solde,
      matiere, entretien,
      categorie_id, featured, actif,
      type_produit, pourcentage_eur,
      champs_mesures,
      images,
    } = req.body;

    // Recalculer le slug uniquement si le nom a changé
    const nomActuel = existe.recordset[0].nom;
    const slug = nom && nom !== nomActuel
      ? await slugUnique(nom, id)
      : undefined;

    // Construire le SET dynamiquement
    const champs = [];
    const r = await getRequest();

    if (nom         !== undefined) { champs.push('nom = @nom');                 r.input('nom',          sql.NVarChar(255),    nom); }
    if (slug        !== undefined) { champs.push('slug = @slug');               r.input('slug',         sql.NVarChar(280),    slug); }
    if (description !== undefined) { champs.push('description = @description'); r.input('description',  sql.NVarChar(sql.MAX), description); }
    if (prix        !== undefined) { champs.push('prix = @prix');               r.input('prix',         sql.Decimal(10, 2),   parseFloat(prix)); }
    if (prix_solde  !== undefined) { champs.push('prix_solde = @prix_solde');   r.input('prix_solde',   sql.Decimal(10, 2),   prix_solde === null ? null : parseFloat(prix_solde)); }
    if (matiere     !== undefined) { champs.push('matiere = @matiere');         r.input('matiere',      sql.NVarChar(255),    matiere); }
    if (entretien   !== undefined) { champs.push('entretien = @entretien');     r.input('entretien',    sql.NVarChar(sql.MAX), entretien); }
    if (categorie_id!== undefined) { champs.push('categorie_id = @categorie_id'); r.input('categorie_id', sql.UniqueIdentifier, categorie_id || null); }
    if (featured    !== undefined) { champs.push('featured = @featured');       r.input('featured',     sql.Bit,              !!featured); }
    if (actif       !== undefined) { champs.push('actif = @actif');             r.input('actif',        sql.Bit,              !!actif); }
    if (type_produit !== undefined && ['sur_mesure', 'stock'].includes(type_produit)) {
      champs.push('type_produit = @type_produit');
      r.input('type_produit', sql.NVarChar(20), type_produit);
    }
    if (pourcentage_eur !== undefined) {
      champs.push('pourcentage_eur = @pourcentage_eur');
      r.input('pourcentage_eur', sql.Decimal(6, 2), (pourcentage_eur === null || pourcentage_eur === '') ? null : parseFloat(pourcentage_eur));
    }
    if (champs_mesures !== undefined) {
      const typeProduitEffectif = (type_produit !== undefined && ['sur_mesure', 'stock'].includes(type_produit))
        ? type_produit
        : existe.recordset[0].type_produit;
      const champsMesuresFinal = typeProduitEffectif === 'sur_mesure' ? normaliserChampsMesures(champs_mesures) : null;
      champs.push('champs_mesures = @champs_mesures');
      r.input('champs_mesures', sql.NVarChar(sql.MAX), champsMesuresFinal ? JSON.stringify(champsMesuresFinal) : null);
    }

    if (champs.length === 0) {
      return res.status(400).json({ message: 'Aucun champ à mettre à jour.' });
    }

    r.input('id', sql.UniqueIdentifier, id);
    await r.query(`UPDATE produits SET ${champs.join(', ')} WHERE id = @id`);

    // ── Images ajoutées par URL (pas par upload de fichier) ───────────────────
    // Le front envoie ici la liste complète des images "déjà en ligne" (URL
    // Cloudinary/externe saisie manuellement). Comme ce tableau contient aussi
    // les images déjà enregistrées, on n'insère que celles qui ne sont pas
    // encore présentes en base, pour ne pas créer de doublons à chaque
    // enregistrement du produit.
    if (Array.isArray(images) && images.length > 0) {
      const dejaEnBase = await chargerImages(id);
      const urlsExistantes = new Set(dejaEnBase.map(img => img.url));

      for (let i = 0; i < images.length; i++) {
        const img = images[i];
        if (!img || !img.url || urlsExistantes.has(img.url)) continue;

        const ri = await getRequest();
        await ri
          .input('id',          sql.UniqueIdentifier, uuidv4())
          .input('produit_id',  sql.UniqueIdentifier, id)
          .input('url',         sql.NVarChar(500),    img.url)
          .input('alt',         sql.NVarChar(255),    img.alt || nom || existe.recordset[0].nom)
          .input('ordre',       sql.Int,              img.ordre ?? i)
          .input('principale',  sql.Bit,              !!img.principale)
          .query(`
            INSERT INTO images_produit (id, produit_id, url, alt, ordre, principale)
            VALUES (@id, @produit_id, @url, @alt, @ordre, @principale)
          `);
        urlsExistantes.add(img.url);
      }
    }

    // Retourner le produit mis à jour
    const rResult = await getRequest();
    const result = await rResult
      .input('id', sql.UniqueIdentifier, id)
      .query(`
        SELECT p.*, c.nom AS categorie_nom, c.slug AS categorie_slug
        FROM produits p
        LEFT JOIN categories c ON c.id = p.categorie_id
        WHERE p.id = @id
      `);

    const produitMaj = result.recordset[0];
    const [imagesFinales, variantes] = await Promise.all([
      chargerImages(id),
      produitMaj.type_produit === 'stock' ? chargerVariantes(id) : Promise.resolve([]),
    ]);

    return res.status(200).json({
      message: 'Produit mis à jour.',
      produit: { ...produitMaj, images: imagesFinales, variantes },
    });

  } catch (err) {
    console.error('modifier produit error:', err);
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// DELETE /api/produits/:id  [admin] → désactivation douce
// ══════════════════════════════════════════════════════════════════════════════
async function supprimer(req, res) {
  try {
    const { id }   = req.params;
    const { force } = req.query; // ?force=true pour suppression physique (admin)

    const rExiste = await getRequest();
    const existe = await rExiste
      .input('id', sql.UniqueIdentifier, id)
      .query('SELECT id FROM produits WHERE id = @id');

    if (existe.recordset.length === 0) {
      return res.status(404).json({ message: 'Produit introuvable.' });
    }

    if (force === 'true') {
      const { cloudinary } = require('../config/cloudinary');

      // Récupérer les public_id Cloudinary des images du produit AVANT suppression
      const rImages = await getRequest();
      const images = await rImages
        .input('id', sql.UniqueIdentifier, id)
        .query('SELECT public_id FROM images_produit WHERE produit_id = @id AND public_id IS NOT NULL');

      // NOTE : lignes_panier.produit_id et lignes_commande.produit_id sont en
      // ON DELETE NO ACTION (SQL Server refuse un 2e chemin de cascade vers ces
      // tables, un premier existant déjà via variantes → lignes_panier/lignes_commande).
      // On fait donc ce nettoyage explicitement ici, dans une transaction, avant
      // le DELETE FROM produits :
      //   - lignes_panier   : on retire la ligne du panier (produit disparu)
      //   - lignes_commande : on garde la ligne (historique déjà snapshoté :
      //     produit_nom/taille/couleur/prix), on met juste produit_id à NULL
      // Transaction PostgreSQL : on récupère un client dédié du pool (getClient),
      // on l'entoure de BEGIN/COMMIT/ROLLBACK, et SqlRequest(client) l'utilise
      // au lieu du pool partagé pour que les 3 requêtes s'exécutent bien dans
      // la même transaction.
      const client = await getClient();
      try {
        await client.query('BEGIN');

        await new SqlRequest(client)
          .input('id', sql.UniqueIdentifier, id)
          .query('DELETE FROM lignes_panier WHERE produit_id = @id');

        await new SqlRequest(client)
          .input('id', sql.UniqueIdentifier, id)
          .query('UPDATE lignes_commande SET produit_id = NULL WHERE produit_id = @id');

        // CASCADE gère ensuite variantes, images_produit, avis, favoris
        await new SqlRequest(client)
          .input('id', sql.UniqueIdentifier, id)
          .query('DELETE FROM produits WHERE id = @id');

        await client.query('COMMIT');
      } catch (txErr) {
        await client.query('ROLLBACK');
        throw txErr;
      } finally {
        client.release();
      }

      // Nettoyage Cloudinary (non bloquant si ça échoue)
      for (const { public_id } of images.recordset) {
        await cloudinary.uploader.destroy(public_id).catch(err =>
          console.error('Cloudinary destroy error:', err.message)
        );
      }

      await journalAdmin.enregistrer(req, {
        action:    'produit.supprimer_definitivement',
        entite:    'produit',
        entite_id: id,
      });

      return res.status(200).json({ message: 'Produit supprimé définitivement.' });
    }

    // Désactivation douce (recommandé)
    const r = await getRequest();
    await r
      .input('id', sql.UniqueIdentifier, id)
      .query('UPDATE produits SET actif = false WHERE id = @id');

    await journalAdmin.enregistrer(req, {
      action:    'produit.desactiver',
      entite:    'produit',
      entite_id: id,
    });

    return res.status(200).json({ message: 'Produit désactivé avec succès.' });

  } catch (err) {
    console.error('supprimer produit error:', err);
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// ── VARIANTES ─────────────────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

// POST /api/produits/:id/variantes  [admin]
async function ajouterVariante(req, res) {
  try {
    const { id: produit_id } = req.params;

    const rExiste = await getRequest();
    const existe = await rExiste
      .input('id', sql.UniqueIdentifier, produit_id)
      .query('SELECT id FROM produits WHERE id = @id');
    if (existe.recordset.length === 0) {
      return res.status(404).json({ message: 'Produit introuvable.' });
    }

    const {
      taille = null, couleur = null, couleur_hex = null,
      sku = null, stock = 0, stock_alerte = 5,
      prix_supplement = 0, poids_grammes = null, actif = true,
    } = req.body;

    const varianteId = uuidv4();
    const r = await getRequest();
    await r
      .input('id',              sql.UniqueIdentifier, varianteId)
      .input('produit_id',      sql.UniqueIdentifier, produit_id)
      .input('taille',          sql.NVarChar(20),     taille)
      .input('couleur',         sql.NVarChar(50),     couleur)
      .input('couleur_hex',     sql.NVarChar(7),      couleur_hex)
      .input('sku',             sql.NVarChar(100),    sku)
      .input('stock',           sql.Int,              stock)
      .input('stock_alerte',    sql.Int,              stock_alerte)
      .input('prix_supplement', sql.Decimal(10, 2),   prix_supplement)
      .input('poids_grammes',   sql.Int,              poids_grammes)
      .input('actif',           sql.Bit,              !!actif)
      .query(`
        INSERT INTO variantes
          (id, produit_id, taille, couleur, couleur_hex, sku,
           stock, stock_alerte, prix_supplement, poids_grammes, actif)
        VALUES
          (@id, @produit_id, @taille, @couleur, @couleur_hex, @sku,
           @stock, @stock_alerte, @prix_supplement, @poids_grammes, @actif)
      `);

    return res.status(201).json({
      message: 'Variante ajoutée.',
      variante: { id: varianteId, produit_id, taille, couleur, couleur_hex, sku, stock, stock_alerte, prix_supplement, poids_grammes, actif },
    });

  } catch (err) {
    console.error('ajouterVariante error:', err);
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'Ce SKU existe déjà.' });
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
}

// PUT /api/produits/:id/variantes/:varianteId  [admin]
async function modifierVariante(req, res) {
  try {
    const { id: produit_id, varianteId } = req.params;

    const rExiste = await getRequest();
    const existe = await rExiste
      .input('id',         sql.UniqueIdentifier, varianteId)
      .input('produit_id', sql.UniqueIdentifier, produit_id)
      .query('SELECT id FROM variantes WHERE id = @id AND produit_id = @produit_id');
    if (existe.recordset.length === 0) {
      return res.status(404).json({ message: 'Variante introuvable.' });
    }

    const champs = [];
    const r = await getRequest();
    const { taille, couleur, couleur_hex, sku, stock, stock_alerte, prix_supplement, poids_grammes, actif } = req.body;

    if (taille          !== undefined) { champs.push('taille = @taille');                   r.input('taille',          sql.NVarChar(20),    taille); }
    if (couleur         !== undefined) { champs.push('couleur = @couleur');                 r.input('couleur',         sql.NVarChar(50),    couleur); }
    if (couleur_hex     !== undefined) { champs.push('couleur_hex = @couleur_hex');         r.input('couleur_hex',     sql.NVarChar(7),     couleur_hex); }
    if (sku             !== undefined) { champs.push('sku = @sku');                         r.input('sku',             sql.NVarChar(100),   sku); }
    if (stock           !== undefined) { champs.push('stock = @stock');                     r.input('stock',           sql.Int,             stock); }
    if (stock_alerte    !== undefined) { champs.push('stock_alerte = @stock_alerte');       r.input('stock_alerte',    sql.Int,             stock_alerte); }
    if (prix_supplement !== undefined) { champs.push('prix_supplement = @prix_supplement'); r.input('prix_supplement', sql.Decimal(10, 2),  prix_supplement); }
    if (poids_grammes   !== undefined) { champs.push('poids_grammes = @poids_grammes');     r.input('poids_grammes',   sql.Int,             poids_grammes); }
    if (actif           !== undefined) { champs.push('actif = @actif');                     r.input('actif',           sql.Bit,             !!actif); }

    if (champs.length === 0) return res.status(400).json({ message: 'Aucun champ à mettre à jour.' });

    r.input('id', sql.UniqueIdentifier, varianteId);
    await r.query(`UPDATE variantes SET ${champs.join(', ')} WHERE id = @id`);

    return res.status(200).json({ message: 'Variante mise à jour.' });

  } catch (err) {
    console.error('modifierVariante error:', err);
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
}

// DELETE /api/produits/:id/variantes/:varianteId  [admin]
async function supprimerVariante(req, res) {
  try {
    const { id: produit_id, varianteId } = req.params;

    const r = await getRequest();
    const result = await r
      .input('id',         sql.UniqueIdentifier, varianteId)
      .input('produit_id', sql.UniqueIdentifier, produit_id)
      .query('DELETE FROM variantes WHERE id = @id AND produit_id = @produit_id');

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ message: 'Variante introuvable.' });
    }
    return res.status(200).json({ message: 'Variante supprimée.' });

  } catch (err) {
    console.error('supprimerVariante error:', err);
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// ── IMAGES ────────────────────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

// POST /api/produits/:id/images  [admin]
async function ajouterImage(req, res) {
  try {
    const { id: produit_id } = req.params;

    // Vérifier qu'un fichier a bien été uploadé par multer/Cloudinary
    if (!req.file) {
      return res.status(400).json({ message: 'Aucun fichier reçu. Envoyez un champ "image".' });
    }

    // Cloudinary remplit req.file avec : path (URL), filename (public_id)
    const url        = req.file.path;
    const public_id  = req.file.filename;   // ex: "boutique-kabyle/produits/xxx/1720000000-robe"

    const alt         = req.body.alt        || null;
    const ordre       = parseInt(req.body.ordre ?? 0);
    const principale  = ['1', 'true'].includes(String(req.body.principale));
    const variante_id = req.body.variante_id || null;

    // Vérifier que le produit existe
    const rExiste = await getRequest();
    const existe = await rExiste
      .input('id', sql.UniqueIdentifier, produit_id)
      .query('SELECT id, nom FROM produits WHERE id = @id');

    if (existe.recordset.length === 0) {
      // Produit introuvable → supprimer l'image déjà uploadée sur Cloudinary
      const { cloudinary } = require('../config/cloudinary');
      await cloudinary.uploader.destroy(public_id).catch(() => {});
      return res.status(404).json({ message: 'Produit introuvable.' });
    }

    // Si principale=true, retirer l'ancienne principale
    if (principale) {
      const rReset = await getRequest();
      await rReset
        .input('produit_id', sql.UniqueIdentifier, produit_id)
        .query('UPDATE images_produit SET principale = false WHERE produit_id = @produit_id');
    }

    const imageId = uuidv4();
    const r = await getRequest();
    await r
      .input('id',          sql.UniqueIdentifier, imageId)
      .input('produit_id',  sql.UniqueIdentifier, produit_id)
      .input('variante_id', sql.UniqueIdentifier, variante_id || null)
      .input('url',         sql.NVarChar(500),    url)
      .input('public_id',   sql.NVarChar(500),    public_id)
      .input('alt',         sql.NVarChar(255),    alt || existe.recordset[0].nom)
      .input('ordre',       sql.Int,              ordre)
      .input('principale',  sql.Bit,              !!principale)
      .query(`
        INSERT INTO images_produit (id, produit_id, variante_id, url, public_id, alt, ordre, principale)
        VALUES (@id, @produit_id, @variante_id, @url, @public_id, @alt, @ordre, @principale)
      `);

    return res.status(201).json({
      message: 'Image uploadée et enregistrée.',
      image: { id: imageId, produit_id, variante_id, url, public_id, alt, ordre, principale },
    });

  } catch (err) {
    console.error('ajouterImage error:', err);
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
}

// DELETE /api/produits/:id/images/:imageId  [admin]
async function supprimerImage(req, res) {
  try {
    const { id: produit_id, imageId } = req.params;
    const { cloudinary } = require('../config/cloudinary');

    // Récupérer le public_id Cloudinary avant suppression
    const rSelect = await getRequest();
    const select = await rSelect
      .input('id',         sql.UniqueIdentifier, imageId)
      .input('produit_id', sql.UniqueIdentifier, produit_id)
      .query('SELECT id, public_id FROM images_produit WHERE id = @id AND produit_id = @produit_id');

    if (select.recordset.length === 0) {
      return res.status(404).json({ message: 'Image introuvable.' });
    }

    const { public_id } = select.recordset[0];

    // 1. Supprimer de la base
    const r = await getRequest();
    await r
      .input('id',         sql.UniqueIdentifier, imageId)
      .input('produit_id', sql.UniqueIdentifier, produit_id)
      .query('DELETE FROM images_produit WHERE id = @id AND produit_id = @produit_id');

    // 2. Supprimer de Cloudinary (non bloquant si ça échoue)
    if (public_id) {
      await cloudinary.uploader.destroy(public_id).catch(err =>
        console.error('Cloudinary destroy error:', err.message)
      );
    }

    return res.status(200).json({ message: 'Image supprimée de Cloudinary et de la base.' });

  } catch (err) {
    console.error('supprimerImage error:', err);
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// ── STOCK ─────────────────────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

// PATCH /api/produits/:id/variantes/:varianteId/stock  [admin]
async function ajusterStock(req, res) {
  try {
    const { id: produit_id, varianteId } = req.params;
    const { quantite, operation = 'set' } = req.body;
    // operation: 'set' | 'add' | 'subtract'

    const rExiste = await getRequest();
    const existe = await rExiste
      .input('id',         sql.UniqueIdentifier, varianteId)
      .input('produit_id', sql.UniqueIdentifier, produit_id)
      .query('SELECT id, stock FROM variantes WHERE id = @id AND produit_id = @produit_id');

    if (existe.recordset.length === 0) {
      return res.status(404).json({ message: 'Variante introuvable.' });
    }

    const r = await getRequest();
    r.input('id',  sql.UniqueIdentifier, varianteId);
    r.input('qte', sql.Int, Math.abs(parseInt(quantite)));

    let stockQuery;
    if (operation === 'add')      stockQuery = 'UPDATE variantes SET stock = stock + @qte WHERE id = @id';
    else if (operation === 'subtract') stockQuery = 'UPDATE variantes SET stock = GREATEST(0, stock - @qte) WHERE id = @id';
    else                          stockQuery = 'UPDATE variantes SET stock = @qte WHERE id = @id';

    // GREATEST n'existe pas dans SQL Server < 2022, fallback
    const queryFinal = stockQuery.replace(
      'GREATEST(0, stock - @qte)',
      'CASE WHEN stock - @qte < 0 THEN 0 ELSE stock - @qte END'
    );
    await r.query(queryFinal);

    const rResult = await getRequest();
    const result = await rResult
      .input('id', sql.UniqueIdentifier, varianteId)
      .query('SELECT id, stock, stock_alerte FROM variantes WHERE id = @id');

    const variante = result.recordset[0];
    const alerte   = variante.stock <= variante.stock_alerte;

    return res.status(200).json({
      message:       'Stock mis à jour.',
      stock:         variante.stock,
      stock_alerte:  variante.stock_alerte,
      alerte_stock:  alerte,
    });

  } catch (err) {
    console.error('ajusterStock error:', err);
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
}

module.exports = {
  lister,
  obtenir,
  creer,
  modifier,
  supprimer,
  ajouterImage,
  supprimerImage,
  ajouterVariante,
  modifierVariante,
  supprimerVariante,
  ajusterStock,
};