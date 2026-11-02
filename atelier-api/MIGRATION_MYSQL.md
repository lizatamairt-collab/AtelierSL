# Migration PostgreSQL (Supabase) → MySQL (Hostinger)

Ce backend utilisait `pg` (PostgreSQL/Supabase). Il a été entièrement migré
vers `mysql2` pour tourner sur MySQL Hostinger, en cohérence avec
`database/00_master_deploiement_mysql.sql`.

## Ce qui a changé

### 1. Driver de base de données
- `src/config/db.js` réécrit intégralement : `pg` → `mysql2/promise`.
- L'interface `getRequest()/getPool()/getClient()/.input().query()` a été
  conservée à l'identique pour ne pas casser les ~135 requêtes existantes
  dans les contrôleurs. Seule la classe interne a été renommée
  `PgRequest` → `SqlRequest`.
- Connexion désormais via `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`,
  `DB_NAME` (au lieu de `DATABASE_URL`). Voir `env.example`.

### 2. Syntaxe SQL adaptée (par fichier)
- **Pagination** `OFFSET x ROWS FETCH NEXT y ROWS ONLY` → `LIMIT y OFFSET x`
  (11 contrôleurs).
- **`RETURNING *`** (inexistant en MySQL) → génération de l'UUID en JS
  (`uuidv4()`) avant l'`INSERT`, puis `SELECT` si besoin de relire la ligne
  (`lookbook.controller.js`, `contact.controller.js`).
- **`ON CONFLICT ... DO UPDATE SET ... EXCLUDED.x`** →
  `ON DUPLICATE KEY UPDATE ... VALUES(x)` (`parametres.controller.js`).
- **Casts `::numeric` / `::uuid` / `::text` / `::json`** supprimés (MySQL
  est dynamiquement typé sur les paramètres liés) — `statistiques`,
  `produits`, `favoris`, `panier`, `commandes`.
- **`date_trunc('week'/'month', ...)`** (PostgreSQL uniquement) →
  `DATE_SUB(DATE(created_at), INTERVAL WEEKDAY(created_at) DAY)` (semaine)
  et `DATE_FORMAT(created_at, '%Y-%m-01')` (mois) — `statistiques.controller.js`.
- **`colonne::json->>'champ'`** → syntaxe JSON native MySQL
  `colonne->>'$.champ'` — `commandes.controller.js`.
- **`WHERE id = ANY(@ids::uuid[])`** (tableaux, non supportés par MySQL) →
  clause `IN (@id0, @id1, ...)` construite dynamiquement —
  `commandes.controller.js`.
- **Codes d'erreur** : `23505` (violation unique PG) → `'ER_DUP_ENTRY'` ;
  `23503` (violation FK PG) → `'ER_ROW_IS_REFERENCED_2'` (toutes les
  occurrences concernées sont des suppressions bloquées par une clé
  étrangère enfant).

### 3. Génération des UUID côté application
Le schéma MySQL n'a **aucune colonne `id` avec valeur par défaut** (MySQL
ne permet pas `DEFAULT UUID()` sur une colonne), contrairement au schéma
PostgreSQL d'origine. Un audit complet de tous les `INSERT INTO` du projet
a été fait ; les endroits qui ne généraient pas encore l'UUID en JS avant
insertion ont été corrigés :
- `utils/journalAdmin.js` (table `journaux_admin`)
- `controllers/newsletter.controller.js` (table `newsletter_abonnements`)
- `controllers/favoris.controller.js` (table `favoris`)
- `controllers/contact.controller.js` (table `messages_contact`)
- `controllers/lookbook.controller.js` (table `lookbook`)

Tous les autres `INSERT` généraient déjà correctement leur UUID.

### 4. `package.json`
- `"pg": "^8.13.1"` → `"mysql2": "^3.11.0"`.

## Validé en conditions réelles (MariaDB locale)

- Import complet du schéma SQL sans erreur.
- Démarrage du serveur (`verifierConnexion()` réussie).
- Tunnel de commande complet testé de bout en bout :
  panier (invité, par `session_id`) → création de commande → **numéro
  auto-généré par le trigger MySQL** (`CMD-20260902-0001`) → verrouillage
  et décrément du stock (transaction + `FOR UPDATE`) → création du
  paiement → notification admin (trigger) → **annulation** → stock
  réapprovisionné.
- Connexion admin (JWT), création lookbook (ex-`RETURNING`), lecture/écriture
  des paramètres du site (ex-`ON CONFLICT`), statistiques de ventes
  (ex-`date_trunc`) — tous testés avec succès contre une vraie base MySQL.

## À faire côté hébergement Hostinger

1. Créer la base MySQL + un utilisateur dédié dans hPanel → Bases de
   données → MySQL.
2. Importer `database/00_master_deploiement_mysql.sql` (phpMyAdmin ou
   `mysql -u ... -p ... < 00_master_deploiement_mysql.sql`).
3. Renseigner `.env` à partir de `env.example` avec les identifiants
   MySQL Hostinger (`DB_HOST` est en général `localhost`).
4. `npm install` (installe `mysql2` à la place de `pg`).
5. Redéployer normalement (Passenger relit `tmp/restart.txt`).
