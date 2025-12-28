# Systeme de Gestion de Donnees Hospitalieres Federees

## Description

Ce projet deploie une architecture distribuee pour la gestion de donnees hospitalieres federees et securisees. Il implemente un **controle d'acces fin (RBAC)** utilisant les services d'autorisation Keycloak et l'echange de tokens **RFC 8693** pour la gestion d'identite federee.

### Fonctionnalites Principales

- **Requetes SPARQL Federees** : Un serveur FedUP central interroge plusieurs endpoints hospitaliers
- **Controle d'Acces Base sur les Roles (RBAC)** : Les utilisateurs ne peuvent acceder qu'aux donnees des etudes auxquelles ils sont autorises
- **Echange de Tokens (RFC 8693)** : Authentification centrale avec autorisation locale dans chaque hopital
- **Reecriture de Requetes** : Les requetes SPARQL sont automatiquement filtrees selon les permissions de l'utilisateur

## Vue d'Ensemble de l'Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          NAVIGATEUR UTILISATEUR                          │
│                         http://localhost:3000                            │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          KEYCLOAK CENTRAL                                │
│                        http://localhost:8080                             │
│                                                                          │
│   Realm: myrealm                                                         │
│   Utilisateurs: alice, bob, carol, dave                                  │
│   Roles: study_A_researcher, study_B_researcher, admin                   │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           FORWARD PROXY                                  │
│                        http://localhost:8888                             │
│                                                                          │
│   - Intercepte les requetes sortantes de FedUP                           │
│   - Injecte le token JWT de l'utilisateur dans les requetes              │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    ▼                               ▼
┌─────────────────────────────────┐   ┌─────────────────────────────────┐
│         HOPITAL 1                │   │         HOPITAL 2               │
│    http://localhost:4000         │   │    http://localhost:4001         │
│                                  │   │                                  │
│  ┌────────────────────────────┐  │   │  ┌────────────────────────────┐  │
│  │     PROXY HOPITAL          │  │   │  │     PROXY HOPITAL          │  │
│  │                            │  │   │  │                            │  │
│  │  1. Verifie token Central  │  │   │  │  1. Verifie token Central  │  │
│  │  2. Echange de Token(8693) │  │   │  │  2. Echange de Token(8693) │  │
│  │  3. Verifie permissions    │  │   │  │  3. Verifie permissions    │  │
│  │  4. Reecrit requete SPARQL │  │   │  │  4. Reecrit requete SPARQL │  │
│  │  5. Transmet a Fuseki      │  │   │  │  5. Transmet a Fuseki      │  │
│  └────────────────────────────┘  │   │  └────────────────────────────┘  │
│              │                   │   │              │                   │
│              ▼                   │   │              ▼                   │
│  ┌────────────────────────────┐  │   │  ┌────────────────────────────┐  │
│  │  KEYCLOAK LOCAL (H1)       │  │   │  │  KEYCLOAK LOCAL (H2)       │  │
│  │  http://localhost:8081     │  │   │  │  http://localhost:8082     │  │
│  │                            │  │   │  │                            │  │
│  │  - Identity Provider       │  │   │  │  - Identity Provider       │  │
│  │  - Mappeurs de Roles       │  │   │  │  - Mappeurs de Roles       │  │
│  │  - Politiques Autorisation │  │   │  │  - Politiques Autorisation │  │
│  └────────────────────────────┘  │   │  └────────────────────────────┘  │
│              │                   │   │              │                   │
│              ▼                   │   │              ▼                   │
│  ┌────────────────────────────┐  │   │  ┌────────────────────────────┐  │
│  │  FUSEKI (H1)               │  │   │  │  FUSEKI (H2)               │  │
│  │  http://localhost:3031     │  │   │  │  http://localhost:3032     │  │
│  │                            │  │   │  │                            │  │
│  │  Patients: 1, 2            │  │   │  │  Patients: 5               │  │
│  │  Etudes: A, B              │  │   │  │  Etudes: A, B              │  │
│  └────────────────────────────┘  │   │  └────────────────────────────┘  │
└─────────────────────────────────┘   └─────────────────────────────────┘
```

## Auteurs

- **ADAMEC Anthony**
- **AMERKHANOVA Aida**
- **BOUDJEDIR Amina**
- **TAII Wiame**

## Prerequis

Avant de commencer, assurez-vous d'avoir installe :

- Docker (version 20.10 ou superieure)
- Docker Compose (version 2.0 ou superieure)
- Git
- jq (pour executer les scripts de test)

```bash
docker --version
docker-compose --version
```

## Demarrage Rapide

### 1. Cloner le projet

```bash
git clone <url-du-repo>
cd GestionLogiciel
```

### 2. Demarrer tous les services

```bash
chmod +x start.sh stop.sh restart.sh
./start.sh
```

Cette commande :
1. Demarre tous les conteneurs Docker (Services centraux + Hopital 1 + Hopital 2)
2. Attend que les Keycloaks soient prets
3. Configure les Services d'Autorisation (cree les permissions via API)

### 3. Verifier que les services fonctionnent

```bash
docker ps
```

Vous devriez voir ces conteneurs :
- `nginx-web` - Frontend web
- `keycloak-central` - Authentification centrale
- `keycloak-h1`, `keycloak-h2` - Keycloaks hospitaliers
- `proxy1`, `proxy2` - Proxys hospitaliers
- `fuseki-H1`, `fuseki-H2` - Bases de donnees hospitaliers
- `fuseki-fed` - Fuseki federe
- `fedup-server` - Serveur de federation
- `forward-proxy` - Proxy d'injection de tokens

## Points d'Acces aux Services

### Infrastructure Centrale

| Service | URL | Identifiants |
|---------|-----|--------------|
| Application Web | http://localhost:3000 | Voir utilisateurs ci-dessous |
| Keycloak Central | http://localhost:8080 | admin / admin |
| Serveur FedUP | http://localhost:3330 | - |
| Forward Proxy | http://localhost:8888 | - |
| Fuseki Federe | http://localhost:3030 | admin / admin |

### Hopital 1

| Service | URL | Identifiants |
|---------|-----|--------------|
| Proxy Hopital | http://localhost:4000 | JWT requis |
| Keycloak H1 | http://localhost:8081 | admin / admin |
| Fuseki H1 | http://localhost:3031 | admin / admin |

### Hopital 2

| Service | URL | Identifiants |
|---------|-----|--------------|
| Proxy Hopital | http://localhost:4001 | JWT requis |
| Keycloak H2 | http://localhost:8082 | admin / admin |
| Fuseki H2 | http://localhost:3032 | admin / admin |

## Utilisateurs de Test et Permissions

| Utilisateur | Mot de passe | Roles | Acces aux Etudes |
|-------------|--------------|-------|------------------|
| alice | alice | study_A_researcher | Etude A uniquement |
| bob | bob | study_B_researcher | Etude B uniquement |
| carol | carol | study_A_researcher, study_B_researcher | Les deux etudes |
| dave | dave | admin | Toutes les donnees |

## Fonctionnement

### Flux d'Authentification

1. **Connexion Utilisateur** : L'utilisateur s'authentifie via Keycloak Central (http://localhost:8080)
2. **Stockage du Token** : Le token JWT est envoye au Forward Proxy pour stockage
3. **Execution de Requete** : L'utilisateur soumet une requete SPARQL via l'interface web
4. **Injection du Token** : Le Forward Proxy injecte le JWT dans les requetes sortantes
5. **Echange de Token** : Le Proxy Hopital echange le token Central contre un token local (RFC 8693)
6. **Verification des Autorisations** : Le Keycloak local evalue les permissions via UMA-ticket
7. **Reecriture de Requete** : La requete SPARQL est filtree selon les etudes autorisees de l'utilisateur
8. **Retour des Donnees** : Seules les donnees autorisees sont retournees a l'utilisateur

### Echange de Tokens (RFC 8693)

Le systeme utilise un veritable echange de tokens OAuth 2.0 :

```
Token Central → Keycloak Hopital → Token Local
     │                  │                │
     │                  │                └── Contient les roles locaux mappes
     │                  └── L'Identity Provider valide le token Central
     └── Contient les roles du realm Central (study_A_researcher, etc.)
