# 🧩 Projet Hôpital – Docker Setup
## 📘 Description
Ce projet déploie une architecture distribuée pour la gestion de données hospitalières composée de :

- 2 serveurs Apache Jena Fuseki (H1 et H2) - Bases de données RDF/SPARQL
- 1 serveur Keycloak - Gestion de l'authentification et des autorisations
- 1 application web - Interface utilisateur (index.html / main.html) servie via Nginx


## 👥 Auteurs

**ADAMEC Anthony**

**AMERKHANOVA Aida**

**BOUDJEDIR Amina**

**TAII Wiame**


## 📋 Prérequis
 Avant de commencer, assurez-vous d'avoir installé :

- Docker (version 20.10 ou supérieure)
- Docker Compose (version 2.0 ou supérieure)
- Git (pour cloner le projet)

Vérification de l'installation
```bash
docker --version
docker-compose --version
```
## 🚀 Démarrage rapide
### 1️⃣ Cloner le projet
```bash
git clone <url-du-repo>
cd GestionLogiciel
```
### 2️⃣ Lancer tous les services
Depuis le dossier racine du projet :
```bash
chmod +x start.sh
./start.sh
```
Cette commande démarre tous les conteneurs en mode détaché (arrière-plan).
### 3️⃣ Vérifier le statut des services
```bash
docker ps
```
### charger les données RDF dans Fuseki H1
```bash
chmod +x HOPITAL/H1/loader.sh
```

## 🛑 Arrêt des services

Arrêter et supprimer tous les conteneurs et volumes
```bash
chmod +x stop.sh
./stop.sh
```

> **⚠️ Attention : Cette commande supprimera toutes les données pers**

## 🌐 Accès aux services
Une fois les services démarrés, vous pouvez y accéder via :

**Proxy H1 :**
- URL : http://localhost:4000

**Service : Fuseki H1**
- URL : http://localhost:3030
- Identifiants : admin / admin

**Service : Fuseki H2**
- URL : http://localhost:3031
- Identifiants : admin / admin

**Service : Keycloak**
- URL : http://localhost:8080
- Identifiants : admin / admin

**Service : Application Web**
- URL : http://localhost:3000
- Identifiants : Alice / Alice

## 💡 Utilisation de l'application
### Étape 1 : Accéder à l'application
Ouvrez votre navigateur et accédez à : http://localhost:3000
### Étape 2 : Se connecter

Cliquez sur le bouton "Se connecter"
Vous serez automatiquement redirigé vers la page d'authentification Keycloak

### Étape 3 : S'authentifier avec Keycloak
Sur la page de connexion Keycloak, utilisez les identifiants de test :

Nom d'utilisateur : Alice
Mot de passe : Alice

### Étape 4 : Exécuter une requête SPARQL
Une fois connecté, vous avez deux options :
### Option A : Utiliser un exemple prédéfini

Cliquez sur l'un des boutons d'exemple disponibles
La requête SPARQL sera automatiquement remplie dans le champ de texte

### Option B : Saisir votre propre requête

Tapez ou collez votre requête SPARQL dans le champ prévu à cet effet

### Étape 5 : Soumettre la requête

Cliquez sur le bouton "Submit" pour envoyer la requête
Les résultats s'afficheront dans l'interface