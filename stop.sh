#!/bin/bash
echo "🛑 Arrêt de tous les services..."

# Arrêt Hospital 1
docker-compose -f ./HOPITAL/H1/docker-compose.yml down

# Arrêt Hospital 2
docker-compose -f ./HOPITAL/H2/docker-compose.yml down

# Arrêt services centraux
docker-compose -f ./docker-compose.yml down

echo "✅ Tous les conteneurs sont arrêtés."
