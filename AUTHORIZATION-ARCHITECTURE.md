# Authorization Architecture Documentation

## Table of Contents
1. [System Overview](#system-overview)
2. [Architecture Components](#architecture-components)
3. [Two-Layer Authorization Model](#two-layer-authorization-model)
4. [Data Flow](#data-flow)
5. [User Roles and Permissions](#user-roles-and-permissions)
6. [SPARQL Query Processing](#sparql-query-processing)
7. [Configuration Files](#configuration-files)
8. [Testing the System](#testing-the-system)
9. [Troubleshooting](#troubleshooting)

---

## System Overview

This project implements a **federated SPARQL query system** with **role-based access control (RBAC)** for medical research data. The system ensures that researchers can only access patient data from studies they are authorized to view.

### Key Features
- Federated querying across multiple hospital endpoints using FedUP
- Keycloak-based authentication and authorization (UMA protocol)
- Study-level access control
- Automatic SPARQL query rewriting to enforce security
- Prevention of unauthorized study access attempts

### Technologies
- **FedUP**: Federated SPARQL query engine
- **Keycloak**: Identity and access management (IAM)
- **Apache Jena Fuseki**: RDF triple store
- **Node.js Proxy**: Custom authorization layer

---

## Architecture Components

```
┌─────────────┐
│   Client    │
│  (Browser)  │
└──────┬──────┘
       │ JWT Token (Central Keycloak)
       ▼
┌─────────────────────────────┐
│      FedUP Server           │
│   (Port 3330)               │
│   - Federated Query Engine  │
│   - Breaks queries into     │
│     sub-queries per endpoint│
└──────┬──────────────────────┘
       │ SPARQL Sub-queries
       ▼
┌──────────────────────────────┐
│   Forward Proxy              │
│   (Port 8888)                │
│   - Routes to hospitals      │
└──────┬───────────────────────┘
       │
       ├────────────────┬────────────────┐
       ▼                ▼                ▼
┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│ Hospital 1  │  │ Hospital 2  │  │ Hospital N  │
│  Proxy      │  │  Proxy      │  │  Proxy      │
│ (Port 4000) │  │ (Port 4001) │  │ (Port 400N) │
└──────┬──────┘  └──────┬──────┘  └──────┬──────┘
       │                │                │
       │ Token Exchange │                │
       ▼                ▼                ▼
┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│ Keycloak H1 │  │ Keycloak H2 │  │ Keycloak HN │
│ (Port 8081) │  │ (Port 8082) │  │ (Port 808N) │
└─────────────┘  └─────────────┘  └─────────────┘
       │                │                │
       │ Authorized?    │                │
       ▼                ▼                ▼
┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│  Fuseki H1  │  │  Fuseki H2  │  │  Fuseki HN  │
│ (Port 3030) │  │ (Port 3031) │  │ (Port 303N) │
└─────────────┘  └─────────────┘  └─────────────┘
```

---

## Two-Layer Authorization Model

### Layer 1: Keycloak Authorization Services (UMA)

Keycloak provides **resource-based authorization** using the User-Managed Access (UMA) protocol.

#### Resources Defined
| Resource Name | Type | Description |
|--------------|------|-------------|
| `study_A` | `urn:hospital-proxy:resources:study` | Access to Study A data |
| `study_B` | `urn:hospital-proxy:resources:study` | Access to Study B data |
| `patient_data` | `urn:hospital-proxy:resources:data` | General patient data access |

#### Scopes
- `read`: Query/retrieve data
- `write`: Modify data (not currently used)

#### Policies
| Policy Name | Type | Condition |
|------------|------|-----------|
| Study A Researcher Policy | Role-based | User has `study_A_researcher` role |
| Study B Researcher Policy | Role-based | User has `study_B_researcher` role |
| Admin Policy | Role-based | User has `admin` role |

#### Permissions
Permissions link **policies** to **resources**:

| Permission Name | Resource | Policies Applied | Scopes |
|----------------|----------|------------------|--------|
| Study A Read Permission | `study_A` | Study A Researcher Policy, Admin Policy | `read` |
| Study B Read Permission | `study_B` | Study B Researcher Policy, Admin Policy | `read` |
| Patient Data Read Permission | `patient_data` | All researcher policies, Admin Policy | `read` |

**Note**: Permissions cannot be exported/imported via JSON and must be created using the script:
```bash
./scripts/configure-keycloak-authz.sh
```

### Layer 2: Custom SPARQL Query Filtering

The hospital proxy implements additional security measures:

1. **Study Permission Checking**: Queries Keycloak to determine which studies the user can access
2. **Study Filter Detection**: Detects if user explicitly requests unauthorized studies and blocks the query
3. **SPARQL Query Rewriting**: Automatically injects study filters into general patient queries
4. **Patient-Study Validation**: Checks Fuseki data to verify patient-study relationships

---

## Data Flow

### Step-by-Step Query Processing

#### 1. Client Sends Query
```javascript
// User authenticates with Central Keycloak
// Receives JWT token
// Submits SPARQL query to FedUP
```

#### 2. FedUP Breaks Query into Sub-queries
FedUP analyzes the query and creates sub-queries for each hospital endpoint based on summaries:
```sparql
# Original Query
SELECT ?patient ?age WHERE {
  ?patient a ex:Patient .
  ?patient ex:hasAge ?age .
}

# FedUP creates sub-queries:
# - Sub-query 1 → http://proxy1:4000/sparql
# - Sub-query 2 → http://proxy2:4001/sparql
```

#### 3. Forward Proxy Routes to Hospital
The forward proxy routes each sub-query to the appropriate hospital proxy.

#### 4. Hospital Proxy Authorization Process

**File**: [Proxy/proxy.js](Proxy/proxy.js#L250-L600)

##### Step 4.1: JWT Token Validation
```javascript
// Verify JWT from Central Keycloak (lines 250-280)
const decoded = jwt.verify(token, publicKey, { algorithms: ['RS256'] });
console.log(`✅ [HOSPITAL] Token valid for user: ${decoded.preferred_username}`);
```

##### Step 4.2: Token Exchange
```javascript
// Exchange Central token for Local Hospital token (lines 282-300)
const localToken = await exchangeToken(token);
```

##### Step 4.3: Determine Allowed Studies via Keycloak
```javascript
// Check permissions for each study (lines 322-351)
const allowedStudies = [];

// Check study_A
const studyAPermission = await checkPermission(localToken, 'study_A', 'read');
if (studyAPermission.granted) {
    allowedStudies.push('res:study_A');
}

// Check study_B
const studyBPermission = await checkPermission(localToken, 'study_B', 'read');
if (studyBPermission.granted) {
    allowedStudies.push('res:study_B');
}

if (allowedStudies.length === 0) {
    return res.status(403).json({ error: "Access Denied" });
}
```

##### Step 4.4: Query Analysis and Filtering

**Case 1: Specific Patient Query** (lines 356-428)
```javascript
// FedUP queries specific patient URI
// Pattern: <http://example.org/resource/patient1>

// Check which studies the patient belongs to
const studyCheckQuery = `SELECT ?study WHERE { res:${patientId} ex:partOf ?study }`;
const patientStudies = await queryFuseki(studyCheckQuery);

// Verify user has access to at least one of the patient's studies
if (!patientStudies.some(ps => allowedStudies.includes(ps))) {
    // Return empty result (don't reveal patient exists)
    return res.status(200).json({ results: { bindings: [] } });
}
```

**Case 2: General Patient Query with Explicit Study Filter** (lines 433-469)
```javascript
// User explicitly queries: ?patient ex:partOf res:study_A

// Extract requested studies from query
const requestedStudies = extractStudiesFromQuery(sparqlQuery);

// Block if user requests unauthorized studies
const unauthorizedStudies = requestedStudies.filter(s => !allowedStudies.includes(s));
if (unauthorizedStudies.length > 0) {
    return res.status(403).json({
        error: "Access Denied",
        message: `You do not have permission to access: ${unauthorizedStudies.join(', ')}`
    });
}
```

**Case 3: General Patient Query (No Study Filter)** (lines 471-541)
```javascript
// User queries: SELECT ?patient WHERE { ?patient a ex:Patient }

// Detect patient variable name
const patientVar = detectPatientVariable(sparqlQuery); // e.g., ?patient or ?p

// Inject study filter automatically
if (allowedStudies.length === 1) {
    filterClause = `${patientVar} ex:partOf ${allowedStudies[0]} .`;
} else {
    filterClause = `${patientVar} ex:partOf ?study . FILTER (?study IN (${allowedStudies.join(', ')}))`;
}

// Rewrite query
rewrittenQuery = injectFilter(sparqlQuery, filterClause);
```

##### Step 4.5: Verify Patient Data Permission
```javascript
// Final permission check (lines 544-554)
const permissionResult = await checkPermission(localToken, 'patient_data', 'read');
if (!permissionResult.granted) {
    return res.status(403).json({ error: "Access Denied" });
}
```

##### Step 4.6: Forward to Fuseki
```javascript
// Send rewritten query to Fuseki (lines 558-580)
const fusekiRes = await fetch(FUSEKI_URL, {
    method: "POST",
    body: new URLSearchParams({ query: rewrittenQuery })
});
```

#### 5. Fuseki Returns Results
Fuseki executes the rewritten query and returns results.

#### 6. Proxy Returns Results to FedUP
The hospital proxy forwards results back to FedUP.

#### 7. FedUP Merges Results
FedUP combines results from all hospital endpoints and returns to client.

---

## User Roles and Permissions

### User Accounts

| Username | Roles | Study Access | Patient Access |
|----------|-------|--------------|----------------|
| alice | `study_A_researcher` | Study A only | patient1, patient2, patient5 |
| bob | `study_B_researcher` | Study B only | patient3, patient4, patient5 |
| carol | `study_A_researcher`, `study_B_researcher` | Both studies | All 5 patients |
| dave | `admin` | All studies | All patients |

### Patient-Study Mapping

**Hospital 1 Data** ([fedup-image/h1.nq](fedup-image/h1.nq)):
```turtle
# Study A
<http://example.org/resource/study_A> a ex:Study .
<http://example.org/resource/patient1> ex:partOf res:study_A .
<http://example.org/resource/patient2> ex:partOf res:study_A .

# Graph context: <http://proxy1:4000/sparql>
```

**Hospital 2 Data** ([fedup-image/h2.nq](fedup-image/h2.nq)):
```turtle
# Study A and Study B
<http://example.org/resource/study_A> a ex:Study .
<http://example.org/resource/study_B> a ex:Study .

<http://example.org/resource/patient3> ex:partOf res:study_B .
<http://example.org/resource/patient4> ex:partOf res:study_B .
<http://example.org/resource/patient5> ex:partOf res:study_A, res:study_B .

# Graph context: <http://proxy2:4001/sparql>
```

### Expected Query Results

#### Alice (study_A_researcher)
```sparql
SELECT ?patient WHERE { ?patient a ex:Patient }
```
**Result**: patient1, patient2, patient5

#### Bob (study_B_researcher)
```sparql
SELECT ?patient WHERE { ?patient a ex:Patient }
```
**Result**: patient3, patient4, patient5

#### Carol (both roles)
```sparql
SELECT ?patient WHERE { ?patient a ex:Patient }
```
**Result**: All 5 patients

---

## SPARQL Query Processing

### Query Patterns Handled

#### Pattern 1: Full URI Format (from FedUP)
```sparql
SELECT ?p WHERE {
  ?p <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://example.org/schema#Patient> .
}
```

**Detection** (line 471-472):
```javascript
const hasPatientPattern = sparqlQuery.toLowerCase().includes('<http://example.org/schema#patient>');
```

**Rewritten Query**:
```sparql
SELECT ?p WHERE {
  ?p <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://example.org/schema#Patient> .
  ?p <http://example.org/schema#partOf> <http://example.org/resource/study_A> .
}
```

#### Pattern 2: Prefixed Format
```sparql
PREFIX ex: <http://example.org/schema#>
PREFIX res: <http://example.org/resource/>

SELECT ?patient WHERE {
  ?patient a ex:Patient .
}
```

**Rewritten Query**:
```sparql
PREFIX ex: <http://example.org/schema#>
PREFIX res: <http://example.org/resource/>

SELECT ?patient WHERE {
  ?patient a ex:Patient .
  ?patient ex:partOf res:study_A .
}
```

#### Pattern 3: Explicit Study Filter (Blocked if Unauthorized)
```sparql
SELECT ?patient WHERE {
  ?patient a ex:Patient .
  ?patient ex:partOf res:study_A .
}
```

**Bob attempts this query**: ❌ **403 Forbidden**
```json
{
  "error": "Access Denied",
  "message": "You do not have permission to access the following studies: study_A",
  "reason": "User bob only has access to: study_B"
}
```

#### Pattern 4: Specific Patient URI
```sparql
SELECT ?p ?o WHERE {
  <http://example.org/resource/patient1> ?p ?o .
}
```

**Processing**:
1. Extract patient ID: `patient1`
2. Query Fuseki: Which studies does patient1 belong to? → `study_A`
3. Check user access: Does bob have access to `study_A`? → No
4. Return empty result (don't reveal patient exists)

---

## Configuration Files

### Keycloak Realm Configuration

**Location**:
- [Data/config/hospital1Keycloak/realm-export.json](Data/config/hospital1Keycloak/realm-export.json)
- [Data/config/hospital2Keycloak/realm-export.json](Data/config/hospital2Keycloak/realm-export.json)

**Key Sections**:

#### Resources
```json
{
  "resources": [
    {
      "name": "study_A",
      "type": "urn:hospital-proxy:resources:study",
      "ownerManagedAccess": false,
      "displayName": "Study A Access",
      "scopes": [
        {"name": "read"},
        {"name": "write"}
      ]
    }
  ]
}
```

#### Policies
```json
{
  "policies": [
    {
      "name": "Study A Researcher Policy",
      "type": "role",
      "logic": "POSITIVE",
      "decisionStrategy": "UNANIMOUS",
      "config": {
        "roles": "[{\"id\":\"study_A_researcher\",\"required\":true}]"
      }
    }
  ]
}
```

#### Users with Roles
```json
{
  "users": [
    {
      "username": "alice",
      "enabled": true,
      "realmRoles": ["study_A_researcher"]
    },
    {
      "username": "bob",
      "enabled": true,
      "realmRoles": ["study_B_researcher"]
    },
    {
      "username": "carol",
      "enabled": true,
      "realmRoles": ["study_A_researcher", "study_B_researcher"]
    }
  ]
}
```

### Authorization Configuration Script

**Location**: [scripts/configure-keycloak-authz.sh](scripts/configure-keycloak-authz.sh)

This script creates **permissions** that link policies to resources. Permissions cannot be exported/imported via JSON.

**Run after starting Keycloak**:
```bash
cd scripts
./configure-keycloak-authz.sh
```

**What it does**:
1. Gets admin access token
2. Retrieves resource IDs for `study_A`, `study_B`, `patient_data`
3. Retrieves policy IDs for researcher and admin policies
4. Creates permissions linking policies to resources

### Docker Compose Configuration

**Hospital 1**: [HOPITAL/H1/docker-compose.yml](HOPITAL/H1/docker-compose.yml#L38-L54)

```yaml
hospital-proxy:
  ports:
    - "4000:4000"
  environment:
    - PORT=4000
    - PROXY_MODE=HOSPITAL
    # Central Keycloak (JWT validation)
    - PUBLIC_ISSUER=http://localhost:8080/realms/myrealm
    - JWKS_URI=http://keycloak-central:8080/realms/myrealm/protocol/openid-connect/certs
    - FUSEKI_URL=http://fuseki:3030/dataset/sparql
    # Local Keycloak (authorization)
    - LOCAL_KEYCLOAK_URL=http://keycloak-h1:8080
    - LOCAL_REALM=hospital1-realm
    - LOCAL_CLIENT_ID=hospital-proxy
    - LOCAL_CLIENT_SECRET=hospital1-secret
  volumes:
    - ../../Proxy/proxy.js:/app/proxy.js
```

### FedUP Configuration

**Location**: [fedup-image/Dockerfile](fedup-image/Dockerfile#L11-L15)

```dockerfile
CMD ["java", "-jar", "fedup-server.jar", \
    "--engine=FedX", \
    "--port=3330", \
    "--summaries=tdb2summary", \
    "--modify=(e) -> \"http://forward-proxy:8888/\"+e"]
```

The `--modify` flag prepends the forward proxy URL to all endpoint URLs.

---

## Testing the System

### Prerequisites
```bash
# Start all services
cd HOPITAL/H1
docker-compose up -d

cd ../H2
docker-compose up -d

cd ../../CENTRAL
docker-compose up -d

# Run authorization configuration
cd ../scripts
./configure-keycloak-authz.sh
```

### Test Cases

#### Test 1: Alice Queries General Patients
**Login as alice** (study_A_researcher)

**Query**:
```sparql
PREFIX ex: <http://example.org/schema#>
SELECT ?patient WHERE {
  ?patient a ex:Patient .
}
```

**Expected Result**: 3 patients (patient1, patient2, patient5)

**Verify**:
```bash
curl -X POST http://localhost:3330/sparql \
  -H "Authorization: Bearer <alice_token>" \
  -d "query=PREFIX ex: <http://example.org/schema#> SELECT ?patient WHERE { ?patient a ex:Patient }"
```

#### Test 2: Bob Attempts to Access Study A
**Login as bob** (study_B_researcher)

**Query**:
```sparql
PREFIX ex: <http://example.org/schema#>
PREFIX res: <http://example.org/resource/>
SELECT ?patient WHERE {
  ?patient a ex:Patient .
  ?patient ex:partOf res:study_A .
}
```

**Expected Result**: ❌ **403 Forbidden**
```json
{
  "error": "Access Denied",
  "message": "You do not have permission to access the following studies: study_A"
}
```

#### Test 3: Bob Queries General Patients
**Login as bob** (study_B_researcher)

**Query**:
```sparql
PREFIX ex: <http://example.org/schema#>
SELECT ?patient WHERE {
  ?patient a ex:Patient .
}
```

**Expected Result**: 3 patients (patient3, patient4, patient5)

#### Test 4: Carol Queries All Patients
**Login as carol** (study_A_researcher + study_B_researcher)

**Query**:
```sparql
PREFIX ex: <http://example.org/schema#>
SELECT ?patient WHERE {
  ?patient a ex:Patient .
}
```

**Expected Result**: All 5 patients

#### Test 5: Bob Attempts to Access Specific Patient from Study A
**Login as bob**

**Query**:
```sparql
PREFIX res: <http://example.org/resource/>
SELECT ?p ?o WHERE {
  res:patient1 ?p ?o .
}
```

**Expected Result**: Empty result (no error, but no data)
```json
{
  "head": {"vars": []},
  "results": {"bindings": []}
}
```

### Verification Script

Create [test-rbac-study-access.sh](test-rbac-study-access.sh):
```bash
#!/bin/bash

# Test RBAC Study Access

FEDUP_URL="http://localhost:3330/sparql"

echo "=========================================="
echo "Test 1: Alice (study_A only)"
echo "=========================================="
ALICE_TOKEN=$(./get-token.sh alice password123)
curl -s -X POST "$FEDUP_URL" \
  -H "Authorization: Bearer $ALICE_TOKEN" \
  -d "query=PREFIX ex: <http://example.org/schema#> SELECT (COUNT(?p) as ?count) WHERE { ?p a ex:Patient }" \
  | jq '.results.bindings[0].count.value'

echo "Expected: 3"

echo ""
echo "=========================================="
echo "Test 2: Bob accessing study_A (SHOULD FAIL)"
echo "=========================================="
BOB_TOKEN=$(./get-token.sh bob password123)
curl -s -X POST "$FEDUP_URL" \
  -H "Authorization: Bearer $BOB_TOKEN" \
  -d "query=PREFIX ex: <http://example.org/schema#> PREFIX res: <http://example.org/resource/> SELECT ?p WHERE { ?p a ex:Patient . ?p ex:partOf res:study_A }" \
  | jq '.error'

echo "Expected: Access Denied"

echo ""
echo "=========================================="
echo "Test 3: Bob (study_B only)"
echo "=========================================="
curl -s -X POST "$FEDUP_URL" \
  -H "Authorization: Bearer $BOB_TOKEN" \
  -d "query=PREFIX ex: <http://example.org/schema#> SELECT (COUNT(?p) as ?count) WHERE { ?p a ex:Patient }" \
  | jq '.results.bindings[0].count.value'

echo "Expected: 3"

echo ""
echo "=========================================="
echo "Test 4: Carol (both studies)"
echo "=========================================="
CAROL_TOKEN=$(./get-token.sh carol password123)
curl -s -X POST "$FEDUP_URL" \
  -H "Authorization: Bearer $CAROL_TOKEN" \
  -d "query=PREFIX ex: <http://example.org/schema#> SELECT (COUNT(?p) as ?count) WHERE { ?p a ex:Patient }" \
  | jq '.results.bindings[0].count.value'

echo "Expected: 5"
```

Make executable and run:
```bash
chmod +x test-rbac-study-access.sh
./test-rbac-study-access.sh
```

---

## Troubleshooting

### Issue 1: User Sees All Patients Instead of Filtered Results

**Symptoms**: Alice sees all 5 patients instead of just her 3 authorized patients.

**Diagnosis**:
1. Check FedUP logs: Is FedUP using full URIs or prefixes?
2. Check proxy logs: Is the query being rewritten?
3. Check pattern detection: Does it recognize the patient pattern?

**Solution**: Ensure pattern detection handles both formats (lines 471-472):
```javascript
const hasPatientPattern = sparqlQuery.toLowerCase().includes('ex:patient') ||
                          sparqlQuery.toLowerCase().includes('<http://example.org/schema#patient>');
```

### Issue 2: User Can Access Unauthorized Studies

**Symptoms**: Bob can query `ex:partOf res:study_A` and see patient2.

**Diagnosis**: Study filter detection not blocking unauthorized queries.

**Solution**: Implement study filter detection (lines 433-469) that extracts requested studies and blocks access.

### Issue 3: Query Rewriting Uses Wrong Variable

**Symptoms**: Filter uses `?p` but user query uses `?patient`, causing filter to have no effect.

**Diagnosis**: Hardcoded patient variable in filter.

**Solution**: Detect patient variable from query (lines 480-483):
```javascript
const patientVarMatch = sparqlQuery.match(/(\?\w+)\s+a\s+(?:ex:Patient|<http:\/\/example\.org\/schema#Patient>)/i);
if (patientVarMatch) {
    patientVar = patientVarMatch[1];
}
```

### Issue 4: Keycloak Authorization Always Denies

**Symptoms**: All users get 403 even with correct roles.

**Diagnosis**: Permissions not created (they can't be imported).

**Solution**: Run authorization configuration script:
```bash
./scripts/configure-keycloak-authz.sh
```

### Issue 5: Token Exchange Fails

**Symptoms**: `401 Unauthorized` or `Invalid token exchange`.

**Diagnosis**: Client secret mismatch or realm configuration issue.

**Solution**:
1. Verify client secret in Keycloak UI matches environment variable
2. Check `LOCAL_CLIENT_SECRET` in docker-compose.yml
3. Verify token exchange is enabled for the client

### Debug Logging

Enable detailed logging in [Proxy/proxy.js](Proxy/proxy.js):

```javascript
// Already present - check console output
console.log(`🔐 [HOSPITAL] Checking study permissions for ${decoded.preferred_username}`);
console.log(`🔍 [HOSPITAL] User allowed studies: ${allowedStudies.join(', ')}`);
console.log(`📝 [HOSPITAL] Original query: ${sparqlQuery}`);
console.log(`📝 [HOSPITAL] Rewritten query: ${rewrittenQuery}`);
```

View logs:
```bash
docker-compose logs -f hospital-proxy
```

---

## Summary

This authorization system implements a robust, multi-layered security model:

1. **Keycloak UMA** provides centralized, policy-based authorization
2. **Custom SPARQL filtering** enforces study-level access at the query level
3. **Query rewriting** automatically adds security constraints
4. **Study filter blocking** prevents unauthorized access attempts
5. **Patient-study validation** ensures data relationships are respected

The system ensures that:
- Researchers can only access patients from their authorized studies
- Unauthorized query attempts are blocked with clear error messages
- FedUP's federated queries are transparently secured
- No patient information is leaked through error messages

All authorization decisions flow through Keycloak, making the system centrally manageable and auditable.
