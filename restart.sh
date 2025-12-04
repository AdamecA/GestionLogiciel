#!/bin/bash

set -e  # arrêter si une commande échoue

echo "🔄 Redémarrage de tous les services..."

# On appelle stop.sh
./stop.sh

# Puis start.sh
./start.sh

echo "✅ Tous les conteneurs ont été redémarrés."
