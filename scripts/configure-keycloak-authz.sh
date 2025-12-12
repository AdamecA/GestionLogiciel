#!/bin/bash

# Script pour configurer automatiquement les Authorization Services dans Keycloak
# Ce script crée les permissions qui ne peuvent pas être importées via JSON

set -e

echo "🔧 Configuration des Authorization Services Keycloak..."

# Fonction pour obtenir un token admin
get_admin_token() {
    local KEYCLOAK_URL=$1

    local TOKEN=$(curl -s -X POST "${KEYCLOAK_URL}/realms/master/protocol/openid-connect/token" \
        -H "Content-Type: application/x-www-form-urlencoded" \
        -d "username=admin" \
        -d "password=admin" \
        -d "grant_type=password" \
        -d "client_id=admin-cli" | jq -r '.access_token')

    echo "$TOKEN"
}

# Fonction pour obtenir l'UUID du client
get_client_uuid() {
    local KEYCLOAK_URL=$1
    local REALM=$2
    local TOKEN=$3
    local CLIENT_ID=$4

    local CLIENT_UUID=$(curl -s -X GET "${KEYCLOAK_URL}/admin/realms/${REALM}/clients?clientId=${CLIENT_ID}" \
        -H "Authorization: Bearer ${TOKEN}" | jq -r '.[0].id')

    echo "$CLIENT_UUID"
}

# Fonction pour obtenir l'ID d'une ressource par son nom
get_resource_id() {
    local KEYCLOAK_URL=$1
    local REALM=$2
    local CLIENT_UUID=$3
    local TOKEN=$4
    local RESOURCE_NAME=$5

    local RESOURCE_ID=$(curl -s -X GET "${KEYCLOAK_URL}/admin/realms/${REALM}/clients/${CLIENT_UUID}/authz/resource-server/resource?name=${RESOURCE_NAME}" \
        -H "Authorization: Bearer ${TOKEN}" | jq -r '.[0]._id')

    echo "$RESOURCE_ID"
}

# Fonction pour obtenir l'ID d'un scope par son nom
get_scope_id() {
    local KEYCLOAK_URL=$1
    local REALM=$2
    local CLIENT_UUID=$3
    local TOKEN=$4
    local SCOPE_NAME=$5

    local SCOPE_ID=$(curl -s -X GET "${KEYCLOAK_URL}/admin/realms/${REALM}/clients/${CLIENT_UUID}/authz/resource-server/scope?name=${SCOPE_NAME}" \
        -H "Authorization: Bearer ${TOKEN}" | jq -r '.[0].id')

    echo "$SCOPE_ID"
}

# Fonction pour obtenir l'ID d'une policy par son nom
get_policy_id() {
    local KEYCLOAK_URL=$1
    local REALM=$2
    local CLIENT_UUID=$3
    local TOKEN=$4
    local POLICY_NAME=$5

    # URL encode the policy name
    local ENCODED_NAME=$(echo -n "$POLICY_NAME" | jq -sRr @uri)

    local POLICY_ID=$(curl -s -X GET "${KEYCLOAK_URL}/admin/realms/${REALM}/clients/${CLIENT_UUID}/authz/resource-server/policy?name=${ENCODED_NAME}" \
        -H "Authorization: Bearer ${TOKEN}" | jq -r '.[0].id')

    echo "$POLICY_ID"
}

