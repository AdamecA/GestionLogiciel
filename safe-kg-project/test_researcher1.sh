#!/bin/bash

# Test with researcher1 (should be ALLOWED)

echo "========================================="
echo "Testing Hospital A Access: researcher1"
echo "========================================="
echo ""

# Get token
echo "1️⃣  Getting token for researcher1..."
TOKEN=$(curl -s -X POST 'http://localhost:8090/realms/safe-kg/protocol/openid-connect/token' \
  -d 'grant_type=password' \
  -d 'client_id=my-app' \
  -d 'username=researcher1' \
  -d 'password=password123' \
  -d 'scope=openid profile email' | jq -r '.access_token')

if [ "$TOKEN" == "null" ] || [ -z "$TOKEN" ]; then
  echo "   ❌ Failed to get token"
  exit 1
fi

echo "   ✅ Token obtained"
echo ""

# Query Hospital A
echo "2️⃣  Querying Hospital A (via proxy)..."
echo ""

curl 'http://localhost:4001/hospital-a/query' \
  -H "Authorization: Bearer $TOKEN" \
  --data-urlencode 'query=SELECT * WHERE {?s ?p ?o} LIMIT 5'

echo ""
echo ""
echo "========================================="
echo "Expected: Patient data returned ✅"
echo "Reason: researcher1 has STUDY_A_RESEARCHER role"
echo "        which maps to HOSPITAL_STUDY_A_ACCESS"
echo "========================================="
