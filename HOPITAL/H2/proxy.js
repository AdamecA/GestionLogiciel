import express from "express";    
import fetch from "node-fetch";
import cors from "cors";            // Pour autoriser les requêtes cross-origin (depuis le front)
import jwt from "jsonwebtoken";     // Pour vérifier localement le JWT (signature/claims)
import jwksClient from "jwks-rsa";  // Pour récupérer la clé publique (JWKS) de Keycloak

const app = express();

// Parse automatiquement le corps JSON des requêtes
app.use(express.json());

// Autorise le front (http://localhost:3000) à appeler ce proxy (CORS)
app.use(cors({
    origin: "http://localhost:3000",
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "Authorization"]
}));

// Issuer **public** attendu dans le token (côté navigateur → souvent "localhost")
const PUBLIC_ISSUER = process.env.PUBLIC_ISSUER
    || "http://localhost:8080/realms/myrealm";

// URL JWKS (clé publique) joignable depuis Docker (nom de service "keycloak")
const JWKS_URI = process.env.JWKS_URI
    || "http://keycloak:8080/realms/myrealm/protocol/openid-connect/certs";

// Endpoint SPARQL de Fuseki (réseau Docker)
const FUSEKI_URL = process.env.FUSEKI_URL
    || "http://fuseki-H2:3030/dataset/query";

// client_id du front attendu (utilisé dans les vérifications aud/azp)
const EXPECTED_CLIENT = process.env.EXPECTED_CLIENT || "webapp";

// Client JWKS : permet de récupérer la clé publique (selon le "kid" du JWT)
const client = jwksClient({ jwksUri: JWKS_URI });

// Récupération de la clé de signature à partir du header "kid" du token
function getKey(header, callback) {
    client.getSigningKey(header.kid, (err, key) => {
        if (err) {
            console.error("❌ Erreur JWKS :", err);
            return callback(err);
        }
        const signingKey = key.publicKey || key.rsaPublicKey;
        callback(null, signingKey);
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Vérification robuste du JWT : signature + issuer ; audience/azp souples
function verifyToken(token) {
    return new Promise((resolve, reject) => {
        jwt.verify(
            token,
            getKey,                             // récupère dynamiquement la clé via JWKS
            {
                issuer: PUBLIC_ISSUER,            // vérifie que le token vient du bon realm (iss)
                algorithms: ["RS256"],            // algorithme de signature attendu
                // NB : jsonwebtoken vérifie aussi automatiquement exp/nbf (expiration/validité)
            },
            (err, decoded) => {
                if (err) return reject(err);

                // Normalise l'audience (aud peut être undefined, string, ou array)
                const audRaw = decoded.aud;
                const aud = Array.isArray(audRaw) ? audRaw : (audRaw ? [audRaw] : []);
                const azp = decoded.azp; // "Authorized Party" = client_id destinataire

                const audOk =
                    aud.includes(EXPECTED_CLIENT) ||
                    aud.includes("proxy") ||
                    aud.includes("account") ||
                    azp === EXPECTED_CLIENT;

                if (!audOk) {
                    const details = `aud=${aud.join(",")} | azp=${azp ?? ""}`;
                    return reject(new Error(`jwt audience invalid. ${details}`));
                }

                return resolve(decoded);
            }
        );
    });
}

app.post("/query", async (req, res) => {
    // Récupère le header Authorization
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ error: "Token manquant ou invalide" });
    }

    const token = authHeader.split(" ")[1];
    const { sparql } = req.body;

    try {
        // Vérifie la validité du token (signature/iss/aud/exp/…)
        const decoded = await verifyToken(token);
        console.log(
            "✅ Token OK | user:",
            decoded.preferred_username,
            "| iss:", decoded.iss,
            "| azp:", decoded.azp,
            "| aud:", decoded.aud
        );
        
        //TODO 
        //vérifier la politique au près de Keycloak local
        
        // Envoie la requête SPARQL à Fuseki (format: application/sparql-query)
        const fusekiRes = await fetch(FUSEKI_URL, {
            method: "POST",
            headers: { "Content-Type": "application/sparql-query" },
            body: sparql,
        });

        // Retourne la réponse brute (XML/JSON/… selon Fuseki)
        const text = await fusekiRes.text();
        res.status(200).send(text);

    } catch (err) {
        // En cas d’échec de vérification du token ou autre
        console.error("❌ Erreur token :", err.message);
        res.status(403).json({ error: "Erreur proxy (403): " + err.message });
    }
});

app.listen(4000, () => console.log("🚀 Proxy (H2) en écoute sur le port 4001"));