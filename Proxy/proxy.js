// proxy.js (Code Source Unifié)

import http from 'http';
import express from 'express';
import { URL } from 'url';
import fetch from 'node-fetch';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';

// ─────────────────────────────────────────────────────────────
// CONFIGURATION GLOBALE PAR ENV (Pour les deux modes)
// ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 8888;
const PROXY_MODE = process.env.PROXY_MODE || 'HOSPITAL'; // 'FORWARD' ou 'HOSPITAL'

// ─────────────────────────────────────────────────────────────
// CONFIGURATION POUR LE MODE HOSPITAL
// ─────────────────────────────────────────────────────────────
const FUSEKI_URL = process.env.FUSEKI_URL; // URL complète de Fuseki local
const PUBLIC_ISSUER = process.env.PUBLIC_ISSUER;
const JWKS_URI = process.env.JWKS_URI;

// Configuration pour le Keycloak local (token exchange)
const LOCAL_KEYCLOAK_URL = process.env.LOCAL_KEYCLOAK_URL;
const LOCAL_REALM = process.env.LOCAL_REALM;
const LOCAL_CLIENT_ID = process.env.LOCAL_CLIENT_ID;
const LOCAL_CLIENT_SECRET = process.env.LOCAL_CLIENT_SECRET;

// ─────────────────────────────────────────────────────────────
// CONFIGURATION POUR LE MODE FORWARD
// ─────────────────────────────────────────────────────────────
// Stockage du token en mémoire (seulement pour le mode FORWARD)
let currentToken = null;

// ─────────────────────────────────────────────────────────────
// FONCTIONS COMMUNES
// ─────────────────────────────────────────────────────────────

// Initialisation du client JWKS (seulement si en mode HOSPITAL)
let jwksClientInstance = null;
if (PROXY_MODE === 'HOSPITAL') {
    if (!JWKS_URI || !PUBLIC_ISSUER || !FUSEKI_URL) {
        console.error("❌ [HOSPITAL MODE] Variables d'environnement manquantes (JWKS_URI, PUBLIC_ISSUER, FUSEKI_URL).");
        process.exit(1);
    }
    jwksClientInstance = jwksClient({ jwksUri: JWKS_URI });
}

function getKey(header, callback) {
    if (!jwksClientInstance) return callback(new Error("JWKS Client non initialisé."));
    jwksClientInstance.getSigningKey(header.kid, (err, key) => {
        if (err) return callback(err);
        callback(null, key.publicKey || key.rsaPublicKey);
    });
}

function verifyToken(token) {
    return new Promise((resolve, reject) => {
        jwt.verify(token, getKey, { issuer: PUBLIC_ISSUER, algorithms: ["RS256"] }, (err, decoded) => {
            if (err) return reject(err);
            resolve(decoded);
        });
    });
}

// ─────────────────────────────────────────────────────────────
// TOKEN EXCHANGE (RFC 8693)
// Échange le token Central contre un token local Hospital
// Le Keycloak local utilise Central Keycloak comme Identity Provider
// et mappe automatiquement les rôles via les Identity Provider Mappers
// ─────────────────────────────────────────────────────────────

async function exchangeToken(centralToken) {
    try {
        const tokenUrl = `${LOCAL_KEYCLOAK_URL}/realms/${LOCAL_REALM}/protocol/openid-connect/token`;

        const params = new URLSearchParams();
        // RFC 8693 Token Exchange with Identity Provider
        params.append('grant_type', 'urn:ietf:params:oauth:grant-type:token-exchange');
        params.append('subject_token', centralToken);
        params.append('subject_token_type', 'urn:ietf:params:oauth:token-type:access_token');
        params.append('requested_token_type', 'urn:ietf:params:oauth:token-type:access_token');
        params.append('client_id', LOCAL_CLIENT_ID);
        params.append('client_secret', LOCAL_CLIENT_SECRET);
        // subject_issuer indique quel Identity Provider a émis le token original
        // Cela doit correspondre à l'alias de l'Identity Provider configuré
        params.append('subject_issuer', 'central-keycloak');

        console.log(`🔄 [TokenExchange] Exchanging Central token for local Hospital token...`);
        console.log(`🔄 [TokenExchange] Using subject_issuer: central-keycloak`);

        const response = await fetch(tokenUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: params.toString()
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`❌ [TokenExchange] Failed: ${response.status} - ${errorText}`);
            throw new Error(`Token exchange failed: ${response.status} - ${errorText}`);
        }

        const tokenData = await response.json();
        console.log(`✅ [TokenExchange] Successfully obtained local Hospital token`);

        // Décoder le token local pour voir les rôles mappés
        const localDecoded = jwt.decode(tokenData.access_token);
        const localRoles = localDecoded?.realm_access?.roles || [];
        console.log(`📋 [TokenExchange] Local token roles (mapped from Central): ${localRoles.join(', ')}`);

        return tokenData.access_token;

    } catch (err) {
        console.error(`❌ [TokenExchange] Error: ${err.message}`);
        throw err;
    }
}

