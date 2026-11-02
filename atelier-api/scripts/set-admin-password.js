/**
 * scripts/set-admin-password.js
 *
 * Définit (ou réinitialise) le mot de passe d'un compte admin
 * SANS jamais faire transiter le hash bcrypt par un fichier
 * versionné dans le dépôt.
 *
 * Le mot de passe en clair est lu depuis une variable
 * d'environnement (ou saisi de façon masquée si absente),
 * jamais depuis un argument en ligne de commande (visible dans
 * l'historique du shell / `ps aux`) ni depuis un fichier.
 *
 * Usage :
 *   ADMIN_EMAIL=admin@example.com \
 *   ADMIN_PASSWORD='mot-de-passe-fort' \
 *   node scripts/set-admin-password.js
 *
 * Ou sans ADMIN_PASSWORD pour une saisie interactive masquée :
 *   ADMIN_EMAIL=admin@example.com node scripts/set-admin-password.js
 *
 * Prérequis : le fichier .env du projet doit être chargé (DB_*,
 * BCRYPT_ROUNDS) — ce script utilise la même config que l'API.
 */

require('dotenv').config();
const bcrypt = require('bcryptjs');
const readline = require('readline');
const { getPool, sql } = require('../src/config/db');

const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS, 10) || 12;

function lireMotDePasseMasque(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    // Masque la saisie caractère par caractère (pas d'écho en clair)
    const stdin = process.stdin;
    let motDePasse = '';
    process.stdout.write(question);

    const onData = (char) => {
      char = char.toString('utf8');
      switch (char) {
        case '\n':
        case '\r':
        case '\u0004':
          stdin.setRawMode(false);
          stdin.pause();
          stdin.removeListener('data', onData);
          process.stdout.write('\n');
          rl.close();
          resolve(motDePasse);
          break;
        case '\u0003': // Ctrl+C
          process.exit(1);
          break;
        case '\u007f': // backspace
          motDePasse = motDePasse.slice(0, -1);
          break;
        default:
          motDePasse += char;
          break;
      }
    };

    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    stdin.on('data', onData);
  });
}

async function main() {
  const email = process.env.ADMIN_EMAIL;
  if (!email) {
    console.error('❌  Variable ADMIN_EMAIL manquante.');
    console.error(
      "    Exemple : ADMIN_EMAIL=admin@example.com node scripts/set-admin-password.js"
    );
    process.exit(1);
  }

  let motDePasse = process.env.ADMIN_PASSWORD;
  if (!motDePasse) {
    motDePasse = await lireMotDePasseMasque(
      `Nouveau mot de passe pour ${email} : `
    );
  }

  if (!motDePasse || motDePasse.length < 8) {
    console.error('❌  Le mot de passe doit contenir au moins 8 caractères.');
    process.exit(1);
  }

  const hash = await bcrypt.hash(motDePasse, BCRYPT_ROUNDS);

  const pool = await getPool();
  const result = await pool
    .request()
    .input('email', sql.NVarChar, email)
    .input('hash', sql.NVarChar, hash).query(`
      UPDATE utilisateurs
      SET mot_de_passe_hash = @hash,
          updated_at = NOW()
      WHERE email = @email
        AND role = N'admin'
    `);

  if (result.rowsAffected[0] === 0) {
    console.error(
      `❌  Aucun compte admin trouvé avec l'email ${email}. Aucune modification effectuée.`
    );
    process.exit(1);
  }

  console.log(`✅  Mot de passe mis à jour pour le compte admin ${email}.`);
  console.log(
    '    Le hash bcrypt a été écrit directement en base — il n\'a jamais transité par un fichier du dépôt.'
  );
  process.exit(0);
}

main().catch((err) => {
  console.error('❌  Erreur :', err.message);
  process.exit(1);
});