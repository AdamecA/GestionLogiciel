#!/bin/bash

echo "=========================================="
echo "  RBAC TEST WITH REAL H1 DATASET"
echo "=========================================="

# Test Bob accessing study_A data
echo ""
echo "=== Test 1: Bob (study_A_researcher) queries study_A data ==="
BOB_TOKEN=$(curl -s -X POST "http://localhost:8080/realms/myrealm/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=password" \
  -d "client_id=webapp" \
  -d "username=bob" \
  -d "password=bob" | jq -r '.access_token')

QUERY='SELECT ?s ?p ?o WHERE { ?s ?p ?o } LIMIT 10'

curl -s -X POST "http://localhost:4000/sparql" \
  -H "Authorization: Bearer ${BOB_TOKEN}" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "query=${QUERY}" > /tmp/bob_result.txt

if grep -q "error\|Error\|403" /tmp/bob_result.txt; then
    echo "❌ Bob was denied access"
    cat /tmp/bob_result.txt
else
    echo "✅ Bob successfully queried data"
    head -20 /tmp/bob_result.txt
fi

# Test Carol trying to access study_A (should fail)
echo ""
echo "=== Test 2: Carol (study_B_researcher) tries study_A data ==="
CAROL_TOKEN=$(curl -s -X POST "http://localhost:8080/realms/myrealm/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=password" \
  -d "client_id=webapp" \
  -d "username=carol" \
  -d "password=carol" | jq -r '.access_token')

# Try to query study_A explicitly
QUERY_A='SELECT * WHERE { <http://hospital.org/resource/study_A> ?p ?o }'

HTTP_CODE=$(curl -s -w "%{http_code}" -o /tmp/carol_studyA.txt -X POST "http://localhost:4000/sparql" \
  -H "Authorization: Bearer ${CAROL_TOKEN}" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "query=${QUERY_A}")

if [ "$HTTP_CODE" = "403" ]; then
    echo "✅ Carol was correctly DENIED access to study_A (HTTP 403)"
    cat /tmp/carol_studyA.txt
else
    echo "❌ Unexpected result: HTTP $HTTP_CODE"
fi

# Test Grace (senior_researcher) accessing everything
echo ""
echo "=== Test 3: Grace (senior_researcher) queries any data ==="
GRACE_TOKEN=$(curl -s -X POST "http://localhost:8080/realms/myrealm/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=password" \
  -d "client_id=webapp" \
  -d "username=grace" \
  -d "password=grace" | jq -r '.access_token')

curl -s -X POST "http://localhost:4000/sparql" \
  -H "Authorization: Bearer ${GRACE_TOKEN}" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "query=${QUERY}" > /tmp/grace_result.txt

if grep -q "error\|Error\|403" /tmp/grace_result.txt; then
    echo "❌ Grace was denied access"
else
    echo "✅ Grace (senior) successfully queried data"
    head -20 /tmp/grace_result.txt
fi

echo ""
echo "=========================================="
