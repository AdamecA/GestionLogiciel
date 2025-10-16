#!/bin/sh
set -e

FUSEKI_URL="${FUSEKI_URL:-http://fuseki:3030}"
DATA_FILE="${DATA_FILE:-/data/h1.ttl}"
ADMIN_USER="${ADMIN_USER:-admin}"
ADMIN_PASS="${ADMIN_PASS:-admin}"

echo "⏳ Attente de Fuseki sur ${FUSEKI_URL} (/$/ping)..."
# /$/ping répond 200 dès que Fuseki est prêt
until curl -sf "${FUSEKI_URL}/$/ping" > /dev/null; do
  echo "… en attente"
  sleep 2
done
echo "✅ Fuseki répond."

# Vérifie la présence du dataset
echo "🔎 Vérification des datasets existants…"
DS_JSON="$(curl -sf "${FUSEKI_URL}/$/datasets")" || DS_JSON=""
echo "$DS_JSON" | grep -q '"dsName":"dataset"' && HAS_DS=1 || HAS_DS=0

if [ "$HAS_DS" -eq 0 ]; then
  echo "➕ Création du dataset 'dataset' (mem)…"
  curl -sf -u "${ADMIN_USER}:${ADMIN_PASS}" -X POST \
    -H "Content-Type: application/x-www-form-urlencoded" \
    --data "dbName=dataset&dbType=mem" \
    "${FUSEKI_URL}/$/datasets"
  echo "✅ Dataset créé."
else
  echo "✅ Dataset 'dataset' déjà présent."
fi

echo "🚚 Chargement du TTL dans le graphe par défaut…"
curl -sf -X PUT \
  -H "Content-Type: text/turtle" \
  --data-binary @"${DATA_FILE}" \
  "${FUSEKI_URL}/dataset?default"

echo "✅ Données H1 chargées."