// ─────────────────────────────────────────────────────────────
// VÉRIFICATION DES PERMISSIONS VIA KEYCLOAK AUTHORIZATION API
// Utilise le token local (échangé) pour évaluer les politiques locales
// ─────────────────────────────────────────────────────────────

async function checkPermission(localToken, resourceName, scope) {
    try {
        console.log(`🔐 [Authorization] Checking permission for resource: ${resourceName}, scope: ${scope}`);

        // Utiliser l'API d'autorisation Keycloak avec le token local
        const authzUrl = `${LOCAL_KEYCLOAK_URL}/realms/${LOCAL_REALM}/protocol/openid-connect/token`;

        const params = new URLSearchParams();
        params.append('grant_type', 'urn:ietf:params:oauth:grant-type:uma-ticket');
        params.append('audience', LOCAL_CLIENT_ID);
        params.append('permission', `${resourceName}#${scope}`);
        params.append('response_mode', 'decision');

        const response = await fetch(authzUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': `Bearer ${localToken}`
            },
            body: params.toString()
        });

        if (response.status === 200) {
            const result = await response.json();
            if (result.result === true) {
                console.log(`✅ [Authorization] Permission GRANTED for ${resourceName}#${scope}`);
                return { granted: true };
            }
        }

        // Si la réponse n'est pas 200 ou result != true, accès refusé
        const errorText = await response.text();
        console.log(`❌ [Authorization] Permission DENIED for ${resourceName}#${scope}`);
        console.log(`   Response: ${response.status} - ${errorText}`);
        return { granted: false, reason: 'Access denied by policy' };

    } catch (err) {
        console.error(`❌ [Authorization] Exception: ${err.message}`);
        return { granted: false, reason: err.message };
    }
}

// ─────────────────────────────────────────────────────────────
// LOGIQUE SPÉCIFIQUE AU FORWARD PROXY
// ─────────────────────────────────────────────────────────────
function startForwardProxy() {
    console.log("🚀 Démarrage en mode **FORWARD PROXY**");

    const server = http.createServer((clientReq, clientRes) => {
        const reqUrl = clientReq.url;

        // 1. GESTION DU STOCKAGE DU TOKEN (Web JS vers Proxy)
        if (reqUrl.includes('/store-token')) {
            clientRes.setHeader('Access-Control-Allow-Origin', '*');
            clientRes.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
            clientRes.setHeader('Access-Control-Allow-Headers', 'X-Token, Content-Type');

            if (clientReq.method === 'OPTIONS') {
                clientRes.writeHead(200);
                return clientRes.end();
            }

            if (clientReq.method === 'POST') {
                const token = clientReq.headers['x-token'];
                if (token) {
                    currentToken = token;
                    console.log('📥 [ForwardProxy] Token reçu et mis à jour.');
                    clientRes.writeHead(200, { 'Content-Type': 'application/json' });
                    return clientRes.end(JSON.stringify({ status: 'stored' }));
                } else {
                    clientRes.writeHead(400);
                    return clientRes.end(JSON.stringify({ error: 'No Token provided' }));
                }
            }
        }

        // 2. LOGIQUE D'INTERCEPTION ET D'INJECTION (Fuseki vers Hôpital)
        console.log(`📡 [ForwardProxy] Interception requête vers : ${reqUrl}`);
        let cleanedUrl = reqUrl.startsWith('/') ? reqUrl.substring(1) : reqUrl;

        try {
            const targetUrl = new URL(cleanedUrl);
            const options = {
                hostname: targetUrl.hostname,
                port: targetUrl.port || 80,
                path: targetUrl.pathname + targetUrl.search,
                method: clientReq.method,
                headers: { ...clientReq.headers }
            };

            // INJECTION DU TOKEN
            if (currentToken) {
                options.headers['Authorization'] = `Bearer ${currentToken}`;
                console.log('🔑 [ForwardProxy] Token injecté.');
            } else {
                console.warn('⚠️ [ForwardProxy] Aucun token en mémoire ! Envoi sans authentification.');
            }

            delete options.headers['host']; // Nettoyage

            const proxyReq = http.request(options, (proxyRes) => {
                clientRes.writeHead(proxyRes.statusCode, proxyRes.headers);
                proxyRes.pipe(clientRes, { end: true });
            });

            proxyReq.on('error', (e) => {
                console.error(`❌ [ForwardProxy] Erreur connexion cible : ${e.message}`);
                clientRes.writeHead(502);
                clientRes.end('Bad Gateway via Forward Proxy');
            });

            clientReq.pipe(proxyReq, { end: true });

        } catch (err) {
            console.error('❌ [ForwardProxy] URL invalide:', reqUrl, err.message);
            clientRes.writeHead(400);
            clientRes.end('Invalid URL');
        }
    });

    server.listen(PORT, () => {
        console.log(`👂 Node.js Forward Proxy écoute sur le port ${PORT}`);
    });
}

