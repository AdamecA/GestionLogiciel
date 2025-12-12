# Projet Hôpital – Docker Setup
## Description
Ce projet déploie une architecture distribuée pour la gestion de données hospitalières fédérées et sécurisées. L'architecture repose sur :

- Architecture Fédérée : Un serveur Fedup central interroge plusieurs hôpitaux.

- Sécurité (Proxy Forward & Reverse) :

    - Un Forward Proxy (Racine) : Intercepte les requêtes sortantes de Fuseki pour injecter le token d'authentification.

    - Des Reverse Proxy (Hôpitaux) : Protègent chaque hôpital en vérifiant la validité du token JWT via Keycloak.

- Composants :

  - 2 serveurs Apache Jena Fuseki (H1 et H2) - Bases de données RDF/SPARQL locales.

  - 1 serveur Keycloak - Gestion de l'authentification (SSO) et des autorisations.

  - 1 application web - Interface utilisateur (index.html / main.html) servie via Nginx.

## 👥 Auteurs

**ADAMEC Anthony**

**AMERKHANOVA Aida**

**BOUDJEDIR Amina**

**TAII Wiame**


## Prérequis
 Avant de commencer, assurez-vous d'avoir installé :

- Docker (version 20.10 ou supérieure)
- Docker Compose (version 2.0 ou supérieure)
- Git (pour cloner le projet)

Vérification de l'installation
```bash
docker --version
docker-compose --version
```
## Démarrage rapide
### Cloner le projet
```bash
git clone <url-du-repo>
cd GestionLogiciel
```
### Lancer tous les services
Depuis le dossier racine du projet :
```bash
chmod +x start.sh
./start.sh
```
Cette commande démarre tous les conteneurs en mode détaché (arrière-plan).
### Vérifier le statut des services
```bash
docker ps
```

## 🛑 Arrêt des services

Arrêter et supprimer tous les conteneurs et volumes
```bash
chmod +x stop.sh
./stop.sh
```

> **⚠️ Attention : Cette commande supprimera toutes les données persistantes**

## Accès aux services
Une fois les services démarrés, voici les points d'accès :

Infrastructure Centrale
- Application Web (Frontend) : http://localhost:3000

        Identifiants Test : alice / alice, bob / bob, carol / carol, etc.

- Keycloak Central (Auth Principale) : http://localhost:8080

      Admin : admin / admin
      Realm : myrealm

- Fedup : http://localhost:3330

- Forward Proxy (Intercepteur Token) : http://localhost:8888

Hôpital 1 (H1)

- Keycloak H1 (Auth Locale) : http://localhost:8081

      Admin : admin / admin
      Realm : hospital1-realm

- Proxy Sécurisé (Entrée) : http://localhost:4000

- Base de données (Fuseki H1) : http://localhost:3031

Hôpital 2 (H2)

- Keycloak H2 (Auth Locale) : http://localhost:8082

      Admin : admin / admin
      Realm : hospital2-realm

- Proxy Sécurisé (Entrée) : http://localhost:4001

- Base de données (Fuseki H2) : http://localhost:3032

## 💡 Utilisation de l'application

Étape 1 : Accéder à l'application

Ouvrez votre navigateur et accédez à : http://localhost:3000

Étape 2 : Authentification

    - Cliquez sur le bouton "Se connecter".

    - Vous serez redirigé vers Keycloak.

    - Connectez-vous avec Alice / Alice (ou un autre utilisateur configuré).

    - Le token JWT est automatiquement récupéré et envoyé au Forward Proxy.

Étape 3 : Exécuter une requête SPARQL Fédérée (sans clause service)

Une fois connecté, vous pouvez interroger les données des hôpitaux via le fédérateur.

Ètape 4 : Soumettre

    - Cliquez sur "Submit". Le flux d'authentification fédéré se déclenche :

    1. FedUP envoie la requête au Forward Proxy

    2. Le Forward Proxy injecte le token JWT du Keycloak Central

    3. La requête arrive aux Proxies des hôpitaux (H1/H2)

    4. **Échange de Token (Token Translation)** :
       - Le Proxy Hôpital vérifie d'abord le token Central
       - Extrait le username (ex: "alice")
       - Demande un token au Keycloak Local de l'hôpital
       - Utilise username=password pour simuler la fédération
       - Obtient un token local avec les politiques spécifiques de l'hôpital

    5. Le Proxy Hôpital transmet la requête à Fuseki avec le token local

    6. Les données sont retournées à l'utilisateur

## 🔐 Architecture d'Authentification Multi-Realm

### Concept : Simulation de Fédération d'Identité

Le projet utilise **3 Keycloaks avec 3 realms différents** :

1. **Keycloak Central** (`myrealm`) : Authentification initiale des utilisateurs
2. **Keycloak Hospital 1** (`hospital1-realm`) : Politiques et rôles locaux de H1
3. **Keycloak Hospital 2** (`hospital2-realm`) : Politiques et rôles locaux de H2

### Token Translation Pattern

Au lieu d'une vraie fédération OAuth (Identity Brokering), nous simulons le processus :

- **Utilisateurs répliqués** : Les mêmes utilisateurs existent dans les 3 Keycloaks
- **Convention username=password** : Simplifie l'échange de tokens (ex: alice/alice)
- **Token Exchange** : Le proxy hôpital traduit le token central en token local
- **Avantages** :
  - Chaque hôpital garde son autonomie (ses propres rôles/politiques)
  - Démontre les concepts de fédération sans la complexité technique
  - Facile à étendre vers une vraie fédération OAuth plus tard