// src/config/passport.js
// ─────────────────────────────────────────────────────────────────────────────
//  Configuration Passport.js — Google OAuth 2.0 + Facebook Login
//  Stratégie :
//    1. L'utilisateur clique "Continuer avec Google/Facebook"
//    2. Redirection vers le fournisseur → l'utilisateur s'authentifie
//    3. Callback → on cherche ou crée l'utilisateur en base
//    4. On redirige vers le frontend avec le JWT dans l'URL
// ─────────────────────────────────────────────────────────────────────────────

const passport       = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const FacebookStrategy = require('passport-facebook').Strategy;
const { v4: uuidv4 } = require('uuid');
const { sql, getRequest } = require('./db');

// ─── Serialization minimale (session utilisée seulement le temps du callback) ─
passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

// ─────────────────────────────────────────────────────────────────────────────
//  HELPER : trouver ou créer un utilisateur OAuth
// ─────────────────────────────────────────────────────────────────────────────
async function trouverOuCreerUtilisateur({ email, prenom, nom, provider, providerId }) {
  // 1. Chercher par email
  const req1 = await getRequest();
  const result = await req1
    .input('email', sql.NVarChar(255), email.toLowerCase().trim())
    .query(`
      SELECT id, nom, prenom, email, role, email_verifie
      FROM utilisateurs
      WHERE email = @email
    `);

  if (result.recordset.length > 0) {
    const user = result.recordset[0];
    // Marquer email comme vérifié si ce n'est pas déjà le cas
    if (!user.email_verifie) {
      const req2 = await getRequest();
      await req2
        .input('id', sql.UniqueIdentifier, user.id)
        .query('UPDATE utilisateurs SET email_verifie = true, updated_at = now() WHERE id = @id');
      user.email_verifie = true;
    }
    return user;
  }

  // 2. Créer un nouveau compte
  const id = uuidv4();
  const req2 = await getRequest();
  await req2
    .input('id',                sql.UniqueIdentifier, id)
    .input('nom',               sql.NVarChar(100),    (nom   || '').trim().slice(0, 100))
    .input('prenom',            sql.NVarChar(100),    (prenom|| '').trim().slice(0, 100))
    .input('email',             sql.NVarChar(255),    email.toLowerCase().trim())
    .input('mot_de_passe_hash', sql.NVarChar(255),    '')   // pas de mot de passe pour OAuth
    .input('email_verifie',     sql.Bit,              true) // email déjà vérifié par le fournisseur
    .query(`
      INSERT INTO utilisateurs
        (id, nom, prenom, email, mot_de_passe_hash, email_verifie)
      VALUES
        (@id, @nom, @prenom, @email, @mot_de_passe_hash, @email_verifie)
    `);

  return { id, nom: nom || '', prenom: prenom || '', email, role: 'client', email_verifie: true };
}

// ─────────────────────────────────────────────────────────────────────────────
//  STRATÉGIE GOOGLE
// ─────────────────────────────────────────────────────────────────────────────
passport.use(new GoogleStrategy(
  {
    clientID:     process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL:  `${process.env.APP_URL}/api/auth/google/callback`,
    scope: ['profile', 'email'],
  },
  async (_accessToken, _refreshToken, profile, done) => {
    try {
      const email  = profile.emails?.[0]?.value;
      if (!email) return done(new Error('Aucun email fourni par Google.'));

      const prenom = profile.name?.givenName  || '';
      const nom    = profile.name?.familyName || '';

      const user = await trouverOuCreerUtilisateur({
        email, prenom, nom,
        provider: 'google',
        providerId: profile.id,
      });

      return done(null, user);
    } catch (err) {
      return done(err);
    }
  }
));

// ─────────────────────────────────────────────────────────────────────────────
//  STRATÉGIE FACEBOOK
// ─────────────────────────────────────────────────────────────────────────────
passport.use(new FacebookStrategy(
  {
    clientID:     process.env.FACEBOOK_APP_ID,
    clientSecret: process.env.FACEBOOK_APP_SECRET,
    callbackURL:  `${process.env.APP_URL}/api/auth/facebook/callback`,
    profileFields: ['id', 'emails', 'name'],   // demander l'email
  },
  async (_accessToken, _refreshToken, profile, done) => {
    try {
      const email = profile.emails?.[0]?.value;
      if (!email) {
        // Facebook peut ne pas fournir d'email si l'utilisateur s'est inscrit avec un numéro
        return done(new Error('Aucun email associé à ce compte Facebook. Utilisez un autre mode de connexion.'));
      }

      const prenom = profile.name?.givenName  || '';
      const nom    = profile.name?.familyName || '';

      const user = await trouverOuCreerUtilisateur({
        email, prenom, nom,
        provider: 'facebook',
        providerId: profile.id,
      });

      return done(null, user);
    } catch (err) {
      return done(err);
    }
  }
));

module.exports = passport;
