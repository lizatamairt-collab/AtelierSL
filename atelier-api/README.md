# Boutique Vêtements — API (`auth-api`)

## Paiement en ligne — Chargily Pay™ (CIB / EDAHABIA)

Le paiement par carte (CIB via SATIM, EDAHABIA via Algérie Poste) est géré via
Chargily Pay (https://pay.chargily.com/), en plus des modes déjà existants
(à la livraison, virement CCP).

### Fichiers ajoutés

- `src/services/chargily.service.js` — appels à l'API Chargily (création de
  checkout, récupération d'un checkout, vérification de signature webhook).
- `src/controllers/paiementChargily.controller.js` — logique métier :
  création du checkout, vérification manuelle, traitement du webhook.
- `src/routes/paiementChargily.routes.js` — routes exposées :
  - `POST /api/commandes/:id/paiement-chargily` (authentifié, propriétaire)
  - `GET  /api/commandes/:id/paiement-chargily/verifier` (authentifié)
  - `POST /api/paiements/chargily/webhook` (public, vérifié par signature)

### Configuration (`.env`)

```
CHARGILY_MODE=test                 # ou "live" une fois le compte marchand validé
CHARGILY_API_KEY=votre-cle-api     # clé secrète, espace marchand Chargily
CHARGILY_WEBHOOK_URL=https://api.votre-domaine.dz/api/paiements/chargily/webhook
```

`FRONTEND_URL` (déjà utilisé par le reste du projet) sert de base aux URLs de
redirection succès/échec après paiement.

### Flux

1. Le client crée sa commande normalement : `POST /api/commandes` avec
   `methode_paiement: "edahabia"` ou `"cib"`.
2. Le front appelle `POST /api/commandes/:id/paiement-chargily` avec
   `{ "methode": "edahabia" }` (ou `"cib"`). La réponse contient
   `checkout_url` : redirigez le navigateur du client vers cette URL.
3. Le client paie sur la page hébergée par Chargily.
4. Chargily notifie `POST /api/paiements/chargily/webhook` : le paiement passe
   à `reussi` et la commande à `confirmee` automatiquement (email de
   confirmation envoyé comme pour les autres modes de paiement).
5. Chargily redirige ensuite le client vers `success_url`/`failure_url`
   (`{FRONTEND_URL}/checkout/succes?commande=...` ou `/checkout/echec?...`) —
   à câbler côté front pour afficher la bonne page.

### Développement local

Chargily ne peut pas atteindre un webhook sur `localhost`. Deux options :

- Utiliser un tunnel public (ex. `ngrok http 3000`) et renseigner l'URL
  générée dans `CHARGILY_WEBHOOK_URL` + dans le tableau de bord Chargily.
- Ou s'appuyer sur `GET /api/commandes/:id/paiement-chargily/verifier`, qui
  interroge directement l'API Chargily et met à jour la commande — pratique
  pour tester sans webhook (par exemple juste après le retour sur
  `success_url` côté front).

### Sécurité

- Chaque requête webhook est vérifiée via une signature HMAC-SHA256 calculée
  sur le corps brut de la requête avec la clé API secrète (voir
  `verifierSignature` dans `chargily.service.js`) — toute requête sans
  signature valide est rejetée (403).
- Le webhook est exclu du rate-limit global (`src/index.js`), car les
  requêtes proviennent des serveurs Chargily et non d'un client individuel.
- Le montant reçu de Chargily est comparé au montant attendu de la commande ;
  un écart est loggé (à surveiller en prod).

### Limite connue

Le mapping exact des noms de champs et des valeurs de statut (`pending`,
`paid`, `failed`, `expired`, `canceled`, header `signature`, etc.) suit la
documentation Chargily Pay API v2 au moment de l'écriture de ce code
(https://dev.chargily.com/pay-v2/introduction). Si Chargily fait évoluer son
API, vérifiez `chargily.service.js` et `paiementChargily.controller.js`
contre la documentation à jour avant mise en production.

## Notification WhatsApp admin — Nouvelle commande

Le trigger SQL `trg_notif_nouvelle_commande` crée bien une notification
interne (table `notifications`), mais n'envoie jamais rien réellement à
l'admin en dehors de la base — il n'y avait aucun envoi WhatsApp effectif.
C'est maintenant comblé : à chaque commande créée (`POST /api/commandes`),
un message WhatsApp est envoyé à l'admin en plus de l'email de confirmation
au client, via l'API WhatsApp Cloud de Meta.

### Fichiers ajoutés

- `src/services/whatsapp.service.js` — appel à l'API WhatsApp Cloud (envoi
  d'un message template). Ne touche pas à la base de données, comme
  `chargily.service.js`.
- `src/controllers/commandes.controller.js` — `creer()` déclenche l'envoi en
  arrière-plan (`setImmediate`), indépendamment de l'email client : un échec
  WhatsApp ne bloque ni la commande, ni l'email.

### Configuration (`.env`)

```
WHATSAPP_ENABLED=true                        # 'false' ou absent = aucun envoi réel (no-op loggé)
WHATSAPP_API_TOKEN=votre-token                 # token d'accès permanent (System User Meta)
WHATSAPP_PHONE_ID=123456789012345            # Phone Number ID (Meta Business)
WHATSAPP_ADMIN_NUMBERS=213XXXXXXXXX,213YYYYYYYYY   # numéros admin, E.164 sans "+", séparés par virgules
WHATSAPP_API_VERSION=v20.0                   # optionnel, défaut v20.0
WHATSAPP_TEMPLATE_NOUVELLE_COMMANDE=nouvelle_commande_admin  # optionnel, nom du template
```

### Pré-requis côté Meta Business Manager

L'API WhatsApp Cloud n'autorise pas l'envoi de texte libre à froid (en
dehors des 24h suivant un message reçu du destinataire) : il faut un
**message template pré-approuvé**. Créez-en un nommé
`nouvelle_commande_admin` (ou adaptez `WHATSAPP_TEMPLATE_NOUVELLE_COMMANDE`)
avec un corps à 4 variables, par exemple :

```
Nouvelle commande {{1}} — {{2}} DZD. Client : {{3}}. Voir : {{4}}
```

Sans template approuvé, l'envoi échouera (erreur loggée côté serveur, sans
jamais faire échouer la création de la commande elle-même).

### Limite connue

Un seul type de message (nouvelle commande) est câblé pour l'instant. Pour
notifier aussi sur d'autres événements (paiement reçu, changement de statut),
ajoutez un appel similaire à `envoyerNotificationNouvelleCommande` (ou une
nouvelle fonction du même service) aux endroits pertinents de
`commandes.controller.js` / `paiementChargily.controller.js`, avec un
template Meta dédié pour chacun.