# Fonction pour créer une JavaScript policy (ABAC)
create_js_policy() {
    local KEYCLOAK_URL=$1
    local REALM=$2
    local CLIENT_UUID=$3
    local TOKEN=$4
    local POLICY_NAME=$5
    local POLICY_DESC=$6
    local JS_CODE=$7

    echo "  📜 Création de la policy JavaScript: $POLICY_NAME"

    # Build JSON payload using jq to properly escape everything
    # For JS policies, the code goes directly in the "code" field, not nested in "config"
    local PAYLOAD=$(jq -n \
        --arg name "$POLICY_NAME" \
        --arg desc "$POLICY_DESC" \
        --arg code "$JS_CODE" \
        '{
            name: $name,
            description: $desc,
            type: "js",
            logic: "POSITIVE",
            decisionStrategy: "UNANIMOUS",
            code: $code
        }')

    local RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${KEYCLOAK_URL}/admin/realms/${REALM}/clients/${CLIENT_UUID}/authz/resource-server/policy/js" \
        -H "Authorization: Bearer ${TOKEN}" \
        -H "Content-Type: application/json" \
        -d "$PAYLOAD")

    local HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
    local BODY=$(echo "$RESPONSE" | sed '$d')

    if [ "$HTTP_CODE" = "201" ]; then
        echo "    ✅ Policy créée: $POLICY_NAME"
        # Return the ID of the created policy
        echo "$BODY" | jq -r '.id'
        return 0
    elif [ "$HTTP_CODE" = "409" ]; then
        echo "    ⚠️  Policy déjà existante: $POLICY_NAME"
        # Get the existing policy ID
        get_policy_id "$KEYCLOAK_URL" "$REALM" "$CLIENT_UUID" "$TOKEN" "$POLICY_NAME"
        return 0
    else
        echo "    ❌ Erreur HTTP $HTTP_CODE pour: $POLICY_NAME"
        echo "$BODY"
        return 1
    fi
}

# Fonction pour créer une permission scope-based
create_scope_permission() {
    local KEYCLOAK_URL=$1
    local REALM=$2
    local CLIENT_UUID=$3
    local TOKEN=$4
    local PERMISSION_NAME=$5
    local RESOURCE_ID=$6
    local SCOPE_ID=$7
    shift 7
    local POLICY_IDS=("$@")

    echo "  📋 Création de la permission: $PERMISSION_NAME"

    # Construire le tableau JSON des policy IDs
    local POLICIES_JSON="["
    for i in "${!POLICY_IDS[@]}"; do
        if [ $i -gt 0 ]; then
            POLICIES_JSON+=","
        fi
        POLICIES_JSON+="\"${POLICY_IDS[$i]}\""
    done
    POLICIES_JSON+="]"

    local RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${KEYCLOAK_URL}/admin/realms/${REALM}/clients/${CLIENT_UUID}/authz/resource-server/permission/scope" \
        -H "Authorization: Bearer ${TOKEN}" \
        -H "Content-Type: application/json" \
        -d "{
            \"name\": \"${PERMISSION_NAME}\",
            \"description\": \"Auto-generated permission\",
            \"type\": \"scope\",
            \"logic\": \"POSITIVE\",
            \"decisionStrategy\": \"AFFIRMATIVE\",
            \"resources\": [\"${RESOURCE_ID}\"],
            \"scopes\": [\"${SCOPE_ID}\"],
            \"policies\": ${POLICIES_JSON}
        }")

    local HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
    local BODY=$(echo "$RESPONSE" | sed '$d')

    if [ "$HTTP_CODE" = "201" ]; then
        echo "    ✅ Permission créée: $PERMISSION_NAME"
        return 0
    elif [ "$HTTP_CODE" = "409" ]; then
        echo "    ⚠️  Permission déjà existante: $PERMISSION_NAME"
        return 0
    else
        echo "    ❌ Erreur HTTP $HTTP_CODE pour: $PERMISSION_NAME"
        echo "$BODY"
        return 1
    fi
}

# Attendre que les Keycloaks soient prêts
echo "⏳ Attente du démarrage des Keycloaks (30s)..."
sleep 30

# ============================================================
# HOSPITAL 1 - RBAC Configuration
# ============================================================
echo ""
echo "🏥 Configuration Hospital 1 (RBAC)..."

H1_URL="http://localhost:8081"
H1_REALM="hospital1-realm"
H1_CLIENT_ID="hospital-proxy"

# Obtenir le token admin
H1_TOKEN=$(get_admin_token "$H1_URL")

if [ -z "$H1_TOKEN" ] || [ "$H1_TOKEN" == "null" ]; then
    echo "❌ Impossible d'obtenir le token pour Hospital 1"
    exit 1
fi

echo "  ✅ Token admin obtenu pour H1"

# Obtenir l'UUID du client
H1_CLIENT_UUID=$(get_client_uuid "$H1_URL" "$H1_REALM" "$H1_TOKEN" "$H1_CLIENT_ID")

