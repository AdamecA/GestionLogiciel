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

        const token = authHeader.split(" ")[1];

        try {
            // VÉRIFICATION DU TOKEN
            const decoded = await verifyToken(token);
            console.log(`✅ [HOSPITAL] Token OK | User: ${decoded.preferred_username}`);

            // RÉCUPÉRATION DE LA REQUÊTE SPARQL
            let sparqlQuery = req.body;
            if ((!sparqlQuery || (typeof sparqlQuery === 'object' && Object.keys(sparqlQuery).length === 0)) && req.query.query) {
                sparqlQuery = req.query.query;
            }

            if (!sparqlQuery || (typeof sparqlQuery === 'object' && Object.keys(sparqlQuery).length === 0)) {
                return res.status(400).json({ error: "Requete SPARQL manquante" });
            }

            // ENVOI VERS FUSEKI LOCAL
            const formBody = new URLSearchParams({
                query: sparqlQuery
            });

            const fusekiRes = await fetch(FUSEKI_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded"
                },
                body: formBody.toString()
            });

            const text = await fusekiRes.text();
            res.set("Content-Type", fusekiRes.headers.get("content-type"));
            return res.status(fusekiRes.status).send(text);

        } catch (err) {
            console.error("❌ [HOSPITAL] Erreur :", err.message);
            // 403 Forbidden est plus approprié qu'une erreur interne pour un token invalide.
            return res.status(403).json({ error: "Token invalide ou erreur interne" });
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