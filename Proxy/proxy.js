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
// FONCTION D'ÉCHANGE DE TOKEN (Token Translation)
// ─────────────────────────────────────────────────────────────
async function exchangeTokenForLocal(centralToken) {
    try {
        // 1. Décoder le token central pour extraire le username
        const decoded = jwt.decode(centralToken);
        if (!decoded || !decoded.preferred_username) {
            throw new Error('Unable to extract username from central token');
        }

        const username = decoded.preferred_username;
        console.log(`🔄 [TokenExchange] Exchanging token for user: ${username}`);

        // 2. Obtenir un token du Keycloak local en utilisant username=password
        const tokenUrl = `${LOCAL_KEYCLOAK_URL}/realms/${LOCAL_REALM}/protocol/openid-connect/token`;

        const params = new URLSearchParams();
        params.append('grant_type', 'password');
        params.append('client_id', LOCAL_CLIENT_ID);
        params.append('client_secret', LOCAL_CLIENT_SECRET);
        params.append('username', username);
        params.append('password', username); // username = password (simulation de fédération)

        const response = await fetch(tokenUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: params.toString()
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Local Keycloak token exchange failed: ${response.status} - ${errorText}`);
        }

        const tokenData = await response.json();
        console.log(`✅ [TokenExchange] Local token obtained for ${username}`);

        return tokenData.access_token;

    } catch (err) {
        console.error(`❌ [TokenExchange] Error: ${err.message}`);
        throw err;
    }
}

// ─────────────────────────────────────────────────────────────
// FONCTION DE VÉRIFICATION DES PERMISSIONS VIA KEYCLOAK
// ─────────────────────────────────────────────────────────────
async function checkPermission(localToken, resourceName, scope) {
    try {
        console.log(`🔐 [Authorization] Checking permission for resource: ${resourceName}, scope: ${scope}`);

        // Appel à l'API Keycloak Token Endpoint pour obtenir un RPT (Requesting Party Token)
        const tokenUrl = `${LOCAL_KEYCLOAK_URL}/realms/${LOCAL_REALM}/protocol/openid-connect/token`;

        const params = new URLSearchParams();
        params.append('grant_type', 'urn:ietf:params:oauth:grant-type:uma-ticket');
        params.append('audience', LOCAL_CLIENT_ID);
        params.append('permission', `${resourceName}#${scope}`);

        const response = await fetch(tokenUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': `Bearer ${localToken}`
            },
            body: params.toString()
        });

        if (response.ok) {
            const data = await response.json();
            console.log(`✅ [Authorization] Permission GRANTED for ${resourceName}#${scope}`);
            return { granted: true, rpt: data.access_token };
        } else if (response.status === 403 || response.status === 401) {
            console.log(`❌ [Authorization] Permission DENIED for ${resourceName}#${scope}`);
            return { granted: false, reason: 'Access denied by policy' };
        } else {
            const errorText = await response.text();
            console.error(`⚠️ [Authorization] Error checking permission: ${response.status} - ${errorText}`);
            return { granted: false, reason: `Authorization service error: ${response.status}` };
        }

    } catch (err) {
        console.error(`❌ [Authorization] Exception: ${err.message}`);
        return { granted: false, reason: err.message };
    }
}

// ─────────────────────────────────────────────────────────────
// FONCTION POUR EXTRAIRE LA STUDY D'UNE REQUÊTE SPARQL
// ─────────────────────────────────────────────────────────────
function extractStudyFromSPARQL(sparqlQuery) {
    try {
        const query = sparqlQuery.toLowerCase();

        // Cherche des patterns comme "res:study_A" ou "study_A" dans la requête
        if (query.includes('study_a') || query.includes('res:study_a')) {
            return 'study_A';
        } else if (query.includes('study_b') || query.includes('res:study_b')) {
            return 'study_B';
        }

        // Si aucune étude spécifique n'est mentionnée, retourne null (accès général)
        return null;
    } catch (err) {
        console.error(`Error parsing SPARQL: ${err.message}`);
        return null;
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

            // ÉTAPE 2: ÉCHANGE DE TOKEN (Token Translation)
            // Obtenir un token du Keycloak local basé sur l'utilisateur authentifié centralement
            let localToken;
            if (LOCAL_KEYCLOAK_URL && LOCAL_REALM && LOCAL_CLIENT_ID && LOCAL_CLIENT_SECRET) {
                console.log(`🔄 [HOSPITAL] Performing token exchange...`);
                localToken = await exchangeTokenForLocal(centralToken);
                console.log(`✅ [HOSPITAL] Token exchange successful - using local token`);
            } else {
                console.warn(`⚠️ [HOSPITAL] No local Keycloak configured - using central token`);
                localToken = centralToken;
            }

            // RÉCUPÉRATION DE LA REQUÊTE SPARQL
            let sparqlQuery = req.body;
            if ((!sparqlQuery || (typeof sparqlQuery === 'object' && Object.keys(sparqlQuery).length === 0)) && req.query.query) {
                sparqlQuery = req.query.query;
            }

            if (!sparqlQuery || (typeof sparqlQuery === 'object' && Object.keys(sparqlQuery).length === 0)) {
                return res.status(400).json({ error: "Requete SPARQL manquante" });
            }

            // ÉTAPE 3: VÉRIFICATION DES PERMISSIONS VIA KEYCLOAK
            // Déterminer quelle ressource l'utilisateur essaie d'accéder
            const studyRequested = extractStudyFromSPARQL(sparqlQuery);
            let resourceToCheck = 'patient_data'; // Par défaut

            if (studyRequested === 'study_A') {
                resourceToCheck = 'study_A';
            } else if (studyRequested === 'study_B') {
                resourceToCheck = 'study_B';
            }

            // Vérifier la permission avec Keycloak
            const permissionResult = await checkPermission(localToken, resourceToCheck, 'read');

            if (!permissionResult.granted) {
                console.error(`🚫 [HOSPITAL] Access DENIED for user ${decoded.preferred_username} to resource ${resourceToCheck}`);
                return res.status(403).json({
                    error: "Access Denied",
                    message: `You do not have permission to access ${resourceToCheck}`,
                    reason: permissionResult.reason
                });
            }

            console.log(`✅ [HOSPITAL] Access GRANTED for user ${decoded.preferred_username} to resource ${resourceToCheck}`);

            // ÉTAPE 4: ENVOI VERS FUSEKI LOCAL (avec le token local)
            const formBody = new URLSearchParams({
                query: sparqlQuery
            });

            const fusekiRes = await fetch(FUSEKI_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                    "Authorization": `Bearer ${localToken}` // Token local pour logs/audit
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