#!/bin/bash

echo "=== Testing Bob (study_A_researcher) accessing study_A ==="

# 1. Get token from central Keycloak for bob
CENTRAL_TOKEN=$(curl -s -X POST "http://localhost:8080/realms/myrealm/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=password" \
  -d "client_id=webapp" \
  -d "username=bob" \
  -d "password=bob" | jq -r '.access_token')

if [ -z "$CENTRAL_TOKEN" ] || [ "$CENTRAL_TOKEN" == "null" ]; then
  echo "❌ Failed to get central token for bob"
  exit 1
fi

echo "✅ Got central token for bob"

# 2. Query study_A via Hospital 1 proxy
QUERY='PREFIX res: <http://hospital.org/resource/>
SELECT ?s ?p ?o
WHERE {
  ?s ?p ?o .
  FILTER(CONTAINS(STR(?s), "study_A"))
}
LIMIT 5'

echo ""
echo "Querying study_A data..."
RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}" -X POST "http://localhost:4000/sparql" \
  -H "Authorization: Bearer ${CENTRAL_TOKEN}" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "query=${QUERY}")

HTTP_CODE=$(echo "$RESPONSE" | grep "HTTP_CODE:" | cut -d: -f2)
BODY=$(echo "$RESPONSE" | sed '/HTTP_CODE:/d')

echo ""
if [ "$HTTP_CODE" = "200" ]; then
  echo "✅ SUCCESS - Bob CAN access study_A (expected)"
  echo "Results:"
  echo "$BODY" | grep -v "^$" | head -10
else
  echo "❌ FAILED - HTTP $HTTP_CODE"
  echo "$BODY"
fi
