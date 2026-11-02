-- ================================================================
--  SCRIPT MAÎTRE — MySQL (Hostinger hPanel) — Boutique Atelier S.L
--  ================================================================
--  Converti depuis le script PostgreSQL/Supabase. Contient l'ÉTAT
--  FINAL du schéma : toutes les migrations (mesures JSON, prix
--  France €, devise affichée sur les commandes) sont déjà intégrées
--  directement dans les tables — il n'y a rien d'autre à exécuter
--  après ce script.
--
--  Équivalences PostgreSQL → MySQL utilisées ici :
--    uuid                        → char(36)   (l'app génère déjà les UUID
--                                    elle-même en JS avant chaque INSERT,
--                                    donc pas de DEFAULT gen_random_uuid()
--                                    nécessaire — MySQL ne permet de toute
--                                    façon pas UUID() comme valeur DEFAULT)
--    jsonb                       → json       (natif MySQL 5.7.8+)
--    boolean                     → tinyint(1) (alias BOOLEAN reconnu par MySQL)
--    timestamptz / now()          → datetime / CURRENT_TIMESTAMP
--    text                        → text       (identique)
--    Index unique filtré (WHERE) → UNIQUE classique : MySQL autorise déjà
--                                    plusieurs NULL dans un index unique,
--                                    donc le comportement est identique
--                                    sans rien de spécial à faire
--    CREATE SEQUENCE              → table compteur dédiée + trigger
--    Trigger PL/pgSQL             → trigger MySQL (syntaxe DELIMITER)
--    x || y (concat)              → CONCAT(x, y)
--    to_char(now(),'YYYYMMDD')    → DATE_FORMAT(NOW(), '%Y%m%d')
--    col::date                    → DATE(col)
--    jsonb ->> 'champ'            → col->>'$.champ'  (opérateur MySQL natif)
--    ON CONFLICT ... DO NOTHING   → INSERT IGNORE
--
--  ⚠️ Ce script ne convertit QUE la base de données. Le pilote Node
--  (package `pg`) et les ~135 requêtes SQL dans les contrôleurs
--  devront eux aussi être adaptés pour parler à MySQL (package
--  `mysql2`) — c'est la suite du chantier.
-- ================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;


-- ================================================================
-- 1. UTILISATEURS
-- ================================================================

