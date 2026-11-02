// src/config/db.js
// ============================================================
//  Adaptateur MySQL (Hostinger hPanel) — compatible avec l'API
//  "mssql-like" utilisée dans le reste du code
//  (getRequest().input().query()), pour éviter de réécrire tous
//  les appels .input() dans les controllers. Seule la SYNTAXE SQL
//  spécifique à chaque moteur (RETURNING, ON CONFLICT, ::casts,
//  jsonb ->>, etc.) a été adaptée fichier par fichier — voir
//  00_master_deploiement_mysql.sql pour le détail des équivalences.
// ============================================================
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host:     process.env.DB_HOST,
  port:     process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 3306,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  // Hostinger MySQL n'exige pas SSL par défaut (contrairement à Supabase).
  // Mettre DB_SSL=true dans .env si votre hébergeur l'impose.
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  // Renvoie les DATE/DATETIME sous forme de chaînes 'YYYY-MM-DD HH:MM:SS'
  // plutôt que des objets JS Date, pour un comportement plus prévisible
  // côté JSON.stringify() (évite les décalages de fuseau horaire).
  dateStrings: true,
  decimalNumbers: true, // decimal(10,2) → nombre JS plutôt que string
});

pool.on && pool.on('error', (err) => {
  console.error('❌  Erreur inattendue du pool MySQL :', err);
});

// ------------------------------------------------------------
// Types "no-op" — gardent la syntaxe sql.UniqueIdentifier,
// sql.NVarChar(255), etc. utilisée partout dans les controllers,
// sans que MySQL en ait besoin (typage dynamique par valeur JS).
// ------------------------------------------------------------
const sql = {
  UniqueIdentifier: 'char(36)',
  Int: 'int',
  BigInt: 'bigint',
  TinyInt: 'tinyint',
  Bit: 'tinyint',
  DateTime2: 'datetime',
  Date: 'date',
  NChar: (_len) => 'char',
  Float: 'double',
  NVarChar: (_len) => 'text',
  VarChar: (_len) => 'text',
  Decimal: (_p, _s) => 'decimal',
  MAX: -1, // compat sql.NVarChar(sql.MAX)
};

// ------------------------------------------------------------
// SqlRequest — remplace le Request de mssql / le PgRequest pg.
// .input(nom, [type,] valeur) mémorise le paramètre.
// .query(texte) remplace chaque @nom par ? dans l'ordre
// d'apparition, PUIS exécute réellement via mysql2.
//
// ⚠️ Contrairement à PostgreSQL ($1, $1, $1 peut être réutilisé),
// MySQL avec des "?" positionnels exige UNE valeur par occurrence.
// Si @nom apparaît plusieurs fois dans la requête, sa valeur est
// donc poussée plusieurs fois dans le tableau `values` (une fois
// par occurrence), plutôt que dédoublonnée.
// ------------------------------------------------------------
class SqlRequest {
  constructor(conn) {
    this.conn = conn; // pool ou connexion de transaction (mysql2)
    this.params = {};
  }

  input(name, typeOrValue, maybeValue) {
    // Compat : .input('nom', valeur) OU .input('nom', sql.Type, valeur)
    const value = maybeValue !== undefined ? maybeValue : typeOrValue;
    this.params[name] = value;
    return this;
  }

  async query(text) {
    const values = [];

    const converted = text.replace(/@([a-zA-Z_][a-zA-Z0-9_]*)/g, (match, name) => {
      if (!(name in this.params)) {
        console.warn(`⚠️  Paramètre @${name} référencé mais non fourni via .input()`);
        return match;
      }
      values.push(this.params[name]);
      return '?';
    });

    const [rows, fields] = await this.conn.query(converted, values);

    // INSERT/UPDATE/DELETE renvoient un ResultSetHeader (objet, pas
    // un tableau) ; SELECT renvoie un tableau de lignes.
    const isResultSetHeader = rows && !Array.isArray(rows);

    return {
      recordset:    isResultSetHeader ? [] : rows,
      recordsets:   isResultSetHeader ? [[]] : [rows],
      rowsAffected: [isResultSetHeader ? rows.affectedRows : rows.length],
      insertId:     isResultSetHeader ? rows.insertId : undefined,
    };
  }
}

// Compat : certains controllers appellent `pool.request()` directement
// (comme en mssql) plutôt que `getRequest()`.
pool.request = () => new SqlRequest(pool);

async function getPool() {
  return pool;
}

/**
 * Teste réellement la connexion. À appeler une fois au démarrage du
 * serveur pour échouer immédiatement si les identifiants DB_* sont
 * incorrects, au lieu de planter plus tard sur la première vraie
 * requête reçue.
 */
async function verifierConnexion() {
  const conn = await pool.getConnection();
  try {
    await conn.query('SELECT 1');
  } finally {
    conn.release();
  }
}

async function getRequest() {
  return new SqlRequest(pool);
}

/**
 * Pour les transactions (remplace `new sql.Transaction(pool)` de mssql
 * / `getClient()` de pg). Usage :
 *   const conn = await getClient();
 *   try {
 *     await conn.query('BEGIN');
 *     const req = new SqlRequest(conn);
 *     await req.input('id', sql.UniqueIdentifier, id).query('...');
 *     await conn.query('COMMIT');
 *   } catch (e) {
 *     await conn.query('ROLLBACK');
 *     throw e;
 *   } finally {
 *     conn.release();
 *   }
 */
async function getClient() {
  return pool.getConnection();
}

module.exports = { sql, getPool, getRequest, getClient, verifierConnexion, SqlRequest };