if [ -z "$H1_CLIENT_UUID" ] || [ "$H1_CLIENT_UUID" == "null" ]; then
    echo "❌ Client $H1_CLIENT_ID non trouvé dans Hospital 1"
    exit 1
fi

echo "  ✅ Client UUID: $H1_CLIENT_UUID"

# Récupérer les IDs des ressources
echo "  🔍 Récupération des IDs des ressources..."
STUDY_A_RES_ID=$(get_resource_id "$H1_URL" "$H1_REALM" "$H1_CLIENT_UUID" "$H1_TOKEN" "study_A")
STUDY_B_RES_ID=$(get_resource_id "$H1_URL" "$H1_REALM" "$H1_CLIENT_UUID" "$H1_TOKEN" "study_B")
PATIENT_DATA_RES_ID=$(get_resource_id "$H1_URL" "$H1_REALM" "$H1_CLIENT_UUID" "$H1_TOKEN" "patient_data")

echo "    • study_A: $STUDY_A_RES_ID"
echo "    • study_B: $STUDY_B_RES_ID"
echo "    • patient_data: $PATIENT_DATA_RES_ID"

# Récupérer les IDs des scopes
echo "  🔍 Récupération des IDs des scopes..."
READ_SCOPE_ID=$(get_scope_id "$H1_URL" "$H1_REALM" "$H1_CLIENT_UUID" "$H1_TOKEN" "read")

echo "    • read: $READ_SCOPE_ID"

# Récupérer les IDs des policies
echo "  🔍 Récupération des IDs des policies..."
STUDY_A_POLICY_ID=$(get_policy_id "$H1_URL" "$H1_REALM" "$H1_CLIENT_UUID" "$H1_TOKEN" "Study A Researcher Policy")
STUDY_B_POLICY_ID=$(get_policy_id "$H1_URL" "$H1_REALM" "$H1_CLIENT_UUID" "$H1_TOKEN" "Study B Researcher Policy")
SENIOR_POLICY_ID=$(get_policy_id "$H1_URL" "$H1_REALM" "$H1_CLIENT_UUID" "$H1_TOKEN" "Senior Researcher Policy")
ADMIN_POLICY_ID=$(get_policy_id "$H1_URL" "$H1_REALM" "$H1_CLIENT_UUID" "$H1_TOKEN" "Admin Policy")

echo "    • Study A Researcher Policy: $STUDY_A_POLICY_ID"
echo "    • Study B Researcher Policy: $STUDY_B_POLICY_ID"
echo "    • Senior Researcher Policy: $SENIOR_POLICY_ID"
echo "    • Admin Policy: $ADMIN_POLICY_ID"

# Créer les permissions
echo "  🔐 Création des permissions..."

create_scope_permission "$H1_URL" "$H1_REALM" "$H1_CLIENT_UUID" "$H1_TOKEN" \
    "Study A Read Permission" \
    "$STUDY_A_RES_ID" \
    "$READ_SCOPE_ID" \
    "$STUDY_A_POLICY_ID" "$SENIOR_POLICY_ID" "$ADMIN_POLICY_ID"

create_scope_permission "$H1_URL" "$H1_REALM" "$H1_CLIENT_UUID" "$H1_TOKEN" \
    "Study B Read Permission" \
    "$STUDY_B_RES_ID" \
    "$READ_SCOPE_ID" \
    "$STUDY_B_POLICY_ID" "$SENIOR_POLICY_ID" "$ADMIN_POLICY_ID"

create_scope_permission "$H1_URL" "$H1_REALM" "$H1_CLIENT_UUID" "$H1_TOKEN" \
    "Patient Data Read Permission" \
    "$PATIENT_DATA_RES_ID" \
    "$READ_SCOPE_ID" \
    "$STUDY_A_POLICY_ID" "$STUDY_B_POLICY_ID" "$SENIOR_POLICY_ID" "$ADMIN_POLICY_ID"

echo "  ✅ Hospital 1 configuré avec succès!"

# ============================================================
# HOSPITAL 2 - ABAC Configuration
# ============================================================
echo ""
echo "🏥 Configuration Hospital 2 (ABAC)..."

