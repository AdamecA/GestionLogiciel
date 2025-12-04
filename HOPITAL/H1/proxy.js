import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();

// Parse automatiquement le corps JSON des requêtes
app.use(express.json());

// Autorise le front (http://localhost:3000) à appeler ce proxy (CORS)
app.use(cors({
    origin: "http://localhost:3000",
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "Authorization"]
}));

// L'URL de Fuseki (doit être configurée dans les variables d'environnement Docker pour H1 et H2)
const FUSEKI_URL = process.env.FUSEKI_URL
    || "http://fuseki:3030/dataset/query";
// IMPORTANT: Assurez-vous que votre variable d'environnement FUSEKI_URL
// est correctement définie pour chaque proxy (e.g., fuseki-H1:3030 ou fuseki-H2:3030).

// Définition du port (doit être 4000 pour H1 et 4001 pour H2 si vous les lancez séparément)
const PORT = process.env.PORT || 4000;

/* * ─────────────────────────────────────────────────────────────────────────────
 * L'authentification par JWT a été entièrement retirée pour le test.
 * ─────────────────────────────────────────────────────────────────────────────
 */

app.post("/query", async (req, res) => {
    // Route /query pour les requêtes complètes du front (pas de vérification de token)
    const { sparql } = req.body;

    try {
        const fusekiRes = await fetch(FUSEKI_URL, {
            method: "POST",
            headers: { "Content-Type": "application/sparql-query" },
            body: sparql,
        });

        const text = await fusekiRes.text();
        res.status(fusekiRes.status).send(text);

    } catch (err) {
        console.error("❌ Erreur proxy lors de l'envoi à Fuseki:", err.message);
        res.status(500).json({ error: "Erreur interne du proxy: " + err.message });
    }
});

/**
 * Route /sparql (utilisée par FedUP pour les requêtes de sélection de source, y compris les ASK).
 * Cette route gère les requêtes vides en envoyant un "ASK {}" valide à Fuseki.
 */
app.all("/sparql", async (req, res) => {
    let queryText = "";
    let isFedUPTest = false;

    // 1. Tente de récupérer la requête depuis le corps (POST) ou l'URL (GET)
    if (req.method === "POST") {
        // FedUP envoie souvent des requêtes POST de sélection de source,
        // ou des requêtes POST application/x-www-form-urlencoded
        if (req.body && req.body.query) {
            queryText = req.body.query;
        }
    } else if (req.method === "GET" && req.query.query) {
        queryText = req.query.query;
    }

    // 2. CORRECTION CRUCIALE : Si la requête est vide, injecter un ASK {}
    if (!queryText || queryText.trim() === "") {
        console.log("👀 Requête /sparql vide reçue (probablement test de FedUP). Envoi de ASK {} par défaut.");
        queryText = "ASK {}"; // Injecte une requête SPARQL valide
        isFedUPTest = true;
    } else {
        console.log(`✅ Requête /sparql reçue. Envoi à Fuseki: ${queryText.substring(0, 50)}...`);
    }

    try {
        // 3. Envoi à Fuseki
        const fusekiRes = await fetch(FUSEKI_URL, {
            method: "POST",
            headers: { "Content-Type": "application/sparql-query" },
            body: queryText,
        });

        const text = await fusekiRes.text();

        // FedUP a besoin d'une réponse 200 OK pour considérer la source comme viable.
        if (isFedUPTest && fusekiRes.status !== 200) {
            console.error(`❌ Fuseki a renvoyé ${fusekiRes.status} pour le test ASK minimal.`);
            // On laisse l'erreur du Proxy se propager ou on renvoie une 503 pour que FedUP rejette.
        }

        const contentType = fusekiRes.headers.get("content-type") || "application/sparql-results+json";
        res.set("Content-Type", contentType);
        res.status(fusekiRes.status).send(text);

    } catch (err) {
        // Erreur de connexion au service Fuseki (par exemple, si fuseki-H1 n'est pas démarré)
        console.error("❌ Erreur de connexion ou envoi à Fuseki /sparql:", err.message);
        res.status(503).json({ error: "Erreur de connexion avec Fuseki: " + err.message });
    }
});


app.listen(PORT, () => console.log(`🚀 Proxy DÉSACTIVÉ en écoute sur le port ${PORT}`));