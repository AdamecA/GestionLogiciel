#!/bin/bash

H1_TOKEN=$(curl -s -X POST "http://localhost:8081/realms/master/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=admin" \
  -d "password=admin" \
  -d "grant_type=password" \
  -d "client_id=admin-cli" | jq -r '.access_token')

H1_CLIENT_UUID=$(curl -s -X GET "http://localhost:8081/admin/realms/hospital1-realm/clients?clientId=hospital-proxy" \
  -H "Authorization: Bearer ${H1_TOKEN}" | jq -r '.[0].id')

echo "=== All Policies ==="
curl -s -X GET "http://localhost:8081/admin/realms/hospital1-realm/clients/${H1_CLIENT_UUID}/authz/resource-server/policy" \
  -H "Authorization: Bearer ${H1_TOKEN}" | jq '.[] | {name: .name, id: .id, type: .type}'

echo ""
echo "=== Query by name ==="
curl -s -X GET "http://localhost:8081/admin/realms/hospital1-realm/clients/${H1_CLIENT_UUID}/authz/resource-server/policy?name=Study%20A%20Researcher%20Policy" \
  -H "Authorization: Bearer ${H1_TOKEN}" | jq '.'
