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

        Identifiants Test : Alice / Alice ou Bob / Bob

- Keycloak (Auth) : http://localhost:8080

      Admin : admin / admin

- Fedup : http://localhost:3330

- Forward Proxy (Intercepteur Token) : http://localhost:8888

Hôpital 1 (H1)

- Proxy Sécurisé (Entrée) : http://localhost:4000

- Base de données (Fuseki H1) : http://localhost:3031

Hôpital 2 (H2)

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

    - Cliquez sur "Submit". Le Fuseki central va :

    - Envoyer la requête au Forward Proxy.

    - Le Proxy ajoute le token.

    - La requête arrive aux Proxies des hôpitaux (H1/H2).

    - Les Proxies Hôpitaux valident le token et renvoient les données.