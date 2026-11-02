// src/controllers/panier.controller.js
// Deux types de produits cohabitent :
//  - "sur_mesure" : confectionnés sur commande, pas de stock. La couleur/
//    taille sont des choix libres du client (palette fixe côté frontend).
//  - "stock"      : gérés par variantes (taille × couleur) avec un stock
//    réel. couleur/taille doivent correspondre à une variante existante ;
//    la disponibilité est vérifiée ici (contrôle "souple", le contrôle
//    définitif + verrou anti-concurrence a lieu à la création de commande).
const { v4: uuidv4 } = require('uuid');
const { sql, getRequest } = require('../config/db');
const { verifyAccessToken } = require('../utils/jwt');

// ══════════════════════════════════════════════════════════════════════════════
// HELPERS INTERNES
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Résout l'identité du panier à utiliser :
 *  - utilisateur connecté (JWT valide dans Authorization)
 *  - sinon panier invité, identifié par l'en-tête/le corps/la query "x-session-id" / "session_id"
 */
function resolverIdentite(req) {
  const header = req.headers['authorization'];
  if (header && header.startsWith('Bearer ')) {
    try {
      const payload = verifyAccessToken(header.slice(7));
      return { utilisateur_id: payload.sub, session_id: null };
    } catch (_) {
      // Token invalide/expiré → on retombe sur la session invité si fournie
    }
  }
  const session_id =
    req.headers['x-session-id'] ||
    (req.body && req.body.session_id) ||
    req.query.session_id ||
    null;

  return { utilisateur_id: null, session_id };
}

/**
 * Récupère le panier existant (par utilisateur_id ou session_id) ou le crée.
 */
async function getOuCreerPanier({ utilisateur_id, session_id }) {
  const rFind = await getRequest();
  rFind.input('utilisateur_id', sql.UniqueIdentifier, utilisateur_id || null);
  rFind.input('session_id',     sql.NVarChar(255),    session_id || null);

  const findRes = await rFind.query(`
    SELECT id, utilisateur_id, session_id, updated_at
    FROM paniers
    WHERE (@utilisateur_id IS NOT NULL AND utilisateur_id = @utilisateur_id)
       OR (@session_id     IS NOT NULL AND session_id     = @session_id)
  `);

  if (findRes.recordset.length > 0) {
    return findRes.recordset[0];
  }

  const id = uuidv4();
  const rCreate = await getRequest();
  await rCreate
    .input('id',             sql.UniqueIdentifier, id)
    .input('utilisateur_id', sql.UniqueIdentifier, utilisateur_id || null)
    .input('session_id',     sql.NVarChar(255),    session_id || null)
    .query('INSERT INTO paniers (id, utilisateur_id, session_id) VALUES (@id, @utilisateur_id, @session_id)');

  return { id, utilisateur_id: utilisateur_id || null, session_id: session_id || null, updated_at: new Date() };
}

/**
 * Charge les lignes d'un panier avec les infos produit nécessaires à l'affichage.
 * (Plus de jointure sur "variantes" : couleur/taille sont stockées directement
 * sur la ligne de panier, choisies librement par le client.)
 */
async function chargerLignesPanier(panier_id) {
  const r = await getRequest();
  const res = await r
    .input('panier_id', sql.UniqueIdentifier, panier_id)
    .query(`
      SELECT
        lp.id, lp.produit_id, lp.variante_id, lp.quantite, lp.couleur, lp.couleur_hex,
        lp.taille, lp.date_evenement, lp.added_at, lp.mesures,
        p.nom AS produit_nom, p.slug AS produit_slug, p.type_produit,
        p.prix, p.prix_solde, p.actif AS produit_actif,
        v.stock AS variante_stock, v.prix_supplement, v.actif AS variante_actif,
        (
          SELECT url
          FROM images_produit ip
          WHERE ip.produit_id = p.id
          ORDER BY ip.principale DESC, ip.ordre ASC
          LIMIT 1
        ) AS image_url
      FROM lignes_panier lp
      INNER JOIN produits p  ON p.id = lp.produit_id
      LEFT JOIN  variantes v ON v.id = lp.variante_id
      WHERE lp.panier_id = @panier_id
      ORDER BY lp.added_at DESC
    `);

  return res.recordset.map(l => {
    const prixBase     = (l.prix_solde !== null && l.prix_solde !== undefined) ? l.prix_solde : l.prix;
    const supplement    = l.variante_id ? parseFloat(l.prix_supplement || 0) : 0;
    const prixUnitaire  = parseFloat(prixBase) + supplement;
    const estStock      = l.type_produit === 'stock';
    const disponible     = !!l.produit_actif && (!estStock || (!!l.variante_actif && l.variante_stock > 0));

    return {
      ligne_id:         l.id,
      produit_id:       l.produit_id,
      variante_id:      l.variante_id || null,
      produit_nom:      l.produit_nom,
      produit_slug:     l.produit_slug,
      type_produit:     l.type_produit,
      image_url:        l.image_url,
      taille:           l.taille,
      couleur:          l.couleur,
      couleur_hex:      l.couleur_hex,
      quantite:         l.quantite,
      prix_unitaire:    Math.round(prixUnitaire * 100) / 100,
      sous_total_ligne: Math.round(prixUnitaire * l.quantite * 100) / 100,
      disponible,
      stock_disponible: estStock ? l.variante_stock : null,
      added_at:         l.added_at,
      date_evenement:   l.date_evenement || null,
      mesures:          l.mesures || null,
    };
  });
}

