// src/controllers/visites.controller.js
// Enregistre les visites du site (table `visites`) et signale à l'admin
// qu'un nouveau visiteur est arrivé (table `notifications`, cloche admin).
//
// Règles :
//  - 1 visite comptée par visiteur et par jour (clé unique = HMAC(IP + navigateur + jour)).
//    Aucune IP n'est stockée : seulement ce hash, impossible à inverser sans le secret serveur ;
//  - les robots (Google, moniteurs, aperçus de liens…) sont ignorés ;
//  - notification admin (optionnelle) : plafonnée par heure (NOTIF_VISITEURS_MAX_HEURE,
//    60 par défaut) ; les statistiques, elles, comptent toutes les visites.
//
// Les visites s'affichent dans la rubrique « Visiteurs » du panneau admin.
// La notification (cloche) est DÉSACTIVÉE par défaut : mettre NOTIF_VISITEURS=true
// dans le .env pour la réactiver.
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { sql, getRequest } = require('../config/db');

const NOTIFIER      = process.env.NOTIF_VISITEURS === 'true';
const MAX_PAR_HEURE = parseInt(process.env.NOTIF_VISITEURS_MAX_HEURE, 10) || 60;
const FENETRE_MS    = 24 * 60 * 60 * 1000;
const MAX_CLES      = 20000;
const SECRET        = process.env.VISITES_SECRET || process.env.JWT_SECRET || process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

const PAGES = {
  accueil:   'Accueil',
  catalogue: 'Catalogue',
  produit:   'Fiche produit',
  panier:    'Panier',
  checkout:  'Commande',
  compte:    'Mon compte',
  connexion: 'Connexion',
  contact:   'Contact',
  apropos:   'À propos',
  galerie:   'Lookbook',
};

const RE_BOTS = /bot|crawl|spider|slurp|facebookexternalhit|bingpreview|headless|lighthouse|pagespeed|gtmetrix|pingdom|uptime|monitor|curl|wget|python|axios|node-fetch|go-http|java\/|httpclient|preview|whatsapp|telegram|discord|embedly|prerender/i;

const vus = new Map(); // cle -> date d'expiration (ms) : évite d'interroger la base à chaque ping
let fenetreHeure = { debut: Date.now(), n: 0 };

function purger() {
  const maintenant = Date.now();
  for (const [cle, exp] of vus) if (exp <= maintenant) vus.delete(cle);
  if (vus.size > MAX_CLES) vus.clear();
}
setInterval(purger, 10 * 60 * 1000).unref();