CREATE TABLE IF NOT EXISTS utilisateurs (
    id                  char(36)        NOT NULL,
    nom                 varchar(100)    NOT NULL,
    prenom              varchar(100)    NOT NULL,
    email               varchar(255)    NOT NULL,
    mot_de_passe_hash   varchar(255)    NOT NULL,
    telephone           varchar(20)     NULL,
    role                varchar(20)     NOT NULL DEFAULT 'client',
    email_verifie       tinyint(1)      NOT NULL DEFAULT 0,
    token_verification  varchar(255)    NULL,
    created_at          datetime        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          datetime        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_utilisateurs_email (email),
    CONSTRAINT chk_role CHECK (role IN ('client', 'admin', 'moderateur'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX idx_utilisateurs_email ON utilisateurs(email);


-- ================================================================
-- 2. ADRESSES
-- ================================================================

CREATE TABLE IF NOT EXISTS adresses (
    id              char(36)        NOT NULL,
    utilisateur_id  char(36)        NOT NULL,
    prenom          varchar(100)    NOT NULL,
    nom             varchar(100)    NOT NULL,
    rue             varchar(255)    NOT NULL,
    complement      varchar(255)    NULL,
    ville           varchar(100)    NOT NULL,
    pays            varchar(100)    NOT NULL DEFAULT 'Algérie',
    par_defaut      tinyint(1)      NOT NULL DEFAULT 0,
    created_at      datetime        NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    CONSTRAINT fk_adresses_utilisateur FOREIGN KEY (utilisateur_id)
        REFERENCES utilisateurs(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX idx_adresses_utilisateur ON adresses(utilisateur_id);


-- ================================================================
-- 3. CATEGORIES
-- ================================================================

CREATE TABLE IF NOT EXISTS categories (
    id          char(36)        NOT NULL,
    parent_id   char(36)        NULL,
    nom         varchar(100)    NOT NULL,
    slug        varchar(120)    NOT NULL,
    description text            NULL,
    image_url   varchar(500)    NULL,
    ordre       int             NOT NULL DEFAULT 0,
    active      tinyint(1)      NOT NULL DEFAULT 1,
    created_at  datetime        NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_categories_slug (slug),
    CONSTRAINT fk_categories_parent FOREIGN KEY (parent_id)
        REFERENCES categories(id) ON DELETE NO ACTION
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX idx_categories_parent ON categories(parent_id);
CREATE INDEX idx_categories_slug   ON categories(slug);


-- ================================================================
-- 4. PRODUITS  (type_produit + prix France € intégrés)
-- ================================================================

CREATE TABLE IF NOT EXISTS produits (
    id              char(36)        NOT NULL,
    categorie_id    char(36)        NULL,
    nom             varchar(255)    NOT NULL,
    slug            varchar(280)    NOT NULL,
    description     text            NULL,
    prix            decimal(10,2)   NOT NULL,
    prix_solde      decimal(10,2)   NULL,
    marque          varchar(100)    NULL,
    matiere         varchar(255)    NULL,
    entretien       text            NULL,
    actif           tinyint(1)      NOT NULL DEFAULT 1,
    featured        tinyint(1)      NOT NULL DEFAULT 0,
    type_produit    varchar(20)     NOT NULL DEFAULT 'sur_mesure',
    -- Prix France (€) : pourcentage_eur saisi par l'admin, prix_eur /
    -- prix_solde_eur recalculés côté serveur à chaque création/modif
    -- (voir produits.controller.js) — toujours tenus à jour, jamais
    -- calculés à la volée dans une requête SELECT.
    pourcentage_eur numeric(6,2)    NULL,
    prix_eur        decimal(10,2)   NULL,
    prix_solde_eur  decimal(10,2)   NULL,
    -- Liste des champs de mesures (cm) que le client doit remplir pour ce
    -- produit "sur_mesure" quand il choisit "Mes propres mesures" :
    -- [{"key":"tour_poitrine","label":"Tour de poitrine","essentiel":true}, ...]
    -- NULL = grille par défaut (voir MESURES_FIELDS_CLIENT_DEFAUT côté client).
    champs_mesures  json            NULL,
    created_at      datetime        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      datetime        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_produits_slug (slug),
    CONSTRAINT fk_produits_categorie FOREIGN KEY (categorie_id)
        REFERENCES categories(id) ON DELETE SET NULL,
    CONSTRAINT chk_produits_prix CHECK (prix >= 0),
    CONSTRAINT chk_produits_prix_solde CHECK (prix_solde IS NULL OR prix_solde >= 0),
    CONSTRAINT chk_prix_solde_inferieur CHECK (prix_solde IS NULL OR prix_solde < prix),
    CONSTRAINT chk_produits_type_produit CHECK (type_produit IN ('sur_mesure', 'stock')),
    CONSTRAINT chk_produits_pourcentage_eur CHECK (pourcentage_eur IS NULL OR pourcentage_eur > 0),
    CONSTRAINT chk_produits_prix_eur CHECK (prix_eur IS NULL OR prix_eur >= 0),
    CONSTRAINT chk_produits_prix_solde_eur CHECK (prix_solde_eur IS NULL OR prix_solde_eur >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX idx_produits_categorie ON produits(categorie_id);
CREATE INDEX idx_produits_slug      ON produits(slug);
CREATE INDEX idx_produits_actif     ON produits(actif);
CREATE INDEX idx_produits_type      ON produits(type_produit);


-- ================================================================
-- 5. VARIANTES (taille × couleur × stock × mesures cm)
-- ================================================================

CREATE TABLE IF NOT EXISTS variantes (
    id                  char(36)        NOT NULL,
    produit_id          char(36)        NOT NULL,
    taille              varchar(20)     NULL,
    couleur             varchar(50)     NULL,
    couleur_hex         varchar(7)      NULL,
    sku                 varchar(100)    NULL,
    stock               int             NOT NULL DEFAULT 0,
    stock_alerte        int             NOT NULL DEFAULT 5,
    prix_supplement     decimal(10,2)   NOT NULL DEFAULT 0,
    poids_grammes       int             NULL,
    -- Grille de mesures (cm) associée à cette taille : tour_poitrine,
    -- tour_taille, tour_hanche, epaule, epaule_a_epaule, tour_bras,
    -- encolure_avant, encolure_arriere, epaule_a_taille, taille_au_sol,
    -- manche, longueur, tour_genoux, taille_genoux, genoux_au_sol.
    mesures             json            NULL,
    actif               tinyint(1)      NOT NULL DEFAULT 1,
    created_at          datetime        NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    -- Plusieurs SKU NULL autorisés : comportement identique à l'index
    -- filtré Postgres, MySQL le fait déjà nativement sur un UNIQUE classique.
    UNIQUE KEY uq_variantes_sku (sku),
    CONSTRAINT fk_variantes_produit FOREIGN KEY (produit_id)
        REFERENCES produits(id) ON DELETE CASCADE,
    CONSTRAINT chk_variantes_taille CHECK (
        taille IS NULL OR taille IN ('XS','S','M','L','XL','XXL','2','4','6','8','10','12','UNIQUE')
    ),
    CONSTRAINT chk_variantes_stock CHECK (stock >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX idx_variantes_produit ON variantes(produit_id);
CREATE INDEX idx_variantes_sku     ON variantes(sku);


-- ================================================================
-- 6. IMAGES PRODUIT
-- ================================================================

CREATE TABLE IF NOT EXISTS images_produit (
    id          char(36)        NOT NULL,
    produit_id  char(36)        NOT NULL,
    variante_id char(36)        NULL,
    url         varchar(500)    NOT NULL,
    public_id   varchar(500)    NULL,
    alt         varchar(255)    NULL,
    ordre       int             NOT NULL DEFAULT 0,
    principale  tinyint(1)      NOT NULL DEFAULT 0,
    created_at  datetime        NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    CONSTRAINT fk_images_produit FOREIGN KEY (produit_id)
        REFERENCES produits(id) ON DELETE CASCADE,
    CONSTRAINT fk_images_variante FOREIGN KEY (variante_id)
        REFERENCES variantes(id) ON DELETE NO ACTION
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX idx_images_produit  ON images_produit(produit_id);
CREATE INDEX idx_images_variante ON images_produit(variante_id);


-- ================================================================
-- 7. CODES PROMO
-- ================================================================

CREATE TABLE IF NOT EXISTS codes_promo (
    id                  char(36)        NOT NULL,
    code                varchar(50)     NOT NULL,
    description         varchar(255)    NULL,
    type_remise         varchar(30)     NOT NULL,
    valeur              decimal(10,2)   NOT NULL,
    montant_minimum     decimal(10,2)   NULL,
    utilisations_max    int             NULL,
    utilisations_count  int             NOT NULL DEFAULT 0,
    debut_le            datetime        NULL,
    expire_le           datetime        NULL,
    actif               tinyint(1)      NOT NULL DEFAULT 1,
    created_at          datetime        NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_codes_promo_code (code),
    CONSTRAINT chk_type_remise CHECK (type_remise IN ('pourcentage', 'montant_fixe', 'livraison_gratuite')),
    CONSTRAINT chk_codes_promo_valeur CHECK (valeur > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX idx_codes_promo_code ON codes_promo(code);


-- ================================================================
-- 8. COMMANDES  (+ devise_affichee / total_devise_affichee)
-- ================================================================

-- Table compteur — remplace la SEQUENCE PostgreSQL (n'existe pas en
-- MySQL hors MariaDB 10.3+). Utilisée par le trigger trg_commande_numero
-- ci-dessous via le mécanisme AUTO_INCREMENT + LAST_INSERT_ID().
CREATE TABLE IF NOT EXISTS seq_commande_numero (
    id  bigint      NOT NULL AUTO_INCREMENT,
    PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 AUTO_INCREMENT=1;

CREATE TABLE IF NOT EXISTS commandes (
    id                  char(36)        NOT NULL,
    utilisateur_id      char(36)        NULL,
    adresse_id          char(36)        NULL,
    code_promo_id       char(36)        NULL,
    numero              varchar(20)     NOT NULL DEFAULT '',
    statut              varchar(20)     NOT NULL DEFAULT 'en_attente',
    sous_total          decimal(10,2)   NOT NULL,
    remise              decimal(10,2)   NOT NULL DEFAULT 0,
    frais_livraison     decimal(10,2)   NOT NULL DEFAULT 0,
    total               decimal(10,2)   NOT NULL,
    note_client         text            NULL,
    adresse_snapshot    json            NULL,
    invite_email        varchar(255)    NULL,
    invite_telephone    varchar(30)     NULL,
    -- Devise que le client regardait au moment de commander (Algérie =
    -- DZD, France = EUR) + total EUR indicatif calculé à cet instant.
    -- Le paiement reste géré en DZD ; ces 2 colonnes servent uniquement
    -- de référence pour recontacter/facturer les clients France.
    devise_affichee         varchar(3)      NOT NULL DEFAULT 'DZD',
    total_devise_affichee   decimal(10,2)   NULL,
    created_at          datetime        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          datetime        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_commandes_numero (numero),
    CONSTRAINT fk_commandes_utilisateur FOREIGN KEY (utilisateur_id)
        REFERENCES utilisateurs(id),
    CONSTRAINT fk_commandes_adresse FOREIGN KEY (adresse_id)
        REFERENCES adresses(id) ON DELETE SET NULL,
    CONSTRAINT fk_commandes_code_promo FOREIGN KEY (code_promo_id)
        REFERENCES codes_promo(id) ON DELETE SET NULL,
    CONSTRAINT chk_statut_commande CHECK (statut IN (
        'en_attente','confirmee','en_preparation','expediee','livree','annulee','remboursee'
    )),
    CONSTRAINT chk_commandes_sous_total CHECK (sous_total >= 0),
    CONSTRAINT chk_commandes_remise CHECK (remise >= 0),
    CONSTRAINT chk_commandes_livraison CHECK (frais_livraison >= 0),
    CONSTRAINT chk_commandes_total CHECK (total >= 0),
    CONSTRAINT chk_commandes_devise_affichee CHECK (devise_affichee IN ('DZD','EUR')),
    CONSTRAINT chk_commandes_total_devise_affichee CHECK (total_devise_affichee IS NULL OR total_devise_affichee >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX idx_commandes_utilisateur ON commandes(utilisateur_id);
CREATE INDEX idx_commandes_statut      ON commandes(statut);
CREATE INDEX idx_commandes_numero      ON commandes(numero);


-- ================================================================
-- 9. LIGNES DE COMMANDE  (+ mesures json)
-- ================================================================

CREATE TABLE IF NOT EXISTS lignes_commande (
    id                  char(36)        NOT NULL,
    commande_id         char(36)        NOT NULL,
    variante_id         char(36)        NULL,
    produit_id          char(36)        NULL,
    quantite            int             NOT NULL,
    prix_unitaire       decimal(10,2)   NOT NULL,
    produit_nom         varchar(255)    NOT NULL,
    produit_sku         varchar(100)    NULL,
    produit_taille      varchar(20)     NULL,
    produit_couleur     varchar(50)     NULL,
    produit_couleur_hex varchar(7)      NULL,
    date_evenement      date            NULL,
    -- Copie des mesures personnalisées (cm) de la ligne de panier au
    -- moment de la commande, pour la confection sur mesure.
    mesures             json            NULL,

    PRIMARY KEY (id),
    CONSTRAINT fk_lignes_commande FOREIGN KEY (commande_id)
        REFERENCES commandes(id) ON DELETE CASCADE,
    CONSTRAINT fk_lignes_commande_variante FOREIGN KEY (variante_id)
        REFERENCES variantes(id) ON DELETE SET NULL,
    CONSTRAINT fk_lignes_commande_produit FOREIGN KEY (produit_id)
        REFERENCES produits(id) ON DELETE NO ACTION,
    CONSTRAINT chk_lignes_cmd_qte CHECK (quantite > 0),
    CONSTRAINT chk_lignes_cmd_prix CHECK (prix_unitaire >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX idx_lignes_commande_commande       ON lignes_commande(commande_id);
CREATE INDEX idx_lignes_commande_variante       ON lignes_commande(variante_id);
CREATE INDEX idx_lignes_commande_produit        ON lignes_commande(produit_id);
CREATE INDEX idx_lignes_commande_date_evenement ON lignes_commande(date_evenement);


-- ================================================================
-- 10. PAIEMENTS
-- ================================================================

CREATE TABLE IF NOT EXISTS paiements (
    id              char(36)        NOT NULL,
    commande_id     char(36)        NOT NULL,
    methode         varchar(50)     NOT NULL,
    transaction_id  varchar(255)    NULL,
    statut          varchar(20)     NOT NULL DEFAULT 'en_attente',
    montant         decimal(10,2)   NOT NULL,
    devise          char(3)         NOT NULL DEFAULT 'DZD',
    details         json            NULL,
    created_at      datetime        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      datetime        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    CONSTRAINT fk_paiements_commande FOREIGN KEY (commande_id)
        REFERENCES commandes(id) ON DELETE CASCADE,
    CONSTRAINT chk_statut_paiement CHECK (statut IN ('en_attente','reussi','echoue','rembourse')),
    CONSTRAINT chk_paiements_montant CHECK (montant > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX idx_paiements_commande       ON paiements(commande_id);
CREATE INDEX idx_paiements_transaction_id ON paiements(transaction_id);


-- ================================================================
-- 11. AVIS CLIENTS
-- ================================================================

CREATE TABLE IF NOT EXISTS avis (
    id              char(36)        NOT NULL,
    produit_id      char(36)        NOT NULL,
    utilisateur_id  char(36)        NOT NULL,
    note            smallint        NOT NULL,
    titre           varchar(255)    NULL,
    commentaire     text            NULL,
    verifie         tinyint(1)      NOT NULL DEFAULT 0,
    approuve        tinyint(1)      NOT NULL DEFAULT 0,
    created_at      datetime        NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_avis_produit_utilisateur (produit_id, utilisateur_id),
    CONSTRAINT fk_avis_produit FOREIGN KEY (produit_id)
        REFERENCES produits(id) ON DELETE CASCADE,
    CONSTRAINT fk_avis_utilisateur FOREIGN KEY (utilisateur_id)
        REFERENCES utilisateurs(id) ON DELETE NO ACTION,
    CONSTRAINT chk_avis_note CHECK (note BETWEEN 1 AND 5)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX idx_avis_produit     ON avis(produit_id);
CREATE INDEX idx_avis_utilisateur ON avis(utilisateur_id);


-- ================================================================
-- 12. PANIERS
-- ================================================================

CREATE TABLE IF NOT EXISTS paniers (
    id              char(36)        NOT NULL,
    utilisateur_id  char(36)        NULL,
    session_id      varchar(255)    NULL,
    updated_at      datetime        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    -- MySQL autorise déjà plusieurs NULL dans un UNIQUE classique :
    -- comportement identique aux index filtrés Postgres.
    UNIQUE KEY uq_paniers_utilisateur (utilisateur_id),
    UNIQUE KEY uq_paniers_session (session_id),
    CONSTRAINT fk_paniers_utilisateur FOREIGN KEY (utilisateur_id)
        REFERENCES utilisateurs(id) ON DELETE CASCADE,
    CONSTRAINT chk_panier_owner CHECK (utilisateur_id IS NOT NULL OR session_id IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX idx_paniers_utilisateur ON paniers(utilisateur_id);
CREATE INDEX idx_paniers_session     ON paniers(session_id);


-- ================================================================
-- 13. LIGNES DE PANIER (+ mesures json)
-- ================================================================

CREATE TABLE IF NOT EXISTS lignes_panier (
    id              char(36)        NOT NULL,
    panier_id       char(36)        NOT NULL,
    variante_id     char(36)        NULL,
    produit_id      char(36)        NULL,
    couleur         varchar(50)     NULL,
    couleur_hex     varchar(7)      NULL,
    taille          varchar(20)     NULL,
    date_evenement  date            NULL,
    quantite        int             NOT NULL DEFAULT 1,
    -- Mesures personnalisées (cm) saisies par la cliente sur la fiche
    -- produit si elle a choisi "Mes propres mesures" plutôt qu'une
    -- taille standard.
    mesures         json            NULL,
    added_at        datetime        NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    -- Un même produit + couleur + taille ne peut apparaître qu'une fois
    -- par panier. Comme produit_id peut être NULL, MySQL exclut déjà ces
    -- lignes-là de la vérification d'unicité (même comportement que
    -- l'index filtré Postgres).
    UNIQUE KEY uq_lignes_panier_produit_choix (panier_id, produit_id, couleur, taille),
    CONSTRAINT fk_lignes_panier_panier FOREIGN KEY (panier_id)
        REFERENCES paniers(id) ON DELETE CASCADE,
    CONSTRAINT fk_lignes_panier_variante FOREIGN KEY (variante_id)
        REFERENCES variantes(id) ON DELETE CASCADE,
    CONSTRAINT fk_lignes_panier_produit FOREIGN KEY (produit_id)
        REFERENCES produits(id) ON DELETE NO ACTION,
    CONSTRAINT chk_lignes_panier_qte CHECK (quantite > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX idx_lignes_panier_panier         ON lignes_panier(panier_id);
CREATE INDEX idx_lignes_panier_variante       ON lignes_panier(variante_id);
CREATE INDEX idx_lignes_panier_produit        ON lignes_panier(produit_id);
CREATE INDEX idx_lignes_panier_date_evenement ON lignes_panier(date_evenement);


-- ================================================================
-- 14. FAVORIS
-- ================================================================

CREATE TABLE IF NOT EXISTS favoris (
    id              char(36)        NOT NULL,
    utilisateur_id  char(36)        NOT NULL,
    produit_id      char(36)        NOT NULL,
    created_at      datetime        NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_favoris_utilisateur_produit (utilisateur_id, produit_id),
    CONSTRAINT fk_favoris_utilisateur FOREIGN KEY (utilisateur_id)
        REFERENCES utilisateurs(id) ON DELETE CASCADE,
    CONSTRAINT fk_favoris_produit FOREIGN KEY (produit_id)
        REFERENCES produits(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX idx_favoris_utilisateur ON favoris(utilisateur_id);
CREATE INDEX idx_favoris_produit     ON favoris(produit_id);


-- ================================================================
-- 15. NEWSLETTER_ABONNEMENTS
-- ================================================================

CREATE TABLE IF NOT EXISTS newsletter_abonnements (
    id              char(36)        NOT NULL,
    email           varchar(255)    NOT NULL,
    utilisateur_id  char(36)        NULL,
    actif           tinyint(1)      NOT NULL DEFAULT 1,
    token_desabo    varchar(255)    NULL,
    created_at      datetime        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      datetime        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_newsletter_email (email),
    CONSTRAINT fk_newsletter_utilisateur FOREIGN KEY (utilisateur_id)
        REFERENCES utilisateurs(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX idx_newsletter_email       ON newsletter_abonnements(email);
CREATE INDEX idx_newsletter_utilisateur ON newsletter_abonnements(utilisateur_id);
CREATE INDEX idx_newsletter_actif       ON newsletter_abonnements(actif);


-- ================================================================
-- 16. MESSAGES_CONTACT
-- ================================================================

CREATE TABLE IF NOT EXISTS messages_contact (
    id              char(36)        NOT NULL,
    utilisateur_id  char(36)        NULL,
    prenom          varchar(100)    NOT NULL,
    nom             varchar(100)    NOT NULL,
    email           varchar(255)    NOT NULL,
    sujet           varchar(50)     NOT NULL,
    message         text            NOT NULL,
    email_envoye    tinyint(1)      NOT NULL DEFAULT 0,
    lu              tinyint(1)      NOT NULL DEFAULT 0,
    repondu         tinyint(1)      NOT NULL DEFAULT 0,
    created_at      datetime        NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    CONSTRAINT fk_messages_contact_utilisateur FOREIGN KEY (utilisateur_id)
        REFERENCES utilisateurs(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX idx_messages_contact_email   ON messages_contact(email);
CREATE INDEX idx_messages_contact_lu      ON messages_contact(lu);
CREATE INDEX idx_messages_contact_created ON messages_contact(created_at DESC);


-- ================================================================
-- 17. NOTIFICATIONS
-- ================================================================

CREATE TABLE IF NOT EXISTS notifications (
    id              char(36)        NOT NULL,
    utilisateur_id  char(36)        NULL,
    type            varchar(50)     NOT NULL,
    titre           varchar(255)    NOT NULL,
    contenu         text            NULL,
    lien            varchar(500)    NULL,
    lue             tinyint(1)      NOT NULL DEFAULT 0,
    created_at      datetime        NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    CONSTRAINT fk_notifications_utilisateur FOREIGN KEY (utilisateur_id)
        REFERENCES utilisateurs(id) ON DELETE CASCADE,
    CONSTRAINT chk_notif_type CHECK (type IN (
        'stock_bas', 'nouvelle_commande', 'nouvel_avis',
        'commande_livree', 'paiement_recu', 'paiement_echoue',
        'compte_cree', 'autre'
    ))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX idx_notifications_utilisateur ON notifications(utilisateur_id);
CREATE INDEX idx_notifications_lue         ON notifications(lue);
CREATE INDEX idx_notifications_type        ON notifications(type);
CREATE INDEX idx_notifications_created     ON notifications(created_at DESC);


-- ================================================================
-- 18. HISTORIQUE_STOCK
-- ================================================================

CREATE TABLE IF NOT EXISTS historique_stock (
    id              char(36)        NOT NULL,
    variante_id     char(36)        NOT NULL,
    admin_id        char(36)        NULL,
    commande_id     char(36)        NULL,
    type_mouvement  varchar(20)     NOT NULL,
    quantite_avant  int             NOT NULL,
    quantite_delta  int             NOT NULL,
    quantite_apres  int             NOT NULL,
    note            varchar(500)    NULL,
    created_at      datetime        NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    CONSTRAINT fk_hist_stock_variante FOREIGN KEY (variante_id)
        REFERENCES variantes(id) ON DELETE CASCADE,
    CONSTRAINT fk_hist_stock_admin FOREIGN KEY (admin_id)
        REFERENCES utilisateurs(id) ON DELETE SET NULL,
    CONSTRAINT fk_hist_stock_commande FOREIGN KEY (commande_id)
        REFERENCES commandes(id) ON DELETE SET NULL,
    CONSTRAINT chk_hist_stock_type CHECK (type_mouvement IN (
        'entree', 'sortie_vente', 'ajustement', 'retour', 'inventaire'
    ))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX idx_hist_stock_variante ON historique_stock(variante_id);
CREATE INDEX idx_hist_stock_commande ON historique_stock(commande_id);
CREATE INDEX idx_hist_stock_created  ON historique_stock(created_at DESC);


-- ================================================================
-- 19. JOURNAUX_ADMIN (Audit Log)
-- ================================================================

CREATE TABLE IF NOT EXISTS journaux_admin (
    id              char(36)        NOT NULL,
    admin_id        char(36)        NULL,
    action          varchar(100)    NOT NULL,
    entite          varchar(50)     NULL,
    entite_id       varchar(100)    NULL,
    details         json            NULL,
    ip_address      varchar(45)     NULL,
    user_agent      varchar(500)    NULL,
    created_at      datetime        NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    CONSTRAINT fk_journaux_admin_admin FOREIGN KEY (admin_id)
        REFERENCES utilisateurs(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX idx_journaux_admin_admin   ON journaux_admin(admin_id);
CREATE INDEX idx_journaux_admin_action  ON journaux_admin(action);
CREATE INDEX idx_journaux_admin_entite  ON journaux_admin(entite, entite_id);
CREATE INDEX idx_journaux_admin_created ON journaux_admin(created_at DESC);


-- ================================================================
-- 20. LOOKBOOK
-- ================================================================

CREATE TABLE IF NOT EXISTS lookbook (
    id              char(36)        NOT NULL,
    titre           varchar(255)    NOT NULL,
    description     text            NULL,
    image_url       varchar(500)    NULL,
    tags            varchar(255)    NULL,
    hauteur         int             NULL,
    ordre           int             NOT NULL DEFAULT 0,
    visible         tinyint(1)      NOT NULL DEFAULT 1,
    created_at      datetime        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      datetime        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX idx_lookbook_visible ON lookbook(visible);
CREATE INDEX idx_lookbook_ordre   ON lookbook(ordre);


-- ================================================================
-- 21. PARAMETRES_SITE
-- ================================================================

CREATE TABLE IF NOT EXISTS parametres_site (
    id                          tinyint         NOT NULL,
    nom_site                    varchar(255)    NOT NULL DEFAULT 'Atelier S.L',
    email_contact               varchar(255)    NULL,
    telephone_contact           varchar(30)     NULL,
    delai_livraison             varchar(255)    NULL,
    frais_livraison             decimal(10,2)   NOT NULL DEFAULT 0,
    seuil_livraison_gratuite    decimal(10,2)   NOT NULL DEFAULT 0,
    livraison_gratuite_active   tinyint(1)      NOT NULL DEFAULT 0,
    soldes_active               tinyint(1)      NOT NULL DEFAULT 0,
    maintenance_active          tinyint(1)      NOT NULL DEFAULT 0,
    instagram                   varchar(255)    NULL,
    facebook                    varchar(255)    NULL,
    tarifs_livraison_json       longtext        NULL COMMENT 'JSON {"<code_wilaya>":{"domicile":n,"stopdesk":n}, ...} — surcharge de la grille par défaut (nodejs/src/utils/tarifsLivraison.js), éditée depuis l\'admin. NULL = grille par défaut.',
    updated_at                  datetime        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    CONSTRAINT chk_parametres_site_id CHECK (id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO parametres_site (id, nom_site, email_contact, telephone_contact, delai_livraison)
VALUES (1, 'Atelier S.L', 'contact@example.com', '+213 XXX XXX XXX', '3 à 7 jours ouvrables');


SET FOREIGN_KEY_CHECKS = 1;


-- ================================================================
-- TRIGGERS
-- ================================================================
-- (updated_at est déjà géré nativement via "ON UPDATE CURRENT_TIMESTAMP"
-- sur chaque table concernée — pas besoin de trigger dédié comme en
-- PostgreSQL.)

DELIMITER $$

-- Génération automatique du numéro de commande, format identique à
-- la version PostgreSQL (CMD-YYYYMMDD-0001). Utilise la table
-- seq_commande_numero (AUTO_INCREMENT) comme compteur atomique, en
-- remplacement de CREATE SEQUENCE (indisponible en MySQL).
DROP TRIGGER IF EXISTS trg_commande_numero $$
CREATE TRIGGER trg_commande_numero
BEFORE INSERT ON commandes
FOR EACH ROW
BEGIN
    INSERT INTO seq_commande_numero VALUES (NULL);
    SET NEW.numero = CONCAT('CMD-', DATE_FORMAT(NOW(), '%Y%m%d'), '-', LPAD(LAST_INSERT_ID(), 4, '0'));
END $$

-- Notification admin sur nouvelle commande.
DROP TRIGGER IF EXISTS trg_notif_nouvelle_commande $$
CREATE TRIGGER trg_notif_nouvelle_commande
AFTER INSERT ON commandes
FOR EACH ROW
BEGIN
    INSERT INTO notifications (id, utilisateur_id, type, titre, contenu, lien)
    VALUES (
        UUID(), NULL, 'nouvelle_commande', 'Nouvelle commande reçue',
        CONCAT('Commande ', NEW.numero, ' — ', NEW.total, ' DZD'),
        CONCAT('/admin/commandes/', NEW.id)
    );
END $$

DELIMITER ;

-- ── Triggers legacy liés au stock — NON créés ici ──────────────────
-- Comme en PostgreSQL/SQL Server : le stock des produits de type
-- "stock" est géré côté application (commandes.controller.js), de
-- façon atomique dans la transaction de création de commande.
-- MySQL ne permettant pas de créer un trigger "désactivé" (contrairement
-- à ALTER TABLE ... DISABLE TRIGGER en PostgreSQL), on ne les crée
-- simplement pas ici — résultat identique. Ne pas les ajouter sans
-- aussi retirer la logique équivalente côté application (double décompte).


-- ================================================================
-- VUES UTILES
-- ================================================================

CREATE OR REPLACE VIEW v_produits_resume AS
SELECT
    p.id,
    p.nom,
    p.slug,
    p.prix,
    p.prix_solde,
    p.actif,
    c.nom                                    AS categorie,
    COALESCE(SUM(v.stock), 0)                AS stock_total,
    ROUND(AVG(a.note), 1)                    AS note_moyenne,
    COUNT(DISTINCT a.id)                     AS nb_avis,
    (
        SELECT ip.url FROM images_produit ip
        WHERE ip.produit_id = p.id AND ip.principale = 1
        LIMIT 1
    )                                         AS image_principale
FROM produits p
LEFT JOIN categories c  ON c.id = p.categorie_id
LEFT JOIN variantes v   ON v.produit_id = p.id AND v.actif = 1
LEFT JOIN avis a        ON a.produit_id = p.id AND a.approuve = 1
GROUP BY p.id, p.nom, p.slug, p.prix, p.prix_solde, p.actif, c.nom;

CREATE OR REPLACE VIEW v_commandes_dashboard AS
SELECT
    DATE(created_at)  AS jour,
    COUNT(*)          AS nb_commandes,
    SUM(total)        AS chiffre_affaires,
    AVG(total)        AS panier_moyen
FROM commandes
WHERE statut NOT IN ('annulee', 'remboursee')
GROUP BY DATE(created_at);

CREATE OR REPLACE VIEW v_commandes_urgentes AS
SELECT
    c.id                                                             AS commande_id,
    c.numero, c.statut, c.total,
    c.created_at                                                     AS date_commande,
    COALESCE(
        CONCAT(u.prenom, ' ', u.nom),
        CONCAT(JSON_UNQUOTE(JSON_EXTRACT(c.adresse_snapshot, '$.prenom')), ' ', JSON_UNQUOTE(JSON_EXTRACT(c.adresse_snapshot, '$.nom')))
    )                                                                 AS client,
    COALESCE(u.email, c.invite_email)                                AS email,
    COALESCE(u.telephone, c.invite_telephone)                        AS telephone,
    lc.produit_nom, lc.produit_taille, lc.produit_couleur,
    lc.quantite, lc.date_evenement,
    DATEDIFF(lc.date_evenement, CURDATE())                           AS jours_restants
FROM commandes c
LEFT JOIN utilisateurs    u  ON u.id = c.utilisateur_id
JOIN lignes_commande lc      ON lc.commande_id = c.id
WHERE lc.date_evenement IS NOT NULL
  AND lc.date_evenement >= CURDATE()
  AND c.statut NOT IN ('annulee','livree','remboursee');


-- ================================================================
-- DONNÉES DE TEST
-- ================================================================

INSERT IGNORE INTO categories (id, nom, slug, ordre) VALUES
    (UUID(), 'Femme',       'femme',       1),
    (UUID(), 'Homme',       'homme',       2),
    (UUID(), 'Enfant',      'enfant',      3),
    (UUID(), 'Accessoires', 'accessoires', 4);

INSERT IGNORE INTO categories (id, nom, slug, parent_id, ordre)
SELECT UUID(), 'Robes', 'femme-robes', id, 1 FROM categories WHERE slug = 'femme';
INSERT IGNORE INTO categories (id, nom, slug, parent_id, ordre)
SELECT UUID(), 'Pantalons', 'femme-pantalons', id, 2 FROM categories WHERE slug = 'femme';
INSERT IGNORE INTO categories (id, nom, slug, parent_id, ordre)
SELECT UUID(), 'T-shirts', 'homme-tshirts', id, 1 FROM categories WHERE slug = 'homme';
INSERT IGNORE INTO categories (id, nom, slug, parent_id, ordre)
SELECT UUID(), 'Vestes', 'homme-vestes', id, 2 FROM categories WHERE slug = 'homme';

-- ⚠️ Compte admin initial. Le hash ci-dessous est volontairement INVALIDE :
-- aucune connexion n'est possible tant que vous n'avez pas :
--   1. remplacé 'admin@example.com' par votre email (le même que dans ADMIN_EMAILS / ADMIN_EMAIL du .env) ;
--   2. défini le mot de passe avec : node scripts/set-admin-password.js
INSERT IGNORE INTO utilisateurs (id, nom, prenom, email, mot_de_passe_hash, role, email_verifie) VALUES
    (UUID(), 'Admin', 'Super', 'admin@example.com', '$2b$12$placeholder_hash_admin', 'admin', 1);

-- ================================================================
-- LOOKBOOK — données d'exemple
-- ================================================================

INSERT INTO lookbook (id, titre, tags, hauteur, visible, ordre) VALUES
    (UUID(), 'Robe kabyle pour cérémonie',  'robes,ceremonies',  300, 1, 1),
    (UUID(), 'Tenue de mariée kabyle',      'mariages,robes',    360, 1, 2),
    (UUID(), 'Bijoux traditionnels argent', 'accessoires',       260, 1, 3),
    (UUID(), 'Caftan de soirée',            'robes,soirees',     340, 1, 4),
    (UUID(), 'Burnous cérémonie',           'hommes,ceremonies', 280, 1, 5),
    (UUID(), 'Takchita brodée perles',      'robes,mariages',    320, 1, 6);

-- ================================================================
-- FIN DU SCRIPT
-- ================================================================

-- ================================================================
-- VISITES (statistiques de fréquentation — créée aussi automatiquement par l'API)
-- ================================================================

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
