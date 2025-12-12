#!/bin/bash

echo "=========================================="
echo "   HOSPITAL 1 RBAC AUTHORIZATION TESTS"
echo "=========================================="

# Helper function to test access
test_access() {
    local USER=$1
    local PASSWORD=$2
    local STUDY=$3
    local EXPECTED=$4
    
    echo ""
    echo "--- Test: $USER accessing $STUDY (expect: $EXPECTED) ---"
    
    # Get token
    TOKEN=$(curl -s -X POST "http://localhost:8080/realms/myrealm/protocol/openid-connect/token" \
      -H "Content-Type: application/x-www-form-urlencoded" \
      -d "grant_type=password" \
      -d "client_id=webapp" \
      -d "username=$USER" \
      -d "password=$PASSWORD" | jq -r '.access_token')
    
    if [ -z "$TOKEN" ] || [ "$TOKEN" == "null" ]; then
        echo "❌ Failed to get token"
        return
    fi
    
    # Query with proper encoding
    QUERY="SELECT * WHERE { ?s ?p ?o . FILTER(CONTAINS(STR(?s), \"$STUDY\")) } LIMIT 5"
    
    HTTP_CODE=$(curl -s -w "%{http_code}" -o /dev/null -X POST "http://localhost:4000/sparql" \
      -H "Authorization: Bearer ${TOKEN}" \
      -H "Content-Type: application/x-www-form-urlencoded" \
      --data-urlencode "query=${QUERY}")
    
    if [ "$HTTP_CODE" = "200" ]; then
        if [ "$EXPECTED" = "GRANT" ]; then
            echo "✅ PASS - Access GRANTED (HTTP 200)"
        else
            echo "❌ FAIL - Access granted but should be denied!"
        fi
    elif [ "$HTTP_CODE" = "403" ]; then
        if [ "$EXPECTED" = "DENY" ]; then
            echo "✅ PASS - Access DENIED (HTTP 403)"
        else
            echo "❌ FAIL - Access denied but should be granted!"
        fi
    else
        echo "⚠️  Unexpected HTTP $HTTP_CODE"
    fi
}

# Test Suite based on Hospital 1 RBAC policies
echo ""
echo "User Roles:"
echo "  - bob: study_A_researcher"
echo "  - carol: study_B_researcher"
echo "  - grace: senior_researcher (all studies)"
echo "  - eve: guest (no access)"
echo ""

# Bob tests (study_A_researcher only)
test_access "bob" "bob" "study_A" "GRANT"
test_access "bob" "bob" "study_B" "DENY"

# Carol tests (study_B_researcher only)  
test_access "carol" "carol" "study_A" "DENY"
test_access "carol" "carol" "study_B" "GRANT"

# Grace tests (senior_researcher - all access)
test_access "grace" "grace" "study_A" "GRANT"
test_access "grace" "grace" "study_B" "GRANT"

# Eve tests (guest - no access)
test_access "eve" "eve" "study_A" "DENY"
test_access "eve" "eve" "study_B" "DENY"

echo ""
echo "=========================================="
echo "         TEST SUITE COMPLETE"
echo "=========================================="
