// src/controllers/auth.controller.js
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { sql, getRequest } = require('../config/db');
const { envoyerEmailBienvenue } = require('../utils/email');
const { buildTokenResponse, verifyRefreshToken, signAccessToken, signRefreshToken } = require('../utils/jwt');
const { envoyerEmailVerification, envoyerEmailReinitialisationMdp } = require('../utils/email');

const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS) || 12;

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/inscription
// ─────────────────────────────────────────────────────────────────────────────
async function inscription(req, res) {
  try {
    const { nom, prenom, email, mot_de_passe, telephone } = req.body;

    const req1 = await getRequest();

    // 1. Vérifier si l'email existe déjà
    const existe = await req1
      .input('email', sql.NVarChar(255), email.toLowerCase().trim())
      .query('SELECT id FROM utilisateurs WHERE email = @email');

    if (existe.recordset.length > 0) {
      return res.status(409).json({ message: 'Cet email est déjà utilisé.' });
    }

    // 2. Hacher le mot de passe
    const hash = await bcrypt.hash(mot_de_passe, BCRYPT_ROUNDS);

    // 3. Générer un token de vérification email
    const tokenVerification = uuidv4();
    const idUtilisateur     = uuidv4();

    // 4. Insérer l'utilisateur
    const req2 = await getRequest();
    await req2
      .input('id',                 sql.UniqueIdentifier, idUtilisateur)
      .input('nom',                sql.NVarChar(100),   nom.trim())
      .input('prenom',             sql.NVarChar(100),   prenom.trim())
      .input('email',              sql.NVarChar(255),   email.toLowerCase().trim())
      .input('mot_de_passe_hash',  sql.NVarChar(255),   hash)
      .input('telephone',          sql.NVarChar(20),    telephone || null)
      .input('token_verification', sql.NVarChar(255),   tokenVerification)
      .query(`
        INSERT INTO utilisateurs
          (id, nom, prenom, email, mot_de_passe_hash, telephone, token_verification)
        VALUES
          (@id, @nom, @prenom, @email, @mot_de_passe_hash, @telephone, @token_verification)
      `);

    // 5. Récupérer l'utilisateur inséré
    const req3 = await getRequest();
    const result = await req3
      .input('id', sql.UniqueIdentifier, idUtilisateur)
      .query('SELECT id, nom, prenom, email, role, email_verifie FROM utilisateurs WHERE id = @id');

    const utilisateur = result.recordset[0];

    // 6. Envoyer l'email de vérification (non bloquant)
    envoyerEmailVerification(utilisateur, tokenVerification).catch(err =>
      console.error('Erreur envoi email vérification :', err.message)
    );

    // 7. Générer les tokens JWT
    const tokens = buildTokenResponse(utilisateur);

    return res.status(201).json({
      message: 'Inscription réussie. Vérifiez votre email pour activer votre compte.',
      ...tokens,
    });

  } catch (err) {
    console.error('inscription error:', err);
    return res.status(500).json({ message: 'Erreur serveur lors de l\'inscription.' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/connexion
// ─────────────────────────────────────────────────────────────────────────────
async function connexion(req, res) {
  try {
    const { email, mot_de_passe } = req.body;

    // 1. Chercher l'utilisateur
    const req1 = await getRequest();
    const result = await req1
      .input('email', sql.NVarChar(255), email.toLowerCase().trim())
      .query(`
        SELECT id, nom, prenom, email, mot_de_passe_hash, role, email_verifie
        FROM utilisateurs
        WHERE email = @email
      `);

    if (result.recordset.length === 0) {
      // Message générique pour ne pas révéler si l'email existe
      return res.status(401).json({ message: 'Email ou mot de passe incorrect.' });
    }

    const utilisateur = result.recordset[0];

    // 2. Vérifier le mot de passe
    const valide = await bcrypt.compare(mot_de_passe, utilisateur.mot_de_passe_hash);
    if (!valide) {
      return res.status(401).json({ message: 'Email ou mot de passe incorrect.' });
    }

    // 3. Sécurité : seul l'email autorisé peut avoir le rôle admin.
    //    Si quelqu'un a le rôle admin en base mais n'est pas dans la liste,
    //    on bloque complètement sa connexion.
    //    Liste lue depuis .env (ADMIN_EMAILS, séparés par des virgules) —
    //    jamais commitée en dur dans le code.
    const ADMIN_EMAILS_AUTORISES = (process.env.ADMIN_EMAILS || '')
      .split(',')
      .map(e => e.trim().toLowerCase())
      .filter(Boolean);
    if (utilisateur.role === 'admin' && !ADMIN_EMAILS_AUTORISES.includes(utilisateur.email.toLowerCase())) {
      return res.status(403).json({
        message: 'Accès administrateur non autorisé pour cet email.',
      });
    }

    // 4. (Optionnel) Bloquer si email non vérifié
    // if (!utilisateur.email_verifie) {
    //   return res.status(403).json({ message: 'Veuillez vérifier votre email avant de vous connecter.' });
    // }

    // 5. Répondre avec les tokens
    const tokens = buildTokenResponse(utilisateur);
    return res.status(200).json({
      message: 'Connexion réussie.',
      ...tokens,
    });

  } catch (err) {
    console.error('connexion error:', err);
    return res.status(500).json({ message: 'Erreur serveur lors de la connexion.' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/auth/verify-email?token=xxx
// ─────────────────────────────────────────────────────────────────────────────
async function verifierEmail(req, res) {
  try {
    const { token } = req.query;
    if (!token) {
      return res.status(400).json({ message: 'Token de vérification manquant.' });
    }

    const req1 = await getRequest();
    const result = await req1
      .input('token', sql.NVarChar(255), token)
      .query(`
        SELECT id, email_verifie
        FROM utilisateurs
        WHERE token_verification = @token
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ message: 'Token invalide ou déjà utilisé.' });
    }

    const u = result.recordset[0];
    if (u.email_verifie) {
      return res.status(200).json({ message: 'Email déjà vérifié.' });
    }

    const req2 = await getRequest();
    await req2
      .input('id', sql.UniqueIdentifier, u.id)
      .query(`
        UPDATE utilisateurs
        SET email_verifie = true, token_verification = NULL
        WHERE id = @id
      `);

    // Charger les infos utilisateur pour l'email de bienvenue
    const req3 = await getRequest();
    const userRes = await req3
      .input('id', sql.UniqueIdentifier, u.id)
      .query('SELECT prenom, email FROM utilisateurs WHERE id = @id');

    // Envoyer l'email de bienvenue en arrière-plan (sans bloquer la réponse)
    if (userRes.recordset.length > 0) {
      setImmediate(() => {
        envoyerEmailBienvenue(userRes.recordset[0]).catch(err =>
          console.error('Erreur email bienvenue:', err)
        );
      });
    }

    return res.status(200).json({ message: 'Email vérifié avec succès. Vous pouvez maintenant vous connecter.' });

  } catch (err) {
    console.error('verifierEmail error:', err);
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/refresh
// ─────────────────────────────────────────────────────────────────────────────
async function refreshToken(req, res) {
  try {
    const { refresh_token } = req.body;
    if (!refresh_token) {
      return res.status(400).json({ message: 'Refresh token manquant.' });
    }

    let payload;
    try {
      payload = verifyRefreshToken(refresh_token);
    } catch {
      return res.status(401).json({ message: 'Refresh token invalide ou expiré.' });
    }

    // Recharger l'utilisateur depuis la BDD (pour avoir le rôle à jour)
    const req1 = await getRequest();
    const result = await req1
      .input('id', sql.UniqueIdentifier, payload.sub)
      .query('SELECT id, nom, prenom, email, role, email_verifie FROM utilisateurs WHERE id = @id');

    if (result.recordset.length === 0) {
      return res.status(401).json({ message: 'Utilisateur introuvable.' });
    }

    const tokens = buildTokenResponse(result.recordset[0]);
    return res.status(200).json(tokens);

  } catch (err) {
    console.error('refreshToken error:', err);
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/mot-de-passe-oublie
// ─────────────────────────────────────────────────────────────────────────────
async function motDePasseOublie(req, res) {
  try {
    const { email } = req.body;

    const req1 = await getRequest();
    const result = await req1
      .input('email', sql.NVarChar(255), email.toLowerCase().trim())
      .query('SELECT id, prenom FROM utilisateurs WHERE email = @email');

    // Toujours répondre 200 pour ne pas révéler si l'email existe
    if (result.recordset.length === 0) {
      return res.status(200).json({ message: 'Si cet email existe, un lien de réinitialisation a été envoyé.' });
    }

    const utilisateur = result.recordset[0];
    const token = uuidv4();

    const req2 = await getRequest();
    await req2
      .input('token', sql.NVarChar(255),   token)
      .input('id',    sql.UniqueIdentifier, utilisateur.id)
      .query(`
        UPDATE utilisateurs
        SET token_verification = @token
        WHERE id = @id
      `);

    envoyerEmailReinitialisationMdp({ ...utilisateur, email }, token).catch(err =>
      console.error('Erreur envoi email reset :', err.message)
    );

    return res.status(200).json({ message: 'Si cet email existe, un lien de réinitialisation a été envoyé.' });

  } catch (err) {
    console.error('motDePasseOublie error:', err);
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/reinitialiser-mot-de-passe
// ─────────────────────────────────────────────────────────────────────────────
async function reinitialiserMotDePasse(req, res) {
  try {
    const { token, nouveau_mot_de_passe } = req.body;

    const req1 = await getRequest();
    const result = await req1
      .input('token', sql.NVarChar(255), token)
      .query('SELECT id FROM utilisateurs WHERE token_verification = @token');

    if (result.recordset.length === 0) {
      return res.status(404).json({ message: 'Token invalide ou expiré.' });
    }

    const hash = await bcrypt.hash(nouveau_mot_de_passe, BCRYPT_ROUNDS);

    const req2 = await getRequest();
    await req2
      .input('hash',  sql.NVarChar(255),   hash)
      .input('id',    sql.UniqueIdentifier, result.recordset[0].id)
      .query(`
        UPDATE utilisateurs
        SET mot_de_passe_hash = @hash, token_verification = NULL
        WHERE id = @id
      `);

    return res.status(200).json({ message: 'Mot de passe réinitialisé avec succès.' });

  } catch (err) {
    console.error('reinitialiserMotDePasse error:', err);
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/auth/moi  (route protégée — exemple)
// ─────────────────────────────────────────────────────────────────────────────
async function moi(req, res) {
  try {
    const req1 = await getRequest();
    const result = await req1
      .input('id', sql.UniqueIdentifier, req.utilisateur.sub)
      .query(`
        SELECT id, nom, prenom, email, telephone, role, email_verifie, created_at
        FROM utilisateurs
        WHERE id = @id
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ message: 'Utilisateur introuvable.' });
    }

    return res.status(200).json({ utilisateur: result.recordset[0] });

  } catch (err) {
    console.error('moi error:', err);
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
}

module.exports = {
  inscription,
  connexion,
  verifierEmail,
  refreshToken,
  motDePasseOublie,
  reinitialiserMotDePasse,
  moi,
};