/**
 * Construit la représentation complète d'un panier (lignes + totaux).
 */
async function construirePanier(panier) {
  const lignes      = await chargerLignesPanier(panier.id);
  const sous_total   = Math.round(lignes.reduce((s, l) => s + l.sous_total_ligne, 0) * 100) / 100;
  const nb_articles  = lignes.reduce((s, l) => s + l.quantite, 0);

  return {
    id:             panier.id,
    utilisateur_id: panier.utilisateur_id,
    session_id:     panier.session_id,
    updated_at:     panier.updated_at,
    nb_articles,
    sous_total,
    lignes,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/panier
// ══════════════════════════════════════════════════════════════════════════════
async function obtenir(req, res) {
  try {
    const identite = resolverIdentite(req);
    if (!identite.utilisateur_id && !identite.session_id) {
      return res.status(400).json({ message: 'Authentification ou en-tête x-session-id requis.' });
    }

    const panier = await getOuCreerPanier(identite);
    return res.status(200).json(await construirePanier(panier));

  } catch (err) {
    console.error('obtenir panier error:', err);
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/panier/lignes
// Body attendu : { produit_id, couleur, couleur_hex, taille, quantite, date_evenement }
// ══════════════════════════════════════════════════════════════════════════════
async function ajouterLigne(req, res) {
  try {
    const identite = resolverIdentite(req);
    if (!identite.utilisateur_id && !identite.session_id) {
      return res.status(400).json({ message: 'Authentification ou en-tête x-session-id requis.' });
    }

    const {
      produit_id,
      couleur      = null,
      couleur_hex  = null,
      taille       = null,
      quantite     = 1,
      date_evenement = null,
      mesures      = null, // mesures personnalisées (cm) saisies par le client — { [key]: valeur, ... }
    } = req.body;

    if (!produit_id) {
      return res.status(400).json({ message: 'produit_id requis.' });
    }

    const rProduit = await getRequest();
    const produitRes = await rProduit
      .input('id', sql.UniqueIdentifier, produit_id)
      .query('SELECT id, nom, actif, type_produit FROM produits WHERE id = @id');

    if (produitRes.recordset.length === 0) {
      return res.status(404).json({ message: 'Produit introuvable.' });
    }

    const produit = produitRes.recordset[0];
    if (!produit.actif) {
      return res.status(409).json({ message: `"${produit.nom}" n'est plus disponible.` });
    }

    const quantiteDemandee = Math.max(1, parseInt(quantite) || 1);

    // ── Produit "stock" : résoudre la variante correspondant à taille/couleur
    //    et vérifier la disponibilité (contrôle souple — le contrôle final
    //    avec verrou a lieu à la création de la commande). ────────────────────
    let variante_id  = null;
    let coul          = couleur;
    let coulHex        = couleur_hex;
    let taill          = taille;

    if (produit.type_produit === 'stock') {
      const rVariante = await getRequest();
      const varianteRes = await rVariante
        .input('produit_id', sql.UniqueIdentifier, produit_id)
        .input('couleur',    sql.NVarChar(50),     couleur)
        .input('taille',     sql.NVarChar(20),     taille)
        .query(`
          SELECT id, taille, couleur, couleur_hex, stock, actif
          FROM variantes
          WHERE produit_id = @produit_id
            AND COALESCE(couleur, '') = COALESCE(@couleur, '')
            AND COALESCE(taille, '')  = COALESCE(@taille, '')
        `);

      if (varianteRes.recordset.length === 0) {
        return res.status(404).json({ message: 'Cette combinaison taille/couleur n\'existe pas pour ce produit.' });
      }

      const variante = varianteRes.recordset[0];
      if (!variante.actif) {
        return res.status(409).json({ message: 'Cette variante n\'est plus disponible.' });
      }

      variante_id = variante.id;
      coul        = variante.couleur;
      coulHex      = variante.couleur_hex;
      taill        = variante.taille;

      // Quantité déjà présente dans le panier pour cette variante (à cumuler)
      const rDejaPanier = await getRequest();
      const dejaPanierRes = await rDejaPanier
        .input('produit_id',  sql.UniqueIdentifier, produit_id)
        .input('variante_id', sql.UniqueIdentifier, variante_id)
        .query(`
          SELECT lp.quantite FROM lignes_panier lp
          INNER JOIN paniers pa ON pa.id = lp.panier_id
          WHERE lp.produit_id = @produit_id AND lp.variante_id = @variante_id
        `);
      const dejaEnPanier = dejaPanierRes.recordset.reduce((s, r) => s + r.quantite, 0);

      if (variante.stock < dejaEnPanier + quantiteDemandee) {
        return res.status(409).json({
          message: `Stock insuffisant. Il reste ${Math.max(0, variante.stock - dejaEnPanier)} unité(s) disponible(s).`,
          stock_disponible: Math.max(0, variante.stock - dejaEnPanier),
        });
      }
    }

    const panier = await getOuCreerPanier(identite);

    // Un même produit + couleur + taille ne forme qu'une seule ligne (on cumule la quantité)
    const rExiste = await getRequest();
    const existeRes = await rExiste
      .input('panier_id',  sql.UniqueIdentifier, panier.id)
      .input('produit_id', sql.UniqueIdentifier, produit_id)
      .input('couleur',    sql.NVarChar(50),     coul)
      .input('taille',     sql.NVarChar(20),     taill)
      .query(`
        SELECT id, quantite FROM lignes_panier
        WHERE panier_id = @panier_id AND produit_id = @produit_id
          AND COALESCE(couleur, '') = COALESCE(@couleur, '')
          AND COALESCE(taille, '')  = COALESCE(@taille, '')
      `);

    // Ne garder que des valeurs numériques valides, pour ne pas enregistrer
    // n'importe quoi en base depuis le front.
    let mesuresPropres = null;
    if (mesures && typeof mesures === 'object' && !Array.isArray(mesures)) {
      const nettoye = {};
      for (const [k, v] of Object.entries(mesures)) {
        const n = parseFloat(v);
        if (Number.isFinite(n) && n > 0) nettoye[k] = n;
      }
      if (Object.keys(nettoye).length > 0) mesuresPropres = nettoye;
    }

    if (existeRes.recordset.length > 0) {
      const quantiteFinale = existeRes.recordset[0].quantite + quantiteDemandee;
      const rMaj = await getRequest();
      await rMaj
        .input('id',       sql.UniqueIdentifier, existeRes.recordset[0].id)
        .input('quantite', sql.Int,              quantiteFinale)
        .input('mesures',  sql.NVarChar(sql.MAX),mesuresPropres ? JSON.stringify(mesuresPropres) : null)
        .query(`
          UPDATE lignes_panier
          SET quantite = @quantite,
              mesures  = COALESCE(@mesures, mesures)
          WHERE id = @id
        `);
    } else {
      const rIns = await getRequest();
      await rIns
        .input('id',             sql.UniqueIdentifier, uuidv4())
        .input('panier_id',      sql.UniqueIdentifier, panier.id)
        .input('produit_id',     sql.UniqueIdentifier, produit_id)
        .input('variante_id',    sql.UniqueIdentifier, variante_id)
        .input('couleur',        sql.NVarChar(50),     coul)
        .input('couleur_hex',    sql.NVarChar(7),      coulHex)
        .input('taille',         sql.NVarChar(20),     taill)
        .input('quantite',       sql.Int,              quantiteDemandee)
        .input('date_evenement', sql.Date,             date_evenement ? new Date(date_evenement) : null)
        .input('mesures',        sql.NVarChar(sql.MAX),mesuresPropres ? JSON.stringify(mesuresPropres) : null)
        .query(`
          INSERT INTO lignes_panier
            (id, panier_id, produit_id, variante_id, couleur, couleur_hex, taille, quantite, date_evenement, mesures)
          VALUES
            (@id, @panier_id, @produit_id, @variante_id, @couleur, @couleur_hex, @taille, @quantite, @date_evenement, @mesures)
        `);
    }

    return res.status(200).json(await construirePanier(panier));

  } catch (err) {
    console.error('ajouterLigne panier error:', err);
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// PUT /api/panier/lignes/:ligneId
// Body : { quantite, date_evenement }
// ══════════════════════════════════════════════════════════════════════════════
async function modifierLigne(req, res) {
  try {
    const identite = resolverIdentite(req);
    if (!identite.utilisateur_id && !identite.session_id) {
      return res.status(400).json({ message: 'Authentification ou en-tête x-session-id requis.' });
    }

    const { ligneId } = req.params;
    const { quantite, date_evenement } = req.body;

    const panier = await getOuCreerPanier(identite);

    const rExiste = await getRequest();
    const existeRes = await rExiste
      .input('id',         sql.UniqueIdentifier, ligneId)
      .input('panier_id',  sql.UniqueIdentifier, panier.id)
      .query('SELECT id, variante_id FROM lignes_panier WHERE id = @id AND panier_id = @panier_id');

    if (existeRes.recordset.length === 0) {
      return res.status(404).json({ message: "Cet article n'est pas dans le panier." });
    }

    const ligneActuelle = existeRes.recordset[0];

    // ── Si la ligne référence une variante (produit "stock"), vérifier le
    //    stock disponible avant d'augmenter la quantité. ─────────────────────
    if (quantite !== undefined && ligneActuelle.variante_id) {
      const quantiteVoulue = Math.max(1, parseInt(quantite) || 1);
      const rVariante = await getRequest();
      const varianteRes = await rVariante
        .input('id', sql.UniqueIdentifier, ligneActuelle.variante_id)
        .query('SELECT stock, actif FROM variantes WHERE id = @id');

      if (varianteRes.recordset.length === 0 || !varianteRes.recordset[0].actif) {
        return res.status(409).json({ message: 'Cette variante n\'est plus disponible.' });
      }
      if (varianteRes.recordset[0].stock < quantiteVoulue) {
        return res.status(409).json({
          message: `Stock insuffisant. Il reste ${varianteRes.recordset[0].stock} unité(s) disponible(s).`,
          stock_disponible: varianteRes.recordset[0].stock,
        });
      }
    }

    const champs = [];
    const r = await getRequest();
    r.input('id', sql.UniqueIdentifier, ligneId);

    if (quantite !== undefined) {
      champs.push('quantite = @quantite');
      r.input('quantite', sql.Int, Math.max(1, parseInt(quantite) || 1));
    }
    if (date_evenement !== undefined) {
      champs.push('date_evenement = @date_evenement');
      r.input('date_evenement', sql.Date, date_evenement ? new Date(date_evenement) : null);
    }

    if (champs.length === 0) {
      return res.status(400).json({ message: 'Aucun champ à mettre à jour.' });
    }

    await r.query(`UPDATE lignes_panier SET ${champs.join(', ')} WHERE id = @id`);

    return res.status(200).json(await construirePanier(panier));

  } catch (err) {
    console.error('modifierLigne panier error:', err);
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// DELETE /api/panier/lignes/:ligneId
// ══════════════════════════════════════════════════════════════════════════════
async function supprimerLigne(req, res) {
  try {
    const identite = resolverIdentite(req);
    if (!identite.utilisateur_id && !identite.session_id) {
      return res.status(400).json({ message: 'Authentification ou en-tête x-session-id requis.' });
    }

    const { ligneId } = req.params;
    const panier = await getOuCreerPanier(identite);

    const r = await getRequest();
    const result = await r
      .input('id',        sql.UniqueIdentifier, ligneId)
      .input('panier_id', sql.UniqueIdentifier, panier.id)
      .query('DELETE FROM lignes_panier WHERE id = @id AND panier_id = @panier_id');

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ message: "Cet article n'est pas dans le panier." });
    }

    return res.status(200).json(await construirePanier(panier));

  } catch (err) {
    console.error('supprimerLigne panier error:', err);
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// DELETE /api/panier
// ══════════════════════════════════════════════════════════════════════════════
async function vider(req, res) {
  try {
    const identite = resolverIdentite(req);
    if (!identite.utilisateur_id && !identite.session_id) {
      return res.status(400).json({ message: 'Authentification ou en-tête x-session-id requis.' });
    }

    const panier = await getOuCreerPanier(identite);

    const r = await getRequest();
    await r
      .input('panier_id', sql.UniqueIdentifier, panier.id)
      .query('DELETE FROM lignes_panier WHERE panier_id = @panier_id');

    return res.status(200).json({ message: 'Panier vidé.', ...(await construirePanier(panier)) });

  } catch (err) {
    console.error('vider panier error:', err);
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/panier/fusionner  [authentifié]
// Fusionne un panier invité (session_id) dans le panier de l'utilisateur connecté.
// À appeler juste après la connexion/inscription côté frontend.
// ══════════════════════════════════════════════════════════════════════════════
async function fusionner(req, res) {
  try {
    const utilisateur_id = req.utilisateur.sub;
    const { session_id } = req.body;

    const panierUtilisateur = await getOuCreerPanier({ utilisateur_id, session_id: null });

    const rInvite = await getRequest();
    const inviteRes = await rInvite
      .input('session_id', sql.NVarChar(255), session_id)
      .query('SELECT id FROM paniers WHERE session_id = @session_id');

    if (inviteRes.recordset.length === 0 || inviteRes.recordset[0].id === panierUtilisateur.id) {
      // Rien à fusionner
      return res.status(200).json(await construirePanier(panierUtilisateur));
    }

    const panierInviteId = inviteRes.recordset[0].id;

    const rLignesInvite = await getRequest();
    const lignesInviteRes = await rLignesInvite
      .input('panier_id', sql.UniqueIdentifier, panierInviteId)
      .query(`
        SELECT produit_id, variante_id, couleur, couleur_hex, taille, quantite, date_evenement
        FROM lignes_panier
        WHERE panier_id = @panier_id
      `);

    for (const ligne of lignesInviteRes.recordset) {
      const rExiste = await getRequest();
      const existeRes = await rExiste
        .input('panier_id',  sql.UniqueIdentifier, panierUtilisateur.id)
        .input('produit_id', sql.UniqueIdentifier, ligne.produit_id)
        .input('couleur',    sql.NVarChar(50),     ligne.couleur)
        .input('taille',     sql.NVarChar(20),     ligne.taille)
        .query(`
          SELECT id, quantite FROM lignes_panier
          WHERE panier_id = @panier_id AND produit_id = @produit_id
            AND COALESCE(couleur, '') = COALESCE(@couleur, '')
            AND COALESCE(taille, '')  = COALESCE(@taille, '')
        `);

      if (existeRes.recordset.length > 0) {
        const quantiteFinale = existeRes.recordset[0].quantite + ligne.quantite;
        const rMaj = await getRequest();
        await rMaj
          .input('id',       sql.UniqueIdentifier, existeRes.recordset[0].id)
          .input('quantite', sql.Int,              quantiteFinale)
          .query('UPDATE lignes_panier SET quantite = @quantite WHERE id = @id');
      } else {
        const rIns = await getRequest();
        await rIns
          .input('id',             sql.UniqueIdentifier, uuidv4())
          .input('panier_id',      sql.UniqueIdentifier, panierUtilisateur.id)
          .input('produit_id',     sql.UniqueIdentifier, ligne.produit_id)
          .input('variante_id',    sql.UniqueIdentifier, ligne.variante_id || null)
          .input('couleur',        sql.NVarChar(50),     ligne.couleur)
          .input('couleur_hex',    sql.NVarChar(7),      ligne.couleur_hex)
          .input('taille',         sql.NVarChar(20),     ligne.taille)
          .input('quantite',       sql.Int,              ligne.quantite)
          .input('date_evenement', sql.Date,             ligne.date_evenement || null)
          .query(`
            INSERT INTO lignes_panier
              (id, panier_id, produit_id, variante_id, couleur, couleur_hex, taille, quantite, date_evenement)
            VALUES
              (@id, @panier_id, @produit_id, @variante_id, @couleur, @couleur_hex, @taille, @quantite, @date_evenement)
          `);
      }
    }

    // Supprime le panier invité (cascade vers ses lignes restantes)
    const rSuppr = await getRequest();
    await rSuppr
      .input('id', sql.UniqueIdentifier, panierInviteId)
      .query('DELETE FROM paniers WHERE id = @id');

    return res.status(200).json(await construirePanier(panierUtilisateur));

  } catch (err) {
    console.error('fusionner panier error:', err);
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
}

module.exports = {
  obtenir,
  ajouterLigne,
  modifierLigne,
  supprimerLigne,
  vider,
  fusionner,
};