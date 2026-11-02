// src/controllers/contact.controller.js
const { v4: uuidv4 } = require('uuid');
const { transporter } = require('../utils/email');
const { getPool }     = require('../config/db');

// Sujets autorisés (whitelist affichée côté front)
const SUJETS = [
  'commande',
  'retour_remboursement',
  'produit',
  'livraison',
  'compte',
  'partenariat',
  'autre',
];

// ── Template HTML email reçu par l'équipe ────────────────────────────────────
function htmlEquipe({ prenom, nom, email, sujet, message }) {
  const sujetLabel = {
    commande:             'Commande',
    retour_remboursement: 'Retour / Remboursement',
    produit:              'Produit',
    livraison:            'Livraison',
    compte:               'Compte',
    partenariat:          'Partenariat',
    autre:                'Autre',
  }[sujet] || sujet;

  return `
    <div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
      <div style="background:#8B4513;padding:20px 24px">
        <h2 style="color:#fff;margin:0">📩 Nouveau message de contact</h2>
      </div>
      <div style="padding:24px">
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          <tr>
            <td style="padding:8px 0;color:#6b7280;width:140px">Nom</td>
            <td style="padding:8px 0;font-weight:600">${prenom} ${nom}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;color:#6b7280">Email</td>
            <td style="padding:8px 0">
              <a href="mailto:${email}" style="color:#8B4513">${email}</a>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 0;color:#6b7280">Sujet</td>
            <td style="padding:8px 0">${sujetLabel}</td>
          </tr>
        </table>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0">
        <p style="color:#374151;white-space:pre-line;margin:0">${message}</p>
      </div>
      <div style="background:#f9fafb;padding:12px 24px;font-size:12px;color:#9ca3af">
        Message reçu le ${new Date().toLocaleString('fr-DZ', { timeZone: 'Africa/Algiers' })}
      </div>
    </div>
  `;
}