```

**Elements de configuration cles :**
- Les Keycloaks hospitaliers ont le Keycloak Central configure comme Identity Provider
- Les mappeurs Identity Provider extraient les roles du claim `realm_access.roles`
- `KC_FEATURES=admin-fine-grained-authz:v1,token-exchange` doit etre active

### Note sur la Federation

Ce systeme **simule une federation d'identite** plutot qu'une vraie federation OAuth.

Dans une vraie federation, un seul token serait reconnu par tous les systemes. Cependant, Keycloak Authorization Services (UMA) exige que le token soit emis par le meme realm que celui qui definit les politiques d'autorisation.

**Pourquoi 2 tokens ?**
1. **Issuer different** : Le token Central est emis par `myrealm`. Les Keycloaks hospitaliers ne peuvent evaluer leurs politiques qu'avec des tokens de leur propre realm.
2. **Authorization Services (UMA)** : L'API UMA-ticket exige un token emis par le realm qui heberge les politiques.
3. **Autonomie des hopitaux** : Chaque hopital conserve le controle total sur ses propres regles d'acces.

L'echange de tokens (RFC 8693) permet de :
- Conserver l'authentification centralisee (SSO)
- Permettre a chaque hopital de definir ses propres politiques d'acces
- Mapper automatiquement les roles centraux vers les roles locaux

C'est un compromis architectural qui preserve l'autonomie de chaque hopital tout en offrant une experience utilisateur unifiee.

### Reecriture de Requetes

Toutes les requetes SPARQL sont automatiquement filtrees selon les permissions utilisateur :

**Requete Originale (d'alice) :**
```sparql
SELECT ?s ?p ?o WHERE { ?s ?p ?o } LIMIT 10
```

**Requete Reecrite :**
```sparql
PREFIX res: <http://example.org/resource/>
PREFIX ex: <http://example.org/schema#>
SELECT ?s ?p ?o WHERE {
  ?s <http://example.org/schema#partOf> <http://example.org/resource/study_A> .
  ?s ?p ?o
} LIMIT 10
```

Alice ne voit que les donnees des patients de l'Etude A.

## Exemples de Requetes SPARQL

### Lister tous les patients (filtre selon votre acces)
```sparql
SELECT ?patient ?age ?aneurysm WHERE {
  ?patient a ex:Patient .
  ?patient ex:hasAge ?age .
  ?patient ex:hasAneurysm ?aneurysm .
}
```

### Obtenir les patients d'une etude specifique
```sparql
PREFIX ex: <http://example.org/schema#>
PREFIX res: <http://example.org/resource/>

