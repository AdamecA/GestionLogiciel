#!/bin/bash

H2_TOKEN=$(curl -s -X POST "http://localhost:8082/realms/master/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=admin" \
  -d "password=admin" \
  -d "grant_type=password" \
  -d "client_id=admin-cli" | jq -r '.access_token')

H2_CLIENT_UUID=$(curl -s -X GET "http://localhost:8082/admin/realms/hospital2-realm/clients?clientId=hospital-proxy" \
  -H "Authorization: Bearer ${H2_TOKEN}" | jq -r '.[0].id')

echo "Client UUID: $H2_CLIENT_UUID"

# Simple JS code
JS_CODE='var context = $evaluation.getContext();
var identity = context.getIdentity();
var attributes = identity.getAttributes();
var clearance = attributes.getValue("clearance_level");
if (clearance && (clearance === "high" || clearance.contains("high"))) {
  $evaluation.grant();
}'

PAYLOAD=$(jq -n \
    --arg name "High Clearance Policy" \
    --arg desc "ABAC policy for high clearance level" \
    --arg code "$JS_CODE" \
    '{
        name: $name,
        description: $desc,
        type: "js",
        logic: "POSITIVE",
        decisionStrategy: "UNANIMOUS",
        config: {
            code: $code
        }
    }')

echo "Payload:"
echo "$PAYLOAD" | jq '.'

echo ""
echo "Creating policy..."
curl -s -X POST "http://localhost:8082/admin/realms/hospital2-realm/clients/${H2_CLIENT_UUID}/authz/resource-server/policy/js" \
  -H "Authorization: Bearer ${H2_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" | jq '.'
