#!/bin/bash

ADMIN_TOKEN=$(curl -s -X POST "http://localhost:8080/realms/master/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=admin" \
  -d "password=admin" \
  -d "grant_type=password" \
  -d "client_id=admin-cli" | jq -r '.access_token')

echo "Clients in myrealm:"
curl -s -X GET "http://localhost:8080/admin/realms/myrealm/clients" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" | jq '.[] | {clientId: .clientId, publicClient: .publicClient, directAccessGrantsEnabled: .directAccessGrantsEnabled}'
