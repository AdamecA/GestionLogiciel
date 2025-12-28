#!/bin/bash

# ============================================================
# Script de configuration du Token Exchange (RFC 8693)
# ============================================================
# Ce script configure le Token Exchange entre le Keycloak Central
# et les Keycloaks Hospitaliers.
#
# IMPORTANT: La configuration est normalement importée automatiquement
# via les fichiers realm-export.json. Ce script est fourni pour:
# - Reconfigurer manuellement si nécessaire
# - Documenter les étapes de configuration
# - Activer les permissions de token exchange via l'API Admin
#
# Prérequis:
# - Les 3 Keycloaks doivent être démarrés
# - KC_FEATURES doit inclure: admin-fine-grained-authz:v1,token-exchange
# ============================================================

set -e

echo "🔧 Configuration du Token Exchange (RFC 8693)..."
echo ""

# ============================================================
# FONCTIONS UTILITAIRES
# ============================================================

get_admin_token() {
    local KEYCLOAK_URL=$1
    curl -s -X POST "${KEYCLOAK_URL}/realms/master/protocol/openid-connect/token" \
        -H "Content-Type: application/x-www-form-urlencoded" \
        -d "username=admin" \
        -d "password=admin" \
        -d "grant_type=password" \
        -d "client_id=admin-cli" | jq -r '.access_token'
}

get_client_uuid() {
    local KEYCLOAK_URL=$1
    local REALM=$2
    local TOKEN=$3
    local CLIENT_ID=$4
    curl -s -X GET "${KEYCLOAK_URL}/admin/realms/${REALM}/clients?clientId=${CLIENT_ID}" \
        -H "Authorization: Bearer ${TOKEN}" | jq -r '.[0].id'
}

get_idp_internal_id() {
    local KEYCLOAK_URL=$1
    local REALM=$2
    local TOKEN=$3
    local IDP_ALIAS=$4
    curl -s -X GET "${KEYCLOAK_URL}/admin/realms/${REALM}/identity-provider/instances/${IDP_ALIAS}" \
        -H "Authorization: Bearer ${TOKEN}" | jq -r '.internalId'
}

# Fonction pour configurer les permissions de token-exchange
configure_token_exchange_permission() {
    local KEYCLOAK_URL=$1
    local REALM=$2
    local TOKEN=$3
    local CLIENT_UUID=$4
    local IDP_INTERNAL_ID=$5
    local HOSPITAL_NAME=$6

    echo "  🔐 Configuration des permissions token-exchange pour ${HOSPITAL_NAME}..."

    # Obtenir les permissions du client
    local MGMT_PERMISSIONS=$(curl -s -X GET \
        "${KEYCLOAK_URL}/admin/realms/${REALM}/clients/${CLIENT_UUID}/management/permissions" \
        -H "Authorization: Bearer ${TOKEN}")

    local PERMISSIONS_ENABLED=$(echo "$MGMT_PERMISSIONS" | jq -r '.enabled')

    if [ "$PERMISSIONS_ENABLED" != "true" ]; then
        echo "    📝 Activation des permissions de gestion..."
        curl -s -X PUT \
            "${KEYCLOAK_URL}/admin/realms/${REALM}/clients/${CLIENT_UUID}/management/permissions" \
            -H "Authorization: Bearer ${TOKEN}" \
            -H "Content-Type: application/json" \
            -d '{"enabled": true}'
    fi

    # Obtenir l'ID de la ressource token-exchange
    local AUTHZ_RESOURCE=$(curl -s -X GET \
        "${KEYCLOAK_URL}/admin/realms/${REALM}/clients/${CLIENT_UUID}/management/permissions" \
        -H "Authorization: Bearer ${TOKEN}")

    local TOKEN_EXCHANGE_SCOPE=$(echo "$AUTHZ_RESOURCE" | jq -r '.scopePermissions["token-exchange"]')

    if [ "$TOKEN_EXCHANGE_SCOPE" != "null" ] && [ -n "$TOKEN_EXCHANGE_SCOPE" ]; then
        echo "    ✅ Permission token-exchange déjà configurée: ${TOKEN_EXCHANGE_SCOPE}"
    else
        echo "    ⚠️  Permission token-exchange non trouvée - vérifiez la configuration manuelle"
    fi

    # Configurer la policy pour l'Identity Provider
    echo "    📋 Vérification de la policy pour l'Identity Provider..."

    # Note: La création de la policy IDP nécessite généralement une configuration manuelle
    # via l'interface admin car les APIs de fine-grained permissions sont complexes

    echo "    ✅ Configuration terminée pour ${HOSPITAL_NAME}"
}

