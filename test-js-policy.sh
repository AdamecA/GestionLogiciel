#!/bin/bash

H2_TOKEN=$(curl -s -X POST "http://localhost:8082/realms/master/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=admin" \
  -d "password=admin" \
  -d "grant_type=password" \
  -d "client_id=admin-cli" | jq -r '.access_token')

H2_CLIENT_UUID=$(curl -s -X GET "http://localhost:8082/admin/realms/hospital2-realm/clients?clientId=hospital-proxy" \
  -H "Authorization: Bearer ${H2_TOKEN}" | jq -r '.[0].id')

echo "Token: ${H2_TOKEN:0:20}..."
echo "Client UUID: $H2_CLIENT_UUID"

# Test creating a JS policy
ALLOWED_STUDIES_JS='var context = $evaluation.getContext();
var identity = context.getIdentity();
var attributes = identity.getAttributes();
var allowedStudies = attributes.getValue("allowed_studies");
var resource = $evaluation.getPermission().getResource();
if (resource && resource.getName) {
  var resourceName = resource.getName();
  if (resourceName === "study_A" && allowedStudies && allowedStudies.contains("study_A")) {
    $evaluation.grant();
  } else if (resourceName === "study_B" && allowedStudies && allowedStudies.contains("study_B")) {
    $evaluation.grant();
  }
}'

echo ""
echo "Creating JS policy..."
curl -v -X POST "http://localhost:8082/admin/realms/hospital2-realm/clients/${H2_CLIENT_UUID}/authz/resource-server/policy/js" \
  -H "Authorization: Bearer ${H2_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"name\": \"Allowed Studies Policy\",
    \"description\": \"ABAC policy checking allowed_studies attribute\",
    \"type\": \"js\",
    \"logic\": \"POSITIVE\",
    \"decisionStrategy\": \"UNANIMOUS\",
    \"config\": {
        \"code\": $(echo -n "$ALLOWED_STUDIES_JS" | jq -Rs .)
    }
}"