// ─────────────────────────────────────────────────────────────
// LOGIQUE SPÉCIFIQUE AU HOSPITAL PROXY (Reverse)
// ─────────────────────────────────────────────────────────────
function startHospitalProxy() {
    console.log("🏥 Démarrage en mode **HOSPITAL PROXY**");
    const app = express();

    app.use(express.text({ type: "*/*" }));
    app.use(express.urlencoded({ extended: true }));
    app.use(cors());

    // LOGGER DE DEBUG
    app.use((req, res, next) => {
        console.log(`[HOSPITAL] Requête entrante : ${req.method} ${req.url}`);
        next();
    });

    // ROUTE PRINCIPALE
    app.all("/sparql", async (req, res) => {
        if (req.method !== 'POST' && req.method !== 'GET') {
            return res.status(405).send("Method Not Allowed");
        }

        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            console.error("[HOSPITAL] Pas de token !");
            return res.status(401).json({ error: "Missing Authorization: Bearer <token>" });
        }

        const centralToken = authHeader.split(" ")[1];

        try {
            // ÉTAPE 1: VÉRIFICATION DU TOKEN CENTRAL
            const decoded = await verifyToken(centralToken);
            console.log(`✅ [HOSPITAL] Central token verified | User: ${decoded.preferred_username}`);

            // Afficher les rôles du token Central (pour debug)
            const centralUserRoles = decoded.realm_access?.roles || [];
            console.log(`📋 [HOSPITAL] User roles from Central token: ${centralUserRoles.join(', ')}`);

            // ÉTAPE 2: TOKEN EXCHANGE - Échanger le token Central contre un token local
            // Le Keycloak local fait confiance au Central via Identity Provider
            // Les rôles sont automatiquement mappés via les Identity Provider Mappers
            console.log(`🔄 [HOSPITAL] Performing token exchange with local Keycloak...`);
            const localToken = await exchangeToken(centralToken);

            // RÉCUPÉRATION DE LA REQUÊTE SPARQL
            let sparqlQuery = req.body;
            if ((!sparqlQuery || (typeof sparqlQuery === 'object' && Object.keys(sparqlQuery).length === 0)) && req.query.query) {
                sparqlQuery = req.query.query;
            }

            if (!sparqlQuery || (typeof sparqlQuery === 'object' && Object.keys(sparqlQuery).length === 0)) {
                return res.status(400).json({ error: "Requete SPARQL manquante" });
            }

            // ÉTAPE 3: DÉTERMINER LES ÉTUDES ACCESSIBLES VIA KEYCLOAK AUTHORIZATION
            // Le Keycloak local évalue ses politiques avec le token local (qui a les rôles mappés)
            console.log(`🔐 [HOSPITAL] Checking study permissions via local Keycloak for ${decoded.preferred_username}`);

            // Vérifier les permissions pour chaque étude via Keycloak local
            const allowedStudies = [];

            // Vérifier study_A (utilise le token local avec les rôles mappés)
            const studyAPermission = await checkPermission(localToken, 'study_A', 'read');
            if (studyAPermission.granted) {
                allowedStudies.push('res:study_A');
                console.log(`✅ [HOSPITAL] User has access to study_A (granted by local Keycloak policy)`);
            }

            // Vérifier study_B (utilise le token local avec les rôles mappés)
            const studyBPermission = await checkPermission(localToken, 'study_B', 'read');
            if (studyBPermission.granted) {
                allowedStudies.push('res:study_B');
                console.log(`✅ [HOSPITAL] User has access to study_B (granted by local Keycloak policy)`);
            }

            console.log(`🔍 [HOSPITAL] User ${decoded.preferred_username} allowed studies: ${allowedStudies.join(', ') || 'none'}`);

            if (allowedStudies.length === 0) {
                console.error(`🚫 [HOSPITAL] User ${decoded.preferred_username} has no study access (denied by Keycloak policies)`);
                return res.status(403).json({
                    error: "Access Denied",
                    message: "You do not have permission to access any study data",
                    reason: "No study permissions granted by authorization policies"
                });
            }

            // ÉTAPE 4: FILTRAGE DES REQUÊTES SELON LE TYPE
            let rewrittenQuery = sparqlQuery;

            console.log(`\n${'='.repeat(60)}`);
            console.log(`📨 [QUERY] Requête SPARQL reçue:`);
            console.log(`${sparqlQuery}`);
            console.log(`${'='.repeat(60)}\n`);

            // CAS 1: Détection si FedUP interroge un patient spécifique
            // Pattern: <http://example.org/resource/patient1> ou <http://example.org/resource/patient2>
            const patientUriMatch = sparqlQuery.match(/<http:\/\/example\.org\/resource\/(patient\d+)>/i);

            console.log(`🔎 [DETECTION] Patient URI spécifique trouvé: ${patientUriMatch ? patientUriMatch[1] : 'NON'}`);

            if (patientUriMatch) {
                console.log(`➡️  [CAS 1] FedUP - Vérification accès patient spécifique`);
                // FedUP demande un patient spécifique - vérifier l'accès
                const patientId = patientUriMatch[1];
                console.log(`🔍 [HOSPITAL] FedUP querying specific patient: ${patientId}`);

                // Vérifier à quelle(s) étude(s) appartient ce patient
                const studyCheckQuery = `PREFIX ex: <http://example.org/schema#>
PREFIX res: <http://example.org/resource/>
SELECT ?study WHERE { res:${patientId} ex:partOf ?study }`;

                try {
                    console.log(`🔍 [DEBUG] Querying Fuseki for patient ${patientId} studies...`);
                    console.log(`🔍 [DEBUG] Fuseki URL: ${FUSEKI_URL}`);
                    console.log(`🔍 [DEBUG] Study check query: ${studyCheckQuery}`);

                    const requestBody = new URLSearchParams({ query: studyCheckQuery });
                    console.log(`🔍 [DEBUG] Request body: ${requestBody.toString()}`);

                    const studyRes = await fetch(FUSEKI_URL, {
                        method: "POST",
                        headers: { "Content-Type": "application/x-www-form-urlencoded" },
                        body: requestBody
                    });

                    console.log(`🔍 [DEBUG] Fuseki response status: ${studyRes.status}`);
                    const responseText = await studyRes.text();
                    console.log(`🔍 [DEBUG] Fuseki response text: ${responseText}`);

                    const studyResult = JSON.parse(responseText);
                    console.log(`🔍 [DEBUG] Fuseki response parsed: ${JSON.stringify(studyResult)}`);

                    const patientStudies = studyResult.results.bindings.map(b => b.study.value);
                    console.log(`🔍 [DEBUG] Extracted patient studies: ${JSON.stringify(patientStudies)}`);

                    if (patientStudies.length === 0) {
                        // Patient n'appartient à aucune étude ou n'existe pas
                        console.log(`⚠️ [HOSPITAL] Patient ${patientId} has no study association`);
                        return res.status(200).json({
                            head: { vars: [] },
                            results: { bindings: [] }
                        });
                    }

                    // Vérifier si l'utilisateur a accès à au moins une des études du patient
                    const allowedStudyUris = allowedStudies.map(s =>
                        `http://example.org/resource/${s.replace('res:', '')}`
                    );

                    const hasAccess = patientStudies.some(ps => allowedStudyUris.includes(ps));

                    if (!hasAccess) {
                        console.log(`🚫 [HOSPITAL] User ${decoded.preferred_username} DENIED access to ${patientId}`);
                        console.log(`   Patient belongs to: ${patientStudies.join(', ')}`);
                        console.log(`   User has access to: ${allowedStudyUris.join(', ')}`);

                        // Retourner une réponse vide (ne pas révéler l'existence du patient)
                        return res.status(200).json({
                            head: { vars: [] },
                            results: { bindings: [] }
                        });
                    }

                    console.log(`✅ [HOSPITAL] User ${decoded.preferred_username} GRANTED access to ${patientId}`);
                    // Continuer avec la requête originale - pas de réécriture nécessaire

                } catch (err) {
                    console.error(`❌ [HOSPITAL] Error checking patient study: ${err.message}`);
                    return res.status(500).json({ error: "Internal error checking access" });
                }

            } else {
                // CAS 2: Requête générale (pas un patient spécifique) - vérifier les filtres d'étude
                console.log(`➡️  [CAS 2] Requête générale - Vérification/Réécriture`);

                // Détecter si l'utilisateur essaie d'interroger des études spécifiques
                const studyFilterMatch = sparqlQuery.match(/(?:ex:partOf|<http:\/\/example\.org\/schema#partOf>)\s+(?:res:(\w+)|<http:\/\/example\.org\/resource\/(\w+)>)/gi);
                console.log(`🔎 [DETECTION] Filtre d'étude existant: ${studyFilterMatch ? studyFilterMatch.join(', ') : 'NON'}`);

                if (studyFilterMatch) {
                    // L'utilisateur a spécifié des études dans sa requête - vérifier qu'il y a accès
                    const requestedStudies = [];

                    for (const match of studyFilterMatch) {
                        // Extraire le nom de l'étude
                        const studyMatch = match.match(/(?:res:(\w+)|resource\/(\w+))/i);
                        if (studyMatch) {
                            const studyName = studyMatch[1] || studyMatch[2];
                            if (studyName && !requestedStudies.includes(studyName)) {
                                requestedStudies.push(studyName);
                            }
                        }
                    }

                    console.log(`🔍 [HOSPITAL] User requesting access to studies: ${requestedStudies.join(', ')}`);

                    // Vérifier que l'utilisateur a accès à TOUTES les études demandées
                    const allowedStudyNames = allowedStudies.map(s => s.replace('res:', ''));
                    const unauthorizedStudies = requestedStudies.filter(s => !allowedStudyNames.includes(s));

                    if (unauthorizedStudies.length > 0) {
                        console.error(`🚫 [HOSPITAL] User ${decoded.preferred_username} attempting to access unauthorized studies: ${unauthorizedStudies.join(', ')}`);
                        console.error(`   User has access to: ${allowedStudyNames.join(', ')}`);

                        return res.status(403).json({
                            error: "Access Denied",
                            message: `You do not have permission to access the following studies: ${unauthorizedStudies.join(', ')}`,
                            reason: `User ${decoded.preferred_username} only has access to: ${allowedStudyNames.join(', ')}`
                        });
                    }

                    console.log(`✅ [HOSPITAL] User ${decoded.preferred_username} authorized to query requested studies`);
                }

                // TOUJOURS appliquer un filtre d'étude pour sécuriser les requêtes
                // Sauf si l'utilisateur a déjà spécifié un filtre d'étude valide
                if (!studyFilterMatch) {
                    console.log(`🔒 [HOSPITAL] Applying mandatory study filter for security`);

                    // Détecter quelle variable l'utilisateur utilise pour les sujets
                    // Chercher des patterns comme "?patient a ex:Patient", "?p a ...", ou "?s ?p ?o"
                    let subjectVar = '?s'; // Valeur par défaut pour les requêtes génériques

                    // D'abord chercher une variable patient explicite
                    const patientVarMatch = sparqlQuery.match(/(\?\w+)\s+a\s+(?:ex:Patient|<http:\/\/example\.org\/schema#Patient>)/i);
                    if (patientVarMatch) {
                        subjectVar = patientVarMatch[1];
                        console.log(`🔍 [HOSPITAL] Detected patient variable: ${subjectVar}`);
                    } else {
                        // Sinon, chercher la première variable dans la clause WHERE
                        const firstVarMatch = sparqlQuery.match(/WHERE\s*\{\s*(\?\w+)/i);
                        if (firstVarMatch) {
                            subjectVar = firstVarMatch[1];
                            console.log(`🔍 [HOSPITAL] Using first variable as subject: ${subjectVar}`);
                        }
                    }

                    // S'assurer que les préfixes nécessaires sont présents
                    const hasResPrefix = sparqlQuery.toLowerCase().includes('prefix res:');
                    const hasExPrefix = sparqlQuery.toLowerCase().includes('prefix ex:');
                    let prefixToAdd = '';

                    if (!hasResPrefix) {
                        prefixToAdd = 'PREFIX res: <http://example.org/resource/>\n';
                    }
                    if (!hasExPrefix) {
                        prefixToAdd += 'PREFIX ex: <http://example.org/schema#>\n';
                    }

                    // Trouver la clause WHERE et ajouter le filtre d'étude
                    const whereMatch = sparqlQuery.match(/WHERE\s*\{/i);
                    if (whereMatch) {
                        const whereIndex = whereMatch.index + whereMatch[0].length;

                        // Construire le filtre pour les études autorisées
                        // On utilise un pattern qui filtre les données liées aux études autorisées
                        const studiesFullUris = allowedStudies.map(s =>
                            `<http://example.org/resource/${s.replace('res:', '')}>`
                        );

                        let filterClause;
                        if (studiesFullUris.length === 1) {
                            // Une seule étude - filtre simple
                            filterClause = `\n  ${subjectVar} <http://example.org/schema#partOf> ${studiesFullUris[0]} .`;
                        } else {
                            // Plusieurs études - utiliser FILTER IN
                            const studiesList = studiesFullUris.join(', ');
                            filterClause = `\n  ${subjectVar} <http://example.org/schema#partOf> ?_allowedStudy .\n  FILTER (?_allowedStudy IN (${studiesList}))`;
                        }

                        // Reconstruire la requête avec préfixe et filtre
                        rewrittenQuery = prefixToAdd +
                                       sparqlQuery.substring(0, whereIndex) +
                                       filterClause +
                                       sparqlQuery.substring(whereIndex);

                        console.log(`🔄 [HOSPITAL] Query rewritten to filter by allowed studies`);
                        console.log(`📝 [HOSPITAL] Original query: ${sparqlQuery}`);
                        console.log(`📝 [HOSPITAL] Rewritten query: ${rewrittenQuery}`);
                    }
                }
            }

            // Vérifier la permission générale pour patient_data (utilise le token local)
            const permissionResult = await checkPermission(localToken, 'patient_data', 'read');

            if (!permissionResult.granted) {
                console.error(`🚫 [HOSPITAL] Access DENIED for user ${decoded.preferred_username} to patient_data`);
                return res.status(403).json({
                    error: "Access Denied",
                    message: "You do not have permission to access patient data",
                    reason: permissionResult.reason
                });
            }

            console.log(`✅ [HOSPITAL] Access GRANTED for user ${decoded.preferred_username} to patient_data`);

            // ÉTAPE 5: ENVOI VERS FUSEKI LOCAL (avec la requête réécrite)
            // Note: On utilise le token Central unique - pas de token local
            const formBody = new URLSearchParams({
                query: rewrittenQuery
            });

            const fusekiRes = await fetch(FUSEKI_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded"
                    // Pas de token pour Fuseki - l'autorisation est gérée par le proxy
                },
                body: formBody.toString()
            });

            const text = await fusekiRes.text();
            res.set("Content-Type", fusekiRes.headers.get("content-type"));
            return res.status(fusekiRes.status).send(text);

        } catch (err) {
            console.error("❌ [HOSPITAL] Erreur :", err.message);
            // 403 Forbidden est plus approprié qu'une erreur interne pour un token invalide.
            return res.status(403).json({ error: "Token invalide ou erreur interne", details: err.message });
        }
    });

    // Route de stockage du token pour compatibilité (si besoin, mais généralement inutile)
    app.post("/store-token", (req, res) => {
        return res.status(405).json({ error: "Not allowed in Hospital mode" });
    });

    app.listen(PORT, () => console.log(`👂 Proxy Hospital écoute sur le port ${PORT}`));
}


// ─────────────────────────────────────────────────────────────
// POINT D'ENTRÉE PRINCIPAL
// ─────────────────────────────────────────────────────────────
if (PROXY_MODE === 'FORWARD') {
    startForwardProxy();
} else if (PROXY_MODE === 'HOSPITAL') {
    startHospitalProxy();
} else {
    console.error(`❌ PROXY_MODE inconnu : ${PROXY_MODE}. Utiliser 'FORWARD' ou 'HOSPITAL'.`);
    process.exit(1);
}