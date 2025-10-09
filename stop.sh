#!/bin/bash
echo "🛑 Arrêt de tous les services..."
docker-compose -f ./HOPITAL/H1/docker-compose.yml down
docker-compose -f ./HOPITAL/H2/docker-compose.yml down
docker-compose -f ./docker-compose.yml down
echo "✅ Tous les conteneurs sont arrêtés."