// ── Table `visites` : créée automatiquement au premier usage ────────────────
let tablePrete = null;
function assurerTable() {
  if (!tablePrete) {
    tablePrete = (async () => {
      const r0 = await getRequest();
      const existe = await r0.query(
        "SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'visites'"
      );
      const dejaLa = Number(existe.recordset[0].n) > 0;

      const r1 = await getRequest();
      await r1.query(`
        CREATE TABLE IF NOT EXISTS visites (
          id          char(36)     NOT NULL,
          cle         char(64)     NOT NULL,
          jour        date         NOT NULL,
          page        varchar(30)  NOT NULL DEFAULT 'accueil',
          appareil    varchar(20)  NOT NULL DEFAULT 'Ordinateur',
          source      varchar(100) NULL,
          created_at  datetime     NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          UNIQUE KEY uq_visites_cle (cle),
          KEY idx_visites_jour (jour)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);

      // Première création : on récupère les visites déjà signalées par notification.
      if (!dejaLa) {
        try {
          const r2 = await getRequest();
          await r2.query(`
            INSERT IGNORE INTO visites (id, cle, jour, page, appareil, source, created_at)
            SELECT UUID(), SHA2(CONCAT('reprise-', id), 256), DATE(created_at), 'accueil', 'Ordinateur', NULL, created_at
            FROM notifications
            WHERE type = 'autre' AND titre = 'Nouveau visiteur sur le site'
          `);
        } catch (err) {
          console.error('visites reprise notifications:', err.message);
        }
      }
    })().catch((err) => { tablePrete = null; throw err; }); // réessaie au prochain appel
  }
  return tablePrete;
}

function appareil(ua) {
  if (/ipad|tablet/i.test(ua)) return 'Tablette';
  if (/mobi|android|iphone/i.test(ua)) return 'Mobile';
  return 'Ordinateur';
}

function nettoyerPage(valeur) {
  const brut = String(valeur || '').toLowerCase().replace(/^[#/]+/, '').split(/[/?#]/)[0];
  return PAGES[brut] ? brut : 'accueil';
}

function nettoyerSource(valeur) {
  if (!valeur) return null;
  const host = String(valeur).trim().slice(0, 100).toLowerCase().replace(/[^a-z0-9.-]/g, '');
  return host || null;
}

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/visites  (public)
// Répond toujours 204 tout de suite : le visiteur n'attend jamais.
// ══════════════════════════════════════════════════════════════════════════════
async function signaler(req, res) {
  res.status(204).end();

  let cle = null;
  try {
    const ua = String(req.headers['user-agent'] || '').slice(0, 300);
    if (!ua || RE_BOTS.test(ua)) return;

    const maintenant = Date.now();
    const jour = new Date(maintenant).toISOString().slice(0, 10);
    cle = crypto.createHmac('sha256', SECRET)
      .update(`${req.ip || ''}|${ua}|${jour}`)
      .digest('hex');

    const exp = vus.get(cle);
    if (exp && exp > maintenant) return; // déjà compté aujourd'hui
    vus.set(cle, maintenant + FENETRE_MS);

    const body   = req.body || {};
    const page   = nettoyerPage(body.page);
    const source = nettoyerSource(body.ref);
    const type   = appareil(ua);

    await assurerTable();
    const r = await getRequest();
    const ins = await r
      .input('id',       sql.UniqueIdentifier, uuidv4())
      .input('cle',      sql.NVarChar(64),     cle)
      .input('jour',     sql.Date,             jour)
      .input('page',     sql.NVarChar(30),     page)
      .input('appareil', sql.NVarChar(20),     type)
      .input('source',   sql.NVarChar(100),    source)
      .query(`
        INSERT IGNORE INTO visites (id, cle, jour, page, appareil, source)
        VALUES (@id, @cle, @jour, @page, @appareil, @source)
      `);

    if (ins.rowsAffected[0] === 0) return; // déjà enregistrée (ex. après un redémarrage)

    // ── Notification admin (plafonnée) ──
    if (!NOTIFIER) return;
    if (maintenant - fenetreHeure.debut > 60 * 60 * 1000) fenetreHeure = { debut: maintenant, n: 0 };
    if (fenetreHeure.n >= MAX_PAR_HEURE) return;
    fenetreHeure.n++;

    const contenu = [
      `Page : ${PAGES[page]}`,
      type,
      source ? `Source : ${source}` : 'Accès direct',
    ].join(' · ');

    const rn = await getRequest();
    await rn
      .input('id',      sql.UniqueIdentifier, uuidv4())
      .input('titre',   sql.NVarChar(255),    'Nouveau visiteur sur le site')
      .input('contenu', sql.NVarChar(sql.MAX), contenu)
      .query(`
        INSERT INTO notifications (id, utilisateur_id, type, titre, contenu)
        VALUES (@id, NULL, 'autre', @titre, @contenu)
      `);
  } catch (err) {
    // Échec (base indisponible…) : on "oublie" ce visiteur pour qu'il soit
    // recompté à son prochain ping au lieu d'être perdu pour la journée.
    if (cle) vus.delete(cle);
    console.error('visites signaler error:', err.message);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/visites/stats?mois=12  (admin)
// Visiteurs par mois (mois sans visite = 0) + chiffres clés.
// ══════════════════════════════════════════════════════════════════════════════
async function statistiques(req, res) {
  try {
    await assurerTable();
    const nbMois = Math.min(36, Math.max(1, parseInt(req.query.mois, 10) || 12));

    const r = await getRequest();
    const parMois = await r
      .input('n', sql.Int, nbMois - 1)
      .query(`
        SELECT DATE_FORMAT(jour, '%Y-%m') AS mois, COUNT(*) AS visiteurs
        FROM visites
        WHERE jour >= DATE_SUB(DATE_FORMAT(CURDATE(), '%Y-%m-01'), INTERVAL @n MONTH)
        GROUP BY DATE_FORMAT(jour, '%Y-%m')
        ORDER BY mois
      `);

    const rc = await getRequest();
    const cles = await rc.query(`
      SELECT
        COUNT(*)                                                              AS total,
        SUM(jour = CURDATE())                                                 AS aujourdhui,
        SUM(DATE_FORMAT(jour, '%Y-%m') = DATE_FORMAT(CURDATE(), '%Y-%m'))     AS ce_mois,
        SUM(DATE_FORMAT(jour, '%Y-%m') = DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 1 MONTH), '%Y-%m')) AS mois_precedent
      FROM visites
    `);

    const rm = await getRequest();
    const appareils = await rm.query(`
      SELECT appareil, COUNT(*) AS visiteurs
      FROM visites
      WHERE DATE_FORMAT(jour, '%Y-%m') = DATE_FORMAT(CURDATE(), '%Y-%m')
      GROUP BY appareil
      ORDER BY visiteurs DESC
    `);

    // On complète les mois sans visite avec 0, du plus ancien au plus récent.
    const trouves = new Map(parMois.recordset.map((l) => [l.mois, Number(l.visiteurs)]));
    const serie = [];
    const debut = new Date();
    debut.setDate(1);
    debut.setMonth(debut.getMonth() - (nbMois - 1));
    for (let i = 0; i < nbMois; i++) {
      const d = new Date(debut.getFullYear(), debut.getMonth() + i, 1);
      const cle = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      serie.push({ mois: cle, visiteurs: trouves.get(cle) || 0 });
    }

    const c = cles.recordset[0] || {};
    return res.json({
      par_mois: serie,
      total:            Number(c.total || 0),
      aujourdhui:       Number(c.aujourdhui || 0),
      ce_mois:          Number(c.ce_mois || 0),
      mois_precedent:   Number(c.mois_precedent || 0),
      appareils_ce_mois: appareils.recordset.map((a) => ({ appareil: a.appareil, visiteurs: Number(a.visiteurs) })),
    });
  } catch (err) {
    console.error('visites statistiques error:', err);
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/visites?page=1&limite=30&mois=2026-10  (admin)
// Liste détaillée des visites (les plus récentes d'abord), filtrable par mois.
// ══════════════════════════════════════════════════════════════════════════════
async function lister(req, res) {
  try {
    await assurerTable();
    const page   = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limite = Math.min(100, Math.max(1, parseInt(req.query.limite, 10) || 30));
    const offset = (page - 1) * limite;
    const mois   = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(req.query.mois || '')) ? String(req.query.mois) : null;

    const r = await getRequest();
    const data = await r
      .input('mois',   mois)
      .input('limite', limite)
      .input('offset', offset)
      .query(`
        SELECT id, jour, created_at, page, appareil, source
        FROM visites
        WHERE (@mois IS NULL OR DATE_FORMAT(jour, '%Y-%m') = @mois)
        ORDER BY created_at DESC
        LIMIT @limite OFFSET @offset
      `);

    const rc = await getRequest();
    const total = await rc
      .input('mois', mois)
      .query(`
        SELECT COUNT(*) AS total FROM visites
        WHERE (@mois IS NULL OR DATE_FORMAT(jour, '%Y-%m') = @mois)
      `);

    const nb = Number(total.recordset[0].total || 0);
    return res.json({
      visites: data.recordset,
      total:   nb,
      page,
      limite,
      pages:   Math.max(1, Math.ceil(nb / limite)),
      mois,
    });
  } catch (err) {
    console.error('visites lister error:', err);
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
}

module.exports = { signaler, statistiques, lister };