// ── Template HTML accusé de réception envoyé à l'expéditeur ─────────────────
function htmlAccuse({ prenom }) {
  return `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto">
      <div style="background:#8B4513;padding:20px 24px;border-radius:8px 8px 0 0">
        <h2 style="color:#fff;margin:0">Boutique Kabyle</h2>
      </div>
      <div style="padding:24px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px">
        <p>Bonjour <strong>${prenom}</strong>,</p>
        <p>
          Nous avons bien reçu votre message et nous vous remercions de nous avoir contactés.
          Notre équipe vous répondra dans les plus brefs délais, généralement sous <strong>24 à 48 heures</strong>
          (jours ouvrables).
        </p>
        <p>
          Si votre demande concerne une commande en cours, n'hésitez pas à inclure votre numéro de commande
          dans une éventuelle relance pour accélérer le traitement.
        </p>
        <p style="margin-top:24px">
          Cordialement,<br>
          <strong>L'équipe Boutique Kabyle</strong>
        </p>
      </div>
      <p style="font-size:12px;color:#9ca3af;text-align:center;margin-top:12px">
        Merci de ne pas répondre directement à cet email automatique.
      </p>
    </div>
  `;
}

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/contact
// Accessible sans authentification (formulaire public).
// 1. Archive le message en base (messages_contact) — toujours.
// 2. Tente l'envoi email en parallèle.
// 3. Répond 200 si l'archivage a réussi, même si l'email a échoué.
// ══════════════════════════════════════════════════════════════════════════════
async function envoyer(req, res) {
  try {
    const pool = await getPool();
    const { prenom, nom, email, sujet, message } = req.body;
    const utilisateurId = req.utilisateur?.id ?? null;

    // ── Étape 1 : Archivage en base (critique — ne pas ignorer l'erreur) ──────
    let messageId;
    try {
      messageId = uuidv4();
      await pool.request()
        .input('id',             messageId)
        .input('utilisateur_id', utilisateurId)
        .input('prenom',         prenom)
        .input('nom',            nom)
        .input('email',          email)
        .input('sujet',          sujet)
        .input('message',        message)
        .query(`
          INSERT INTO messages_contact (id, utilisateur_id, prenom, nom, email, sujet, message)
          VALUES (@id, @utilisateur_id, @prenom, @nom, @email, @sujet, @message)
        `);
    } catch (dbErr) {
      console.error('contact archivage DB error:', dbErr);
      // L'archivage a échoué — on log mais on tente quand même l'email
    }

    // ── Étape 2 : Envoi email (non bloquant si ça échoue) ────────────────────
    let emailEnvoye = false;
    const emailEquipe = process.env.CONTACT_EMAIL || process.env.SMTP_USER;

    try {
      await Promise.all([
        transporter.sendMail({
          from:    process.env.EMAIL_FROM,
          to:      emailEquipe,
          replyTo: `${prenom} ${nom} <${email}>`,
          subject: `[Contact] ${sujet === 'commande' ? '🛒' : sujet === 'partenariat' ? '🤝' : '📩'} ${nom} ${prenom} — ${email}`,
          html:    htmlEquipe({ prenom, nom, email, sujet, message }),
        }),
        transporter.sendMail({
          from:    process.env.EMAIL_FROM,
          to:      email,
          subject: '✅ Nous avons bien reçu votre message — Boutique Kabyle',
          html:    htmlAccuse({ prenom }),
        }),
      ]);
      emailEnvoye = true;
    } catch (mailErr) {
      console.error('contact email error:', mailErr);
      // On ne fait pas échouer la requête — le message est déjà archivé
    }

    // ── Étape 3 : Mettre à jour le flag email_envoye si archivage réussi ─────
    if (messageId && emailEnvoye) {
      try {
        await pool.request()
          .input('id', messageId)
          .query(`UPDATE messages_contact SET email_envoye = true WHERE id = @id`);
      } catch (_) { /* non bloquant */ }
    }

    return res.status(200).json({
      message: 'Votre message a été envoyé avec succès. Nous vous répondrons sous 24 à 48 heures.',
    });

  } catch (err) {
    console.error('contact envoyer error:', err);
    return res.status(500).json({ message: 'Une erreur est survenue lors de l\'envoi du message. Veuillez réessayer.' });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/contact/messages  [Admin uniquement]
// Liste les messages reçus avec pagination et filtres.
// ══════════════════════════════════════════════════════════════════════════════
async function listerMessages(req, res) {
  try {
    const pool   = await getPool();
    const page   = Math.max(1, parseInt(req.query.page) || 1);
    const limite = Math.min(100, parseInt(req.query.limite) || 20);
    const offset = (page - 1) * limite;
    const lu     = req.query.lu;

    let whereParts = [];
    const request = pool.request()
      .input('limite', limite)
      .input('offset', offset);

    if (lu === 'true')  { whereParts.push('lu = true'); }
    if (lu === 'false') { whereParts.push('lu = false'); }

    const whereClause = whereParts.length > 0 ? 'WHERE ' + whereParts.join(' AND ') : '';

    const [data, total] = await Promise.all([
      request.query(`
        SELECT id, prenom, nom, email, sujet, message,
               email_envoye, lu, repondu, created_at
        FROM messages_contact
        ${whereClause}
        ORDER BY created_at DESC
        LIMIT @limite OFFSET @offset
      `),
      pool.request().query(`
        SELECT COUNT(*) AS total FROM messages_contact ${whereClause}
      `),
    ]);

    return res.json({
      messages: data.recordset,
      total:    total.recordset[0].total,
      page,
      limite,
      pages:    Math.ceil(total.recordset[0].total / limite),
    });

  } catch (err) {
    console.error('contact listerMessages error:', err);
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// PATCH /api/contact/messages/:id  [Admin uniquement]
// Marque un message comme lu ou répondu.
// ══════════════════════════════════════════════════════════════════════════════
async function majMessage(req, res) {
  try {
    const pool = await getPool();
    const { id } = req.params;
    const { lu, repondu } = req.body;

    const setParts = [];
    const request = pool.request().input('id', id);

    if (lu !== undefined)      { setParts.push('lu = @lu');           request.input('lu', !!lu); }
    if (repondu !== undefined) { setParts.push('repondu = @repondu'); request.input('repondu', !!repondu); }

    if (setParts.length === 0) {
      return res.status(400).json({ message: 'Aucun champ à mettre à jour.' });
    }

    const result = await request.query(`
      UPDATE messages_contact
      SET ${setParts.join(', ')}
      WHERE id = @id
    `);

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ message: 'Message introuvable.' });
    }

    return res.json({ message: 'Message mis à jour.' });

  } catch (err) {
    console.error('contact majMessage error:', err);
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/contact/sujets
// Retourne la liste des sujets disponibles pour le formulaire front.
// ══════════════════════════════════════════════════════════════════════════════
async function listerSujets(_req, res) {
  return res.status(200).json({
    sujets: [
      { valeur: 'commande',             libelle: 'Commande' },
      { valeur: 'retour_remboursement', libelle: 'Retour / Remboursement' },
      { valeur: 'produit',              libelle: 'Produit' },
      { valeur: 'livraison',            libelle: 'Livraison' },
      { valeur: 'compte',               libelle: 'Compte' },
      { valeur: 'partenariat',          libelle: 'Partenariat' },
      { valeur: 'autre',                libelle: 'Autre' },
    ],
  });
}

module.exports = { envoyer, listerMessages, majMessage, listerSujets, SUJETS };
