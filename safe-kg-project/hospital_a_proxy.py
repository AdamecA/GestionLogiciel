from flask import Flask, request
import requests
import jwt

app = Flask(__name__)

KEYCLOAK_URL = "http://localhost:8090"
FUSEKI_URL = "http://localhost:3031"
SAFE_KG_REALM = "safe-kg"

# Hospital A's Identity Provider Mapping (what you configured in Keycloak!)
HOSPITAL_A_IDP_MAPPING = {
    'STUDY_A_RESEARCHER': 'HOSPITAL_STUDY_A_ACCESS',
    'RADIOLOGY_VIEWER': 'RADIOLOGIST'
}

# Hospital A's RBAC Policy (checks mapped roles)
HOSPITAL_A_POLICY = {
    'allowed_roles': ['HOSPITAL_STUDY_A_ACCESS', 'RADIOLOGIST']
}

@app.route('/hospital-a/query', methods=['GET', 'POST'])
def query():
    auth_header = request.headers.get('Authorization', '')
    
    if not auth_header.startswith('Bearer '):
        return "Missing Authorization header", 401
    
    token = auth_header.replace('Bearer ', '')
    
    try:
        # Step 1: Validate token with safe-kg
        userinfo_url = f"{KEYCLOAK_URL}/realms/{SAFE_KG_REALM}/protocol/openid-connect/userinfo"
        headers = {'Authorization': f'Bearer {token}'}
        resp = requests.get(userinfo_url, headers=headers)
        
        if resp.status_code != 200:
            return "Invalid token", 401
        
        user_info = resp.json()
        username = user_info.get('preferred_username')
        print(f"✅ Token validated with safe-kg for: {username}")
        
        # Step 2: Get safe-kg roles
        decoded = jwt.decode(token, options={"verify_signature": False})
        safe_kg_roles = decoded.get('realm_access', {}).get('roles', [])
        print(f"🔍 User's safe-kg roles: {safe_kg_roles}")
        
        # Step 3: Apply Hospital A's IDP mapping
        mapped_roles = []
        for safe_kg_role in safe_kg_roles:
            if safe_kg_role in HOSPITAL_A_IDP_MAPPING:
                mapped_role = HOSPITAL_A_IDP_MAPPING[safe_kg_role]
                mapped_roles.append(mapped_role)
                print(f"   📍 Mapped: {safe_kg_role} → {mapped_role}")
        
        print(f"🏥 Hospital-A mapped roles: {mapped_roles}")
        print(f"📋 Hospital-A requires one of: {HOSPITAL_A_POLICY['allowed_roles']}")
        
        # Step 4: Check Hospital A's policy
        has_required_role = any(
            role in mapped_roles 
            for role in HOSPITAL_A_POLICY['allowed_roles']
        )
        
        if not has_required_role:
            print(f"❌ Access denied - missing required hospital-a role")
            return f"Access denied: Requires one of {HOSPITAL_A_POLICY['allowed_roles']}", 403
        
        print(f"✅ RBAC check passed - forwarding to Fuseki")
        
        # Step 5: Forward to Fuseki
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
        
        return fuseki_resp.text, fuseki_resp.status_code
        
    except Exception as e:
        print(f"❌ Error: {str(e)}")
        return f"Error: {str(e)}", 500

@app.route('/health')
def health():
    return "Hospital A Proxy (RBAC with IDP mapping)"

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=4001, debug=True)