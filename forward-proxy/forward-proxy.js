const http = require('http');
const { URL } = require('url');

// Stockage du token en mémoire
let currentToken = null;

const PORT = 8888;

const server = http.createServer((clientReq, clientRes) => {
    const reqUrl = clientReq.url; // Fuseki envoie l'URL complète ici (ex: http://proxy1:4000/sparql)

    // ─────────────────────────────────────────────────────────────
    // 1. GESTION DU STOCKAGE DU TOKEN (Venant du Web JS)
    // ─────────────────────────────────────────────────────────────
    if (reqUrl.includes('/store-token')) {
        // Headers CORS pour que le navigateur accepte la réponse
        clientRes.setHeader('Access-Control-Allow-Origin', '*');
        clientRes.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        clientRes.setHeader('Access-Control-Allow-Headers', 'X-Token, Content-Type');

        if (clientReq.method === 'OPTIONS') {
            clientRes.writeHead(200);
            clientRes.end();
            return;
        }

        if (clientReq.method === 'POST') {
            const token = clientReq.headers['x-token'];
            if (token) {
                currentToken = token;
                console.log('📥 [ForwardProxy] Token reçu et mis à jour.');
                clientRes.writeHead(200, { 'Content-Type': 'application/json' });
                clientRes.end(JSON.stringify({ status: 'stored' }));
            } else {
                clientRes.writeHead(400);
                clientRes.end(JSON.stringify({ error: 'No Token provided' }));
            }
            return;
        }
    }

    // ─────────────────────────────────────────────────────────────
    // 2. LOGIQUE D'INTERCEPTION (Venant de Fuseki)
    // ─────────────────────────────────────────────────────────────
    console.log(` [ForwardProxy] Interception requête vers : ${reqUrl}`);
    let cleanedUrl = reqUrl; // Déclaration unique, en dehors du try
    try {
        cleanedUrl = reqUrl.startsWith('/') ? reqUrl.substring(1) : reqUrl;
        //const decodedUrl = decodeURIComponent(cleanedUrl);
        // 3. Analyse l'URL
        const targetUrl = new URL(cleanedUrl);
        // Configuration de la requête sortante
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
            console.log(' [ForwardProxy] Token injecté.');
        } else {
            console.warn('️ [ForwardProxy] Aucun token en mémoire ! Envoi sans authentification.');
        }

        // Nettoyage des headers (Host est géré automatiquement par Node)
        delete options.headers['host'];

        // Création de la requête vers la destination (Proxy Hôpital)
        const proxyReq = http.request(options, (proxyRes) => {
            // On renvoie la réponse de l'hôpital vers Fuseki
            clientRes.writeHead(proxyRes.statusCode, proxyRes.headers);
            proxyRes.pipe(clientRes, { end: true });
        });

        proxyReq.on('error', (e) => {
            console.error(` [ForwardProxy] Erreur connexion cible : ${e.message}`);
            clientRes.writeHead(502);
            clientRes.end('Bad Gateway via Forward Proxy');
        });

        // On transfère le corps de la requête (le SPARQL) de Fuseki vers l'Hôpital
        clientReq.pipe(proxyReq, { end: true });

    } catch (err) {
        console.error('[ForwardProxy] URL invalide:', reqUrl);
        clientRes.writeHead(400);
        clientRes.end('Invalid URL');
    }
});

server.listen(PORT, () => {
    console.log(` Node.js Forward Proxy écoute sur le port ${PORT}`);
});