H2_URL="http://localhost:8082"
H2_REALM="hospital2-realm"
H2_CLIENT_ID="hospital-proxy"

# Obtenir le token admin
H2_TOKEN=$(get_admin_token "$H2_URL")

if [ -z "$H2_TOKEN" ] || [ "$H2_TOKEN" == "null" ]; then
    echo "❌ Impossible d'obtenir le token pour Hospital 2"
    exit 1
fi

echo "  ✅ Token admin obtenu pour H2"

# Obtenir l'UUID du client
H2_CLIENT_UUID=$(get_client_uuid "$H2_URL" "$H2_REALM" "$H2_TOKEN" "$H2_CLIENT_ID")

if [ -z "$H2_CLIENT_UUID" ] || [ "$H2_CLIENT_UUID" == "null" ]; then
    echo "❌ Client $H2_CLIENT_ID non trouvé dans Hospital 2"
    exit 1
fi

echo "  ✅ Client UUID: $H2_CLIENT_UUID"

# Récupérer les IDs des ressources
echo "  🔍 Récupération des IDs des ressources..."
H2_STUDY_A_RES_ID=$(get_resource_id "$H2_URL" "$H2_REALM" "$H2_CLIENT_UUID" "$H2_TOKEN" "study_A")
H2_STUDY_B_RES_ID=$(get_resource_id "$H2_URL" "$H2_REALM" "$H2_CLIENT_UUID" "$H2_TOKEN" "study_B")
H2_PATIENT_DATA_RES_ID=$(get_resource_id "$H2_URL" "$H2_REALM" "$H2_CLIENT_UUID" "$H2_TOKEN" "patient_data")

echo "    • study_A: $H2_STUDY_A_RES_ID"
echo "    • study_B: $H2_STUDY_B_RES_ID"
echo "    • patient_data: $H2_PATIENT_DATA_RES_ID"

# Récupérer les IDs des scopes
echo "  🔍 Récupération des IDs des scopes..."
H2_READ_SCOPE_ID=$(get_scope_id "$H2_URL" "$H2_REALM" "$H2_CLIENT_UUID" "$H2_TOKEN" "read")
H2_READ_FULL_SCOPE_ID=$(get_scope_id "$H2_URL" "$H2_REALM" "$H2_CLIENT_UUID" "$H2_TOKEN" "read_full")
H2_READ_ANON_SCOPE_ID=$(get_scope_id "$H2_URL" "$H2_REALM" "$H2_CLIENT_UUID" "$H2_TOKEN" "read_anonymized")

echo "    • read: $H2_READ_SCOPE_ID"
echo "    • read_full: $H2_READ_FULL_SCOPE_ID"
echo "    • read_anonymized: $H2_READ_ANON_SCOPE_ID"

# Créer les policies JavaScript (ABAC)
echo "  📜 Création des policies JavaScript (ABAC)..."

# Allowed Studies Policy
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

H2_ALLOWED_STUDIES_POLICY_ID=$(create_js_policy "$H2_URL" "$H2_REALM" "$H2_CLIENT_UUID" "$H2_TOKEN" \
    "Allowed Studies Policy" \
    "ABAC policy checking allowed_studies attribute" \
    "$ALLOWED_STUDIES_JS")

# High Clearance Policy
HIGH_CLEARANCE_JS='var context = $evaluation.getContext();
var identity = context.getIdentity();
var attributes = identity.getAttributes();
var clearance = attributes.getValue("clearance_level");
if (clearance && (clearance === "high" || clearance.contains("high"))) {
  $evaluation.grant();
}'

H2_HIGH_CLEARANCE_POLICY_ID=$(create_js_policy "$H2_URL" "$H2_REALM" "$H2_CLIENT_UUID" "$H2_TOKEN" \
    "High Clearance Policy" \
    "ABAC policy for high clearance level" \
    "$HIGH_CLEARANCE_JS")

# Medium Clearance Policy
MEDIUM_CLEARANCE_JS='var context = $evaluation.getContext();
var identity = context.getIdentity();
var attributes = identity.getAttributes();
var clearance = attributes.getValue("clearance_level");
if (clearance && (clearance === "medium" || clearance === "high" || clearance.contains("medium") || clearance.contains("high"))) {
  $evaluation.grant();
}'