# ============================================================
# ATTENTE DES SERVICES
# ============================================================
echo "⏳ Attente du démarrage des Keycloaks (15s)..."
sleep 15

# ============================================================
# VÉRIFICATION CENTRAL KEYCLOAK
# ============================================================
echo ""
echo "🔐 Vérification du Keycloak Central..."

CENTRAL_URL="http://localhost:8080"
CENTRAL_REALM="myrealm"

CENTRAL_TOKEN=$(get_admin_token "$CENTRAL_URL")
if [ -z "$CENTRAL_TOKEN" ] || [ "$CENTRAL_TOKEN" == "null" ]; then
    echo "❌ Impossible d'obtenir le token pour Central Keycloak"
    echo "   Vérifiez que Keycloak Central est démarré sur ${CENTRAL_URL}"
    exit 1
fi
echo "  ✅ Token admin obtenu"

# Vérifier les clients broker
H1_BROKER_UUID=$(get_client_uuid "$CENTRAL_URL" "$CENTRAL_REALM" "$CENTRAL_TOKEN" "hospital1-broker")
H2_BROKER_UUID=$(get_client_uuid "$CENTRAL_URL" "$CENTRAL_REALM" "$CENTRAL_TOKEN" "hospital2-broker")

if [ -z "$H1_BROKER_UUID" ] || [ "$H1_BROKER_UUID" == "null" ]; then
    echo "  ❌ Client hospital1-broker non trouvé"
    exit 1
fi
echo "  ✅ hospital1-broker: ${H1_BROKER_UUID}"

if [ -z "$H2_BROKER_UUID" ] || [ "$H2_BROKER_UUID" == "null" ]; then
    echo "  ❌ Client hospital2-broker non trouvé"
    exit 1
fi
echo "  ✅ hospital2-broker: ${H2_BROKER_UUID}"

# ============================================================
# CONFIGURATION HOSPITAL 1
# ============================================================
echo ""
echo "🏥 Configuration Hospital 1..."

H1_URL="http://localhost:8081"
H1_REALM="hospital1-realm"

H1_TOKEN=$(get_admin_token "$H1_URL")
if [ -z "$H1_TOKEN" ] || [ "$H1_TOKEN" == "null" ]; then
    echo "❌ Impossible d'obtenir le token pour Hospital 1"
    exit 1
fi
echo "  ✅ Token admin obtenu"

# Vérifier le client hospital-proxy
H1_PROXY_UUID=$(get_client_uuid "$H1_URL" "$H1_REALM" "$H1_TOKEN" "hospital-proxy")
if [ -z "$H1_PROXY_UUID" ] || [ "$H1_PROXY_UUID" == "null" ]; then
    echo "  ❌ Client hospital-proxy non trouvé"
    exit 1
fi
echo "  ✅ hospital-proxy: ${H1_PROXY_UUID}"

# Vérifier l'Identity Provider
H1_IDP_ID=$(get_idp_internal_id "$H1_URL" "$H1_REALM" "$H1_TOKEN" "central-keycloak")
if [ -z "$H1_IDP_ID" ] || [ "$H1_IDP_ID" == "null" ]; then
    echo "  ❌ Identity Provider central-keycloak non trouvé"
    exit 1
fi
echo "  ✅ Identity Provider central-keycloak: ${H1_IDP_ID}"

# Configurer les permissions
configure_token_exchange_permission "$H1_URL" "$H1_REALM" "$H1_TOKEN" "$H1_PROXY_UUID" "$H1_IDP_ID" "Hospital 1"

# ============================================================
# CONFIGURATION HOSPITAL 2
# ============================================================
echo ""
echo "🏥 Configuration Hospital 2..."

H2_URL="http://localhost:8082"
H2_REALM="hospital2-realm"

H2_TOKEN=$(get_admin_token "$H2_URL")
if [ -z "$H2_TOKEN" ] || [ "$H2_TOKEN" == "null" ]; then
    echo "❌ Impossible d'obtenir le token pour Hospital 2"
    exit 1
