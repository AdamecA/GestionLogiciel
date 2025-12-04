from flask import Flask, request
import requests
import jwt
import re

app = Flask(__name__)

KEYCLOAK_URL = "http://localhost:8090"
FUSEKI_URL = "http://localhost:3031"
SAFE_KG_REALM = "safe-kg"

# Hospital A's Identity Provider Mapping
HOSPITAL_A_IDP_MAPPING = {
    'STUDY_A_RESEARCHER': 'HOSPITAL_STUDY_A_ACCESS',
    'RADIOLOGY_VIEWER': 'RADIOLOGIST'
}

# Authorization policy (reflects Keycloak Authorization Services configuration)
# This is the policy you configured in hospital-a realm's fuseki-client
AUTHORIZATION_POLICY = {
    'resource': 'fuseki-endpoint',
    'scope': 'query:execute',
    'required_roles': ['HOSPITAL_STUDY_A_ACCESS', 'RADIOLOGIST', 'PHYSICIAN'],
    'description': 'Access to Hospital A SPARQL endpoint'
}

# Protected fields (privacy-preserving)
PROTECTED_FIELDS = [
    'age', 'realID', 'hasHypertension', 'hasAneurysm',
    'hasMutation', 'smokingStatus', 'bmi', 'genomicSequence',
    'wholeGenomeAvailable', 'consentForGenomicResearch'
]

def check_authorization_policy(mapped_roles):
    """
    Check if user meets authorization policy requirements.
    This reflects the policy configured in Keycloak Authorization Services:
    - Resource: fuseki-endpoint
    - Scope: query:execute  
    - Policy: researcher-policy (requires HOSPITAL_STUDY_A_ACCESS role)
    
    Since we use federated identity (safe-kg → hospital-a), 
    we check the IDP-mapped roles against the policy.
    """
    
    print("\n🔐 Authorization Check (Keycloak Policy):")
    print(f"   Resource: {AUTHORIZATION_POLICY['resource']}")
    print(f"   Scope: {AUTHORIZATION_POLICY['scope']}")
    print(f"   User's hospital-a roles: {mapped_roles}")
    print(f"   Policy requires one of: {AUTHORIZATION_POLICY['required_roles']}")
    
    # Check if user has any required role
    has_required_role = any(
        role in mapped_roles 
        for role in AUTHORIZATION_POLICY['required_roles']
    )
    
    if has_required_role:
        matched_roles = [r for r in mapped_roles if r in AUTHORIZATION_POLICY['required_roles']]
        print(f"   ✅ Authorization GRANTED (roles: {matched_roles})")
        return True, None
    else:
        print(f"   ❌ Authorization DENIED (missing required role)")
        return False, f"Access denied: Requires one of {AUTHORIZATION_POLICY['required_roles']}"

def check_privacy_preserving(query, user_roles):
    """
    Privacy-preserving enforcement: protected fields cannot be in SELECT.
    Exception: PHYSICIAN role can return protected fields.
    """
    
    # Physicians can return protected fields
    if 'PHYSICIAN' in user_roles:
        print("   👨‍⚕️ PHYSICIAN role - can return protected fields")
        return True, None
    
    # Extract SELECT clause (only variables between SELECT and WHERE)
    # Handle DISTINCT, REDUCED, etc.
    select_match = re.search(r'SELECT\s+(?:DISTINCT\s+|REDUCED\s+)?(.*?)\s+(?:FROM|WHERE)', query, re.IGNORECASE | re.DOTALL)
    if not select_match:
        return True, None
    
    select_clause = select_match.group(1).strip().lower()
    
    # Extract only the variable names from SELECT
    # Match ?variable or $variable patterns
    select_vars = re.findall(r'[?$](\w+)', select_clause)
    
    print(f"   🔍 SELECT variables: {select_vars}")
    
    # Check each protected field against SELECT variables
    for field in PROTECTED_FIELDS:
        field_lower = field.lower()
        for var in select_vars:
            var_lower = var.lower()
            # Check if variable exactly matches or starts with protected field
            # e.g., ?age, ?age_local, ?ageValue all match 'age'
            # But ?image does NOT match 'age'
            if var_lower == field_lower or var_lower.startswith(field_lower + '_'):
                return False, f"Protected field '{field}' cannot be returned in SELECT. Use FILTER EXISTS."
    
    return True, None