H2_MEDIUM_CLEARANCE_POLICY_ID=$(create_js_policy "$H2_URL" "$H2_REALM" "$H2_CLIENT_UUID" "$H2_TOKEN" \
    "Medium Clearance Policy" \
    "ABAC policy for medium clearance level" \
    "$MEDIUM_CLEARANCE_JS")

# Get Admin Policy ID (already exists from JSON import)
echo "  🔍 Récupération de l'Admin Policy..."
H2_ADMIN_POLICY_ID=$(get_policy_id "$H2_URL" "$H2_REALM" "$H2_CLIENT_UUID" "$H2_TOKEN" "Admin Policy")

echo "    • Allowed Studies Policy: $H2_ALLOWED_STUDIES_POLICY_ID"
echo "    • High Clearance Policy: $H2_HIGH_CLEARANCE_POLICY_ID"
echo "    • Medium Clearance Policy: $H2_MEDIUM_CLEARANCE_POLICY_ID"
echo "    • Admin Policy: $H2_ADMIN_POLICY_ID"

# Créer les permissions
echo "  🔐 Création des permissions..."

create_scope_permission "$H2_URL" "$H2_REALM" "$H2_CLIENT_UUID" "$H2_TOKEN" \
    "Study A Read Permission" \
    "$H2_STUDY_A_RES_ID" \
    "$H2_READ_SCOPE_ID" \
    "$H2_ALLOWED_STUDIES_POLICY_ID" "$H2_ADMIN_POLICY_ID"

create_scope_permission "$H2_URL" "$H2_REALM" "$H2_CLIENT_UUID" "$H2_TOKEN" \
    "Study B Read Permission" \
    "$H2_STUDY_B_RES_ID" \
    "$H2_READ_SCOPE_ID" \
    "$H2_ALLOWED_STUDIES_POLICY_ID" "$H2_ADMIN_POLICY_ID"

create_scope_permission "$H2_URL" "$H2_REALM" "$H2_CLIENT_UUID" "$H2_TOKEN" \
    "Patient Full Data Permission" \
    "$H2_PATIENT_DATA_RES_ID" \
    "$H2_READ_FULL_SCOPE_ID" \
    "$H2_HIGH_CLEARANCE_POLICY_ID" "$H2_ADMIN_POLICY_ID"

create_scope_permission "$H2_URL" "$H2_REALM" "$H2_CLIENT_UUID" "$H2_TOKEN" \
    "Patient Anonymized Data Permission" \
    "$H2_PATIENT_DATA_RES_ID" \
    "$H2_READ_ANON_SCOPE_ID" \
    "$H2_MEDIUM_CLEARANCE_POLICY_ID" "$H2_HIGH_CLEARANCE_POLICY_ID" "$H2_ADMIN_POLICY_ID"

echo "  ✅ Hospital 2 configuré avec succès!"

echo ""
echo "✅ Configuration terminée! Les Authorization Services sont prêts."
echo ""
echo "🔍 Vérification:"
echo "   - Hospital 1: ${H1_URL}/admin/master/console/#/${H1_REALM}/clients/${H1_CLIENT_UUID}/authorization"
echo "   - Hospital 2: ${H2_URL}/admin/master/console/#/${H2_REALM}/clients/${H2_CLIENT_UUID}/authorization"
echo ""
echo "📋 Permissions créées:"
echo "   Hospital 1 (RBAC):"
echo "     • Study A Read Permission (study_A_researcher, senior_researcher, admin)"
echo "     • Study B Read Permission (study_B_researcher, senior_researcher, admin)"
echo "     • Patient Data Read Permission (all researchers)"
echo ""
echo "   Hospital 2 (ABAC):"
echo "     • Study A Read Permission (allowed_studies contains 'study_A')"
echo "     • Study B Read Permission (allowed_studies contains 'study_B')"
echo "     • Patient Full Data Permission (clearance_level = 'high')"
echo "     • Patient Anonymized Data Permission (clearance_level = 'medium' or 'high')"
