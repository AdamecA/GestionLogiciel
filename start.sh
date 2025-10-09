#!/bin/bash

set -e  # stop si erreur

echo "🚀 Démarrage de tous les services Docker Compose..."

# Hôpital 1
echo "🩺 Lancement H1..."
docker-compose -f ./HOPITAL/H1/docker-compose.yml up -d

# Hôpital 2
echo "🩺 Lancement H2..."
docker-compose -f ./HOPITAL/H2/docker-compose.yml up -d

# Web
echo "🌐 Lancement Web..."
docker-compose -f ./docker-compose.yml up -d

echo "✅ Tous les conteneurs sont démarrés."
