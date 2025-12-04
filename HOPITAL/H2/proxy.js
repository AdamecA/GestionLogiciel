import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import jwt from "jsonwebtoken";
import jwksClient from "jwks-rsa";

const app = express();

const FUSEKI_URL = process.env.FUSEKI_URL || "http://fuseki:3030/dataset/query";
const PUBLIC_ISSUER = process.env.PUBLIC_ISSUER || "http://localhost:8080/realms/myrealm";
const JWKS_URI = process.env.JWKS_URI || "http://keycloak:8080/realms/myrealm/protocol/openid-connect/certs";

const client = jwksClient({ jwksUri: JWKS_URI });

function getKey(header, callback) {
    client.getSigningKey(header.kid, (err, key) => {
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

app.use(express.text({ type: "*/*" }));
app.use(express.urlencoded({ extended: true }));
app.use(cors());

// LOGGER DE DEBUG : Pour voir TOUT ce qui arrive
app.use((req, res, next) => {
    console.log(`[H2] Requête entrante : ${req.method} ${req.url}`);
    next();
});

// ─────────────────────────────────────────────────────────────
//  ROUTE PRINCIPALE (Accepte GET et POST)
// ─────────────────────────────────────────────────────────────
app.all("/sparql", async (req, res) => {
    // Si ce n'est ni GET ni POST, on rejette
    if (req.method !== 'POST' && req.method !== 'GET') {
        return res.status(405).send("Method Not Allowed");
    }

    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        console.error("[H2] Pas de token !");
        return res.status(401).json({ error: "Missing Authorization: Bearer <token>" });
    }

    const token = authHeader.split(" ")[1];

    try {
        const decoded = await verifyToken(token);
        console.log(`[H2] Token OK | User: ${decoded.preferred_username}`);

        // 1. Récupération de la requête SPARQL
        let sparqlQuery = req.body;

        // Si body vide, on regarde dans l'URL (cas du GET ou du POST encoded)
        if ((!sparqlQuery || (typeof sparqlQuery === 'object' && Object.keys(sparqlQuery).length === 0)) && req.query.query) {
            sparqlQuery = req.query.query;
            console.log("[H2] SPARQL trouvé dans l'URL.");
        }

        if (!sparqlQuery || (typeof sparqlQuery === 'object' && Object.keys(sparqlQuery).length === 0)) {
            return res.status(400).json({ error: "Requete SPARQL manquante" });
        }

        // 2. Envoi vers Fuseki Local (Toujours en POST pour être sûr)
        // Fuseki supporte le POST même si on a reçu un GET
        const fusekiRes = await fetch(FUSEKI_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/sparql-query"
            },
            body: sparqlQuery
        });

        const text = await fusekiRes.text();
        res.set("Content-Type", fusekiRes.headers.get("content-type"));
        return res.status(fusekiRes.status).send(text);

    } catch (err) {
        console.error("[H2] Erreur :", err.message);
        return res.status(403).json({ error: "Token invalide ou erreur interne" });
    }
});

app.listen(4000, () => console.log("Proxy h2 en écoute sur 4001"));