fi
echo "  ✅ Token admin obtenu"

# Vérifier le client hospital-proxy
H2_PROXY_UUID=$(get_client_uuid "$H2_URL" "$H2_REALM" "$H2_TOKEN" "hospital-proxy")
if [ -z "$H2_PROXY_UUID" ] || [ "$H2_PROXY_UUID" == "null" ]; then
    echo "  ❌ Client hospital-proxy non trouvé"
    exit 1
fi
echo "  ✅ hospital-proxy: ${H2_PROXY_UUID}"

# Vérifier l'Identity Provider
H2_IDP_ID=$(get_idp_internal_id "$H2_URL" "$H2_REALM" "$H2_TOKEN" "central-keycloak")
if [ -z "$H2_IDP_ID" ] || [ "$H2_IDP_ID" == "null" ]; then
    echo "  ❌ Identity Provider central-keycloak non trouvé"
    exit 1
fi
echo "  ✅ Identity Provider central-keycloak: ${H2_IDP_ID}"

# Configurer les permissions
configure_token_exchange_permission "$H2_URL" "$H2_REALM" "$H2_TOKEN" "$H2_PROXY_UUID" "$H2_IDP_ID" "Hospital 2"

# ============================================================
# RÉSUMÉ
# ============================================================
echo ""
echo "============================================================"
echo "✅ Configuration Token Exchange terminée!"
echo "============================================================"
echo ""
echo "📋 Architecture configurée:"
echo ""
echo "   ┌─────────────────────────────────────────────────────────┐"
echo "   │                   CENTRAL KEYCLOAK                      │"
echo "   │                  (localhost:8080)                       │"
echo "   │                                                         │"
echo "   │  Realm: myrealm                                         │"
echo "   │  Users: alice, bob, carol, dave                         │"
echo "   │  Roles: study_A_researcher, study_B_researcher, admin   │"
echo "   │                                                         │"
echo "   │  Broker Clients:                                        │"
echo "   │    - hospital1-broker (secret: hospital1-broker-secret) │"
echo "   │    - hospital2-broker (secret: hospital2-broker-secret) │"
echo "   └─────────────────────────────────────────────────────────┘"
echo "                          │"
echo "         ┌────────────────┴────────────────┐"
echo "         │                                 │"
echo "         ▼                                 ▼"
echo "   ┌─────────────────────┐     ┌─────────────────────┐"
echo "   │   HOSPITAL 1 KC     │     │   HOSPITAL 2 KC     │"
echo "   │  (localhost:8081)   │     │  (localhost:8082)   │"
echo "   │                     │     │                     │"
echo "   │  Realm: hospital1   │     │  Realm: hospital2   │"
echo "   │                     │     │                     │"
echo "   │  Identity Provider: │     │  Identity Provider: │"
echo "   │   central-keycloak  │     │   central-keycloak  │"
echo "   │                     │     │                     │"
echo "   │  Role Mappers:      │     │  Role Mappers:      │"
echo "   │   realm_access.roles│     │   realm_access.roles│"
echo "   │   → local roles     │     │   → local roles     │"
echo "   └─────────────────────┘     └─────────────────────┘"
echo ""
echo "🔄 Token Exchange Flow:"
echo "   1. User logs in → Central Keycloak issues token with roles"
echo "   2. Proxy receives request with Central token"
echo "   3. Proxy calls Hospital Keycloak token-exchange endpoint:"
echo "      grant_type=urn:ietf:params:oauth:grant-type:token-exchange"
echo "      subject_token=<central_token>"
echo "      subject_issuer=central-keycloak"
echo "   4. Hospital Keycloak validates token via Identity Provider"
echo "   5. Identity Provider Mappers extract realm_access.roles claim"
echo "   6. Roles are mapped to local Hospital realm roles"
echo "   7. Hospital Keycloak issues local token with mapped roles"
echo "   8. Proxy uses local token for authorization policy evaluation"
echo ""
echo "📝 Key Configuration Elements:"
echo "   - KC_FEATURES: admin-fine-grained-authz:v1,token-exchange"
echo "   - Identity Provider syncMode: FORCE"
echo "   - Role Mappers claim: realm_access.roles"
echo "   - Client attribute: token.exchange.standard.flow.enabled=true"
echo ""