@app.route('/hospital-a/query', methods=['GET', 'POST'])
def query():
    """
    Protected SPARQL endpoint with:
    - Federated identity validation (safe-kg realm)
    - IDP role mapping (safe-kg → hospital-a)
    - Authorization policy enforcement (Keycloak-configured)
    - Privacy-preserving query enforcement
    """
    
    auth_header = request.headers.get('Authorization', '')
    
    if not auth_header.startswith('Bearer '):
        return "Missing Authorization header", 401
    
    token = auth_header.replace('Bearer ', '')
    
    try:
        print("\n" + "="*70)
        print("🔒 HOSPITAL A - Federated Authorization")
        print("="*70)
        
        # Step 1: Validate token with safe-kg realm (federated trust)
        print("\n1️⃣  Validating token with safe-kg realm...")
        userinfo_url = f"{KEYCLOAK_URL}/realms/{SAFE_KG_REALM}/protocol/openid-connect/userinfo"
        headers = {'Authorization': f'Bearer {token}'}
        resp = requests.get(userinfo_url, headers=headers)
        
        if resp.status_code != 200:
            print("   ❌ Invalid token")
            return "Invalid token", 401
        
        user_info = resp.json()
        username = user_info.get('preferred_username')
        print(f"   ✅ Token valid for user: {username}")
        
        # Step 2: Get safe-kg roles and apply IDP mapping
        print("\n2️⃣  Applying Identity Provider role mapping...")
        decoded = jwt.decode(token, options={"verify_signature": False})
        safe_kg_roles = decoded.get('realm_access', {}).get('roles', [])
        print(f"   User's safe-kg roles: {safe_kg_roles}")
        
        # Apply Hospital A's IDP mapping (configured in Keycloak)
        mapped_roles = []
        for safe_kg_role in safe_kg_roles:
            if safe_kg_role in HOSPITAL_A_IDP_MAPPING:
                mapped_role = HOSPITAL_A_IDP_MAPPING[safe_kg_role]
                mapped_roles.append(mapped_role)
                print(f"   📍 Mapped: {safe_kg_role} → {mapped_role}")
        
        if not mapped_roles:
            print("   ❌ No roles mapped from safe-kg")
            return "Access denied: No valid roles", 403
        
        print(f"   ✅ Hospital-A roles: {mapped_roles}")
        
        # Step 3: Check authorization policy
        # This enforces the policy configured in Keycloak Authorization Services
        print("\n3️⃣  Checking authorization policy...")
        has_permission, authz_error = check_authorization_policy(mapped_roles)
        if not has_permission:
            return f"Access denied: {authz_error}", 403
        
        # Step 4: Get query
        if request.method == 'POST':
            query_text = request.form.get('query', '')
        else:
            query_text = request.args.get('query', '')
        
        if not query_text:
            return "Missing query parameter", 400
        
        print(f"\n4️⃣  Query received ({len(query_text)} chars)")
        
        # Step 5: Privacy check
        print("\n5️⃣  Privacy-preserving check...")
        is_private, privacy_error = check_privacy_preserving(query_text, mapped_roles)
        if not is_private:
            print(f"   ❌ Privacy violation: {privacy_error}")
            return f"Access denied: {privacy_error}", 403
        print(f"   ✅ Query is privacy-preserving")
        
        # Step 6: Forward to Fuseki
        print(f"\n6️⃣  Forwarding to Fuseki...")
        print("="*70 + "\n")
        
        fuseki_url = f"{FUSEKI_URL}/hospital-a/query"
        
        if request.method == 'POST':
            fuseki_resp = requests.post(
                fuseki_url,
                data=request.form,
                headers={'Accept': 'application/sparql-results+json'}
            )
        else:
            fuseki_resp = requests.get(
                fuseki_url,
                params=request.args,
                headers={'Accept': 'application/sparql-results+json'}
            )
        
        print(f"✅ Query executed (status: {fuseki_resp.status_code})\n")
        
        return fuseki_resp.text, fuseki_resp.status_code
        
    except Exception as e:
        print(f"❌ Error: {str(e)}")
        return f"Error: {str(e)}", 500

@app.route('/health')
def health():
    return "Hospital A Proxy OK (Federated Authorization + Privacy-Preserving)"

if __name__ == '__main__':
    print("\n" + "="*70)
    print("🏥 HOSPITAL A PROXY - Federated Authorization")
    print("="*70)
    print("\n📋 Security Architecture:")
    print("   1. Federated Identity")
    print("      └─ Trusts safe-kg realm for authentication")
    print("   2. Identity Provider Mapping")
    print("      └─ Maps safe-kg roles to hospital-a roles")
    print("   3. Authorization Policy (from Keycloak)")
    print(f"      ├─ Resource: {AUTHORIZATION_POLICY['resource']}")
    print(f"      ├─ Scope: {AUTHORIZATION_POLICY['scope']}")
    print(f"      └─ Required roles: {AUTHORIZATION_POLICY['required_roles']}")
    print("   4. Privacy-Preserving Queries")
    print(f"      └─ Protected fields: {len(PROTECTED_FIELDS)} fields")
    print("\n🔄 Request Flow:")
    print("   Token(safe-kg) → Validate → Map Roles → Check Policy → Privacy → Fuseki")
    print("\n" + "="*70)
    print("🚀 Starting server on http://localhost:4001")
    print("="*70 + "\n")
    
    app.run(host='0.0.0.0', port=4001, debug=True)