SELECT ?patient ?age WHERE {
  ?patient a ex:Patient .
  ?patient ex:partOf res:study_A .
  ?patient ex:hasAge ?age .
}
```

### Pattern de triplets generique (auto-filtre)
```sparql
SELECT * WHERE { ?s ?p ?o } LIMIT 20
```

## Arret des Services

```bash
./stop.sh
```

## Redemarrage des Services

```bash
./restart.sh
```

## Depannage

### Consulter les logs du proxy
```bash
docker logs proxy1 -f
docker logs proxy2 -f
```

### Consulter les logs Keycloak
```bash
docker logs keycloak-central -f
docker logs keycloak-h1 -f
```

### Tester l'echange de token manuellement
```bash
# Obtenir le token Central
TOKEN=$(curl -s -X POST "http://localhost:8080/realms/myrealm/protocol/openid-connect/token" \
  -d "username=alice" -d "password=alice" \
  -d "grant_type=password" -d "client_id=webapp" \
  -d "scope=openid" | jq -r '.access_token')

# Interroger l'Hopital 1
curl -X POST "http://localhost:4000/sparql" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/sparql-query" \
  -d "SELECT * WHERE { ?s ?p ?o } LIMIT 5"
```

### Problemes Courants

1. **Echec de l'echange de token** : Verifiez que `KC_FEATURES` inclut `token-exchange` dans les fichiers docker-compose des hopitaux
2. **Aucune donnee retournee** : Verifiez que l'utilisateur a les bons roles dans le Keycloak Central
3. **Permission refusee** : Verifiez la configuration des Services d'Autorisation dans les Keycloaks hospitaliers

## Structure du Projet

```
GestionLogiciel/
├── start.sh                    # Demarrer tous les services
├── stop.sh                     # Arreter tous les services
├── restart.sh                  # Redemarrer tous les services
├── docker-compose.yml          # Services centraux
├── Proxy/
│   └── proxy.js                # Proxy unifie (modes Forward + Hopital)
├── web/
│   ├── index.html              # Page de connexion
│   ├── main.html               # Application principale
│   └── nginx.conf              # Configuration Nginx
├── HOPITAL/
│   ├── H1/
│   │   ├── docker-compose.yml  # Services Hopital 1
│   │   ├── data/h1.ttl         # Donnees RDF Hopital 1
│   │   └── loader.sh           # Chargeur de donnees
│   └── H2/
│       ├── docker-compose.yml  # Services Hopital 2
│       ├── data/h2.ttl         # Donnees RDF Hopital 2
│       └── loader.sh           # Chargeur de donnees
├── Data/config/
│   ├── mainKeycloak/           # Export realm Keycloak Central
│   ├── hospital1Keycloak/      # Export realm Keycloak H1
│   └── hospital2Keycloak/      # Export realm Keycloak H2
└── scripts/
    ├── configure-keycloak-authz.sh   # Cree les permissions de scope
    └── setup-token-exchange.sh       # Documentation echange de tokens
```

## Ajouter une Nouvelle Etude

Pour ajouter une nouvelle etude (ex: Etude C) :

1. **Keycloak Central** (`Data/config/mainKeycloak/realm-export.json`) :
   - Ajouter le role `study_C_researcher`
   - Assigner le role aux utilisateurs

2. **Keycloaks Hospitaliers** (`Data/config/hospital*Keycloak/realm-export.json`) :
   - Ajouter le role `study_C_researcher`
   - Ajouter un mappeur Identity Provider pour le role
   - Ajouter la ressource `study_C` dans les Authorization Settings
   - Ajouter la politique `Study C Researcher Policy`

3. **Proxy** (`Proxy/proxy.js`) :
   - Ajouter la verification de permission pour `study_C`

4. **Donnees** (`HOPITAL/H*/data/*.ttl`) :
   - Ajouter des patients avec `ex:partOf res:study_C`

## Licence

Ce projet a ete developpe dans le cadre d'un projet academique de fin d'etudes.
