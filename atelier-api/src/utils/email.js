// src/utils/email.js
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT) || 587,
  secure: process.env.SMTP_PORT === '465',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// Vérifie la connexion SMTP une fois au démarrage du serveur : si les
// identifiants (.env) sont manquants ou invalides, ça s'affiche tout de
// suite dans les logs au lancement, au lieu de découvrir le problème
// silencieusement à la première commande (l'erreur d'envoi est attrapée
// et journalisée, mais ne bloque jamais la création de la commande —
// donc sans ce contrôle, un mauvais mot de passe SMTP peut passer
// inaperçu pendant longtemps).
transporter.verify((err) => {
  if (err) {
    console.error('❌  SMTP invalide — les emails (confirmation, notif admin, etc.) ne partiront PAS :', err.message);
  } else {
    console.log(`✅  SMTP connecté (${process.env.SMTP_USER || '???'} via ${process.env.SMTP_HOST || '???'})`);
  }
});

// FRONTEND_URL peut contenir plusieurs origines séparées par des virgules
// (utilisé ailleurs pour la config CORS). Pour les liens envoyés par email,
// on ne veut qu'UNE seule URL propre : on prend la première.
const FRONTEND_URL = (process.env.FRONTEND_URL || '').split(',')[0].trim().replace(/\/$/, '');
const SHOP_NAME = process.env.SHOP_NAME || 'Atelier S.L';
const SHOP_DOMAIN = FRONTEND_URL.replace(/^https?:\/\//, '');

// ─── Styles partagés ──────────────────────────────────────────────────────────
const COULEUR_PRINCIPALE = '#8B4513';
const btnStyle = `display:inline-block;padding:12px 24px;background:${COULEUR_PRINCIPALE};color:#fff;text-decoration:none;border-radius:4px;margin:16px 0`;
const wrapperStyle = `font-family:Arial,sans-serif;max-width:600px;margin:auto;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden`;
function header(titre) {
  return `<div style="background:${COULEUR_PRINCIPALE};padding:20px 24px"><h2 style="color:#fff;margin:0">${titre}</h2></div>`;
}
function footer() {
  return `<div style="background:#f9fafb;padding:12px 24px;font-size:12px;color:#9ca3af;text-align:center">
    © ${SHOP_NAME} — <a href="${FRONTEND_URL}" style="color:${COULEUR_PRINCIPALE}">${SHOP_DOMAIN}</a>
  </div>`;
}

// ─── 1. Vérification email après inscription ──────────────────────────────────
async function envoyerEmailVerification(utilisateur, token) {
  const lien = `${FRONTEND_URL}/verify-email?token=${token}`;
  await transporter.sendMail({
    from:    process.env.EMAIL_FROM,
    to:      utilisateur.email,
    subject: '✅ Vérifiez votre adresse email — Boutique Kabyle',
    html: `
      <div style="${wrapperStyle}">
        ${header('Bienvenue, ' + utilisateur.prenom + ' !')}
        <div style="padding:24px">
          <p>Merci de vous être inscrit(e) sur notre boutique.
             Cliquez sur le bouton ci-dessous pour vérifier votre adresse email :</p>
          <a href="${lien}" style="${btnStyle}">Vérifier mon email</a>
          <p style="color:#666;font-size:13px">
            Ce lien expire dans 24 heures.<br>
            Si vous n'avez pas créé de compte, ignorez cet email.
          </p>
        </div>
        ${footer()}
      </div>
    `,
  });
}

// ─── 2. Réinitialisation du mot de passe ─────────────────────────────────────
async function envoyerEmailReinitialisationMdp(utilisateur, token) {
  const lien = `${FRONTEND_URL}/reset-password?token=${token}`;
  await transporter.sendMail({
    from:    process.env.EMAIL_FROM,
    to:      utilisateur.email,
    subject: '🔑 Réinitialisation de votre mot de passe — Boutique Kabyle',
    html: `
      <div style="${wrapperStyle}">
        ${header('Réinitialisation du mot de passe')}
        <div style="padding:24px">
          <p>Vous avez demandé à réinitialiser votre mot de passe.
             Cliquez sur le bouton ci-dessous (valable 1 heure) :</p>
          <a href="${lien}" style="${btnStyle}">Réinitialiser mon mot de passe</a>
          <p style="color:#666;font-size:13px">
            Si vous n'avez pas fait cette demande, ignorez cet email.
          </p>
        </div>
        ${footer()}
      </div>
    `,
  });
}

// ─── 3. Email de bienvenue après vérification réussie ────────────────────────
async function envoyerEmailBienvenue(utilisateur) {
  await transporter.sendMail({
    from:    process.env.EMAIL_FROM,
    to:      utilisateur.email,
    subject: '🎉 Bienvenue sur Boutique Kabyle !',
    html: `
      <div style="${wrapperStyle}">
        ${header('Votre compte est activé !')}
        <div style="padding:24px">
          <p>Bonjour <strong>${utilisateur.prenom}</strong>,</p>
          <p>
            Votre adresse email a été vérifiée avec succès. Votre compte est maintenant
            pleinement actif — vous pouvez parcourir notre catalogue et passer commande.
          </p>
          <a href="${FRONTEND_URL}/boutique" style="${btnStyle}">
            Découvrir la boutique
          </a>
          <p style="color:#666;font-size:13px;margin-top:24px">
            Besoin d'aide ? Contactez-nous via notre
            <a href="${FRONTEND_URL}/contact" style="color:${COULEUR_PRINCIPALE}">formulaire de contact</a>.
          </p>
        </div>
        ${footer()}
      </div>
    `,
  });
}

// ─── 4. Confirmation de commande envoyée au client ───────────────────────────
async function envoyerConfirmationCommande(commande, utilisateur, lignes) {
  const lienCommande = `${FRONTEND_URL}/mon-compte/commandes/${commande.id}`;
  const statutLabel  = {
    a_la_livraison: 'À convenir (WhatsApp)',
    a_convenir_france: 'À convenir (WhatsApp)',
    carte:          'Carte bancaire',
    edahabia:       'Edahabia',
    cib:            'CIB',
    virement:       'Virement bancaire',
  }[commande.methode_paiement] || commande.methode_paiement || 'Non précisé';

  const lignesHtml = (lignes || []).map(l => `
    <tr>
      <td style="padding:8px 4px;border-bottom:1px solid #f3f4f6">
        ${l.produit_nom}
        ${l.produit_taille  ? `<span style="color:#6b7280"> — ${l.produit_taille}</span>`  : ''}
        ${l.produit_couleur ? `<span style="color:#6b7280"> / ${l.produit_couleur}</span>` : ''}
      </td>
      <td style="padding:8px 4px;border-bottom:1px solid #f3f4f6;text-align:center">${l.quantite}</td>
      <td style="padding:8px 4px;border-bottom:1px solid #f3f4f6;text-align:right">${Number(l.prix_unitaire).toLocaleString('fr-DZ')} DZD</td>
      <td style="padding:8px 4px;border-bottom:1px solid #f3f4f6;text-align:right">${Number(l.sous_total_ligne || l.prix_unitaire * l.quantite).toLocaleString('fr-DZ')} DZD</td>
    </tr>
  `).join('');

  await transporter.sendMail({
    from:    process.env.EMAIL_FROM,
    to:      utilisateur.email,
    subject: `🛍️ Votre commande ${commande.numero} a été reçue — Boutique Kabyle`,
    html: `
      <div style="${wrapperStyle}">
        ${header('Confirmation de commande')}
        <div style="padding:24px">
          <p>Bonjour <strong>${utilisateur.prenom}</strong>,</p>
          <p>
            Merci pour votre commande ! Nous l'avons bien reçue et elle est en cours de traitement.
          </p>

          <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px">
            <tr style="background:#f9fafb">
              <th style="padding:8px 4px;text-align:left;color:#374151">Article</th>
              <th style="padding:8px 4px;text-align:center;color:#374151">Qté</th>
              <th style="padding:8px 4px;text-align:right;color:#374151">P.U.</th>
              <th style="padding:8px 4px;text-align:right;color:#374151">Total</th>
            </tr>
            ${lignesHtml}
          </table>

          <table style="width:100%;font-size:14px;margin-top:8px">
            ${commande.remise > 0 ? `
            <tr>
              <td style="padding:4px 0;color:#6b7280">Sous-total</td>
              <td style="padding:4px 0;text-align:right">${Number(commande.sous_total).toLocaleString('fr-DZ')} DZD</td>
            </tr>
            <tr>
              <td style="padding:4px 0;color:#059669">Remise (${commande.code_promo || 'code promo'})</td>
              <td style="padding:4px 0;text-align:right;color:#059669">−${Number(commande.remise).toLocaleString('fr-DZ')} DZD</td>
            </tr>
            ` : ''}
            <tr>
              <td style="padding:4px 0;color:#6b7280">Frais de livraison</td>
              <td style="padding:4px 0;text-align:right">${Number(commande.frais_livraison || 0) === 0 ? 'Offerts' : Number(commande.frais_livraison).toLocaleString('fr-DZ') + ' DZD'}</td>
            </tr>
            <tr style="font-weight:bold;font-size:16px;border-top:2px solid #e5e7eb">
              <td style="padding:8px 0">Total</td>
              <td style="padding:8px 0;text-align:right;color:${COULEUR_PRINCIPALE}">${Number(commande.total).toLocaleString('fr-DZ')} DZD</td>
            </tr>
          </table>

          <p style="margin-top:16px;font-size:14px;color:#374151">
            <strong>Mode de paiement :</strong> ${statutLabel}
          </p>

          <a href="${lienCommande}" style="${btnStyle}">Suivre ma commande</a>

          <p style="color:#666;font-size:13px;margin-top:24px">
            Pour toute question concernant votre commande, mentionnez le numéro
            <strong>${commande.numero}</strong> dans votre message.
          </p>
        </div>
        ${footer()}
      </div>
    `,
  });
}

// ─── 5. Changement de statut de commande ─────────────────────────────────────
async function envoyerChangementStatut(commande, utilisateur, nouveauStatut) {
  const lienCommande = `${FRONTEND_URL}/mon-compte/commandes/${commande.id}`;

  const infos = {
    confirmee:      { emoji: '✅', titre: 'Commande confirmée',         texte: 'Votre commande a été confirmée et va bientôt être préparée.' },
    en_preparation: { emoji: '📦', titre: 'Commande en préparation',    texte: 'Notre équipe prépare votre commande avec soin.' },
    expediee:       { emoji: '🚚', titre: 'Commande expédiée',          texte: 'Votre colis est en route ! Il devrait arriver dans les prochains jours.' },
    livree:         { emoji: '🎉', titre: 'Commande livrée',            texte: 'Votre commande a été livrée. Nous espérons qu\'elle vous satisfait pleinement !' },
    annulee:        { emoji: '❌', titre: 'Commande annulée',           texte: 'Votre commande a été annulée. Si vous avez été débité(e), le remboursement sera traité sous 3 à 5 jours ouvrables.' },
    remboursee:     { emoji: '💰', titre: 'Remboursement effectué',     texte: 'Le remboursement de votre commande a été effectué.' },
  };

  const info = infos[nouveauStatut] || { emoji: 'ℹ️', titre: 'Mise à jour de commande', texte: `Le statut de votre commande est passé à : ${nouveauStatut}.` };

  await transporter.sendMail({
    from:    process.env.EMAIL_FROM,
    to:      utilisateur.email,
    subject: `${info.emoji} ${info.titre} — ${commande.numero}`,
    html: `
      <div style="${wrapperStyle}">
        ${header(info.emoji + ' ' + info.titre)}
        <div style="padding:24px">
          <p>Bonjour <strong>${utilisateur.prenom}</strong>,</p>
          <p>${info.texte}</p>
          <p style="font-size:14px;color:#374151">
            <strong>Commande :</strong> ${commande.numero}<br>
            <strong>Montant :</strong> ${Number(commande.total).toLocaleString('fr-DZ')} DZD
          </p>
          <a href="${lienCommande}" style="${btnStyle}">Voir ma commande</a>
          <p style="color:#666;font-size:13px;margin-top:24px">
            Des questions ? Contactez-nous en mentionnant le numéro <strong>${commande.numero}</strong>.
          </p>
        </div>
        ${footer()}
      </div>
    `,
  });
}

// ─── 6. Alerte stock bas (admin) ──────────────────────────────────────────────
async function envoyerAlertStockBas(variante, produit) {
  const lienAdmin = `${FRONTEND_URL}/admin/produits/${produit.id}`;
  const detail    = [variante.taille, variante.couleur].filter(Boolean).join(' / ');
  const adminEmail = process.env.ADMIN_EMAIL || process.env.EMAIL_FROM;

  await transporter.sendMail({
    from:    process.env.EMAIL_FROM,
    to:      adminEmail,
    subject: `⚠️ Stock bas : ${produit.nom}${detail ? ' (' + detail + ')' : ''}`,
    html: `
      <div style="${wrapperStyle}">
        ${header('⚠️ Alerte stock bas')}
        <div style="padding:24px">
          <p>Le stock d'une variante est passé sous le seuil d'alerte :</p>
          <table style="width:100%;border-collapse:collapse;font-size:14px;margin:16px 0">
            <tr><td style="padding:6px 0;color:#6b7280;width:160px">Produit</td><td style="padding:6px 0;font-weight:600">${produit.nom}</td></tr>
            ${detail ? `<tr><td style="padding:6px 0;color:#6b7280">Variante</td><td style="padding:6px 0">${detail}</td></tr>` : ''}
            <tr><td style="padding:6px 0;color:#6b7280">SKU</td><td style="padding:6px 0">${variante.sku || '—'}</td></tr>
            <tr>
              <td style="padding:6px 0;color:#6b7280">Stock actuel</td>
              <td style="padding:6px 0;font-weight:bold;color:#dc2626">${variante.stock} unité(s)</td>
            </tr>
            <tr><td style="padding:6px 0;color:#6b7280">Seuil d'alerte</td><td style="padding:6px 0">${variante.stock_alerte} unité(s)</td></tr>
          </table>
          <a href="${lienAdmin}" style="${btnStyle}">Gérer le stock</a>
        </div>
        ${footer()}
      </div>
    `,
  });
}

// ─── 7. Notification admin — nouvelle commande ────────────────────────────────
async function envoyerNotificationAdminNouvelleCommande(commande, clientInfo, lignes) {
  const adminEmail = process.env.ADMIN_EMAIL || process.env.EMAIL_FROM;
  const lienAdmin   = `${process.env.APP_URL || FRONTEND_URL}/admin/commandes/${commande.id}`;
  const nomClient   = [clientInfo?.prenom, clientInfo?.nom].filter(Boolean).join(' ') || 'Client';
  const contact     = clientInfo?.email || commande.invite_email || '—';
  const telephone   = clientInfo?.telephone || commande.invite_telephone || '—';

  const lignesHtml = (lignes || []).map(l => `
    <tr>
      <td style="padding:8px 4px;border-bottom:1px solid #f3f4f6">
        ${l.produit_nom}
        ${l.produit_taille  ? `<span style="color:#6b7280"> — ${l.produit_taille}</span>`  : ''}
        ${l.produit_couleur ? `<span style="color:#6b7280"> / ${l.produit_couleur}</span>` : ''}
      </td>
      <td style="padding:8px 4px;border-bottom:1px solid #f3f4f6;text-align:center">${l.quantite}</td>
      <td style="padding:8px 4px;border-bottom:1px solid #f3f4f6;text-align:right">${Number(l.sous_total_ligne || l.prix_unitaire * l.quantite).toLocaleString('fr-DZ')} DZD</td>
    </tr>
  `).join('');

  await transporter.sendMail({
    from:    process.env.EMAIL_FROM,
    to:      adminEmail,
    subject: `🛎️ Nouvelle commande ${commande.numero} — ${Number(commande.total).toLocaleString('fr-DZ')} DZD`,
    html: `
      <div style="${wrapperStyle}">
        ${header('🛎️ Nouvelle commande reçue')}
        <div style="padding:24px">
          <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:16px">
            <tr><td style="padding:6px 0;color:#6b7280;width:160px">Numéro</td><td style="padding:6px 0;font-weight:600">${commande.numero}</td></tr>
            <tr><td style="padding:6px 0;color:#6b7280">Client</td><td style="padding:6px 0">${nomClient}</td></tr>
            <tr><td style="padding:6px 0;color:#6b7280">Email</td><td style="padding:6px 0">${contact}</td></tr>
            <tr><td style="padding:6px 0;color:#6b7280">Téléphone</td><td style="padding:6px 0">${telephone}</td></tr>
          </table>

          <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px">
            <tr style="background:#f9fafb">
              <th style="padding:8px 4px;text-align:left;color:#374151">Article</th>
              <th style="padding:8px 4px;text-align:center;color:#374151">Qté</th>
              <th style="padding:8px 4px;text-align:right;color:#374151">Total</th>
            </tr>
            ${lignesHtml}
          </table>

          <table style="width:100%;font-size:14px;margin-top:8px">
            <tr style="font-weight:bold;font-size:16px;border-top:2px solid #e5e7eb">
              <td style="padding:8px 0">Total commande</td>
              <td style="padding:8px 0;text-align:right;color:${COULEUR_PRINCIPALE}">${Number(commande.total).toLocaleString('fr-DZ')} DZD</td>
            </tr>
          </table>

          <a href="${lienAdmin}" style="${btnStyle}">Voir la commande dans l'admin</a>
        </div>
        ${footer()}
      </div>
    `,
  });
}

module.exports = {
  transporter,
  envoyerEmailVerification,
  envoyerEmailReinitialisationMdp,
  envoyerEmailBienvenue,
  envoyerConfirmationCommande,
  envoyerChangementStatut,
  envoyerAlertStockBas,
  envoyerNotificationAdminNouvelleCommande,
};