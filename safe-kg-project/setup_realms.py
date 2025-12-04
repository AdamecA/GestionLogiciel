import requests
import time
import json

class KeycloakSetup:
    def __init__(self, base_url='http://localhost:8090', admin_user='admin', admin_pass='admin'):
        self.base_url = base_url
        self.admin_user = admin_user
        self.admin_pass = admin_pass
        self.admin_token = None
    
    def get_admin_token(self):
        """Get admin access token"""
        url = f"{self.base_url}/realms/master/protocol/openid-connect/token"
        data = {
            'grant_type': 'password',
            'client_id': 'admin-cli',
            'username': self.admin_user,
            'password': self.admin_pass
        }
        response = requests.post(url, data=data)
        response.raise_for_status()
        self.admin_token = response.json()['access_token']
        return self.admin_token
    
    def create_realm(self, realm_name):
        """Create a new realm"""
        url = f"{self.base_url}/admin/realms"
        headers = {
            'Authorization': f'Bearer {self.admin_token}',
            'Content-Type': 'application/json'
        }
        data = {
            'realm': realm_name,
            'enabled': True,
            'displayName': realm_name.upper()
        }
        response = requests.post(url, json=data, headers=headers)
        if response.status_code == 201:
            print(f"✅ Created realm: {realm_name}")
        elif response.status_code == 409:
            print(f"⚠️  Realm {realm_name} already exists")
        else:
            print(f"❌ Failed to create realm: {response.text}")
    
    def create_role(self, realm_name, role_name, description=''):
        """Create a realm role"""
        url = f"{self.base_url}/admin/realms/{realm_name}/roles"
        headers = {
            'Authorization': f'Bearer {self.admin_token}',
            'Content-Type': 'application/json'
        }
        data = {
            'name': role_name,
            'description': description
        }
        response = requests.post(url, json=data, headers=headers)
        if response.status_code == 201:
            print(f"  ✅ Created role: {role_name}")
        elif response.status_code == 409:
            print(f"  ⚠️  Role {role_name} already exists")
    
    def create_user(self, realm_name, username, email, password, first_name='', last_name=''):
        """Create a user"""
        url = f"{self.base_url}/admin/realms/{realm_name}/users"
        headers = {
            'Authorization': f'Bearer {self.admin_token}',
            'Content-Type': 'application/json'
        }
        data = {
            'username': username,
            'email': email,
            'firstName': first_name,
            'lastName': last_name,
            'enabled': True,
            'emailVerified': True,
            'credentials': [{
                'type': 'password',
                'value': password,
                'temporary': False
            }]
        }
        response = requests.post(url, json=data, headers=headers)
        if response.status_code == 201:
            print(f"  ✅ Created user: {username}")
        elif response.status_code == 409:
            print(f"  ⚠️  User {username} already exists")
    
    def assign_role_to_user(self, realm_name, username, role_name):
        """Assign a role to a user"""
        # Get user ID
        url = f"{self.base_url}/admin/realms/{realm_name}/users"
        headers = {'Authorization': f'Bearer {self.admin_token}'}
        response = requests.get(url, headers=headers, params={'username': username})
        users = response.json()
        if not users:
            print(f"  ❌ User {username} not found")
            return
        user_id = users[0]['id']
        
        # Get role
        url = f"{self.base_url}/admin/realms/{realm_name}/roles/{role_name}"
        response = requests.get(url, headers=headers)
        if response.status_code != 200:
            print(f"  ❌ Role {role_name} not found")
            return
        role = response.json()
        
        # Assign role
        url = f"{self.base_url}/admin/realms/{realm_name}/users/{user_id}/role-mappings/realm"
        headers['Content-Type'] = 'application/json'
        response = requests.post(url, json=[role], headers=headers)
        if response.status_code == 204:
            print(f"  ✅ Assigned role {role_name} to {username}")

    def create_client(self, realm_name, client_id, redirect_uris):
        """Create a client"""
        url = f"{self.base_url}/admin/realms/{realm_name}/clients"
        headers = {
            'Authorization': f'Bearer {self.admin_token}',
            'Content-Type': 'application/json'
        }
        data = {
            'clientId': client_id,
            'enabled': True,
            'protocol': 'openid-connect',
            'publicClient': False,
            'standardFlowEnabled': True,
            'directAccessGrantsEnabled': True,
            'serviceAccountsEnabled': True,
            'redirectUris': redirect_uris,
            'webOrigins': ['+'],
            'clientAuthenticatorType': 'client-secret'
        }
        response = requests.post(url, json=data, headers=headers)
        if response.status_code == 201:
            print(f"  ✅ Created client: {client_id}")
        elif response.status_code == 409:
            print(f"  ⚠️  Client {client_id} already exists")

def main():
    print("=" * 70)
    print("SaFE-KG Keycloak Setup - Simplified Single Instance")
    print("=" * 70)
    
    # Wait for Keycloak to be ready
    print("\n⏳ Waiting for Keycloak to start...")
    time.sleep(15)
    
    kc = KeycloakSetup()
    
    try:
        kc.get_admin_token()
        print("✅ Connected to Keycloak\n")
    except Exception as e:
        print(f"❌ Failed to connect to Keycloak: {e}")
        print("Make sure Keycloak is running on http://localhost:8090")
        return
    
    # Create Central Realm (safe-kg)
    print("\n📋 Setting up Central Realm (safe-kg)...")
    kc.create_realm('safe-kg')
    kc.create_role('safe-kg', 'STUDY_A_RESEARCHER', 'Access to Study A patient data')
    kc.create_role('safe-kg', 'STUDY_B_RESEARCHER', 'Access to Study B patient data')
    kc.create_role('safe-kg', 'RADIOLOGY_VIEWER', 'Can view radiology images')
    
    kc.create_user('safe-kg', 'researcher1', 'researcher1@university.edu', 
                   'password123', 'Alice', 'Researcher')
    kc.assign_role_to_user('safe-kg', 'researcher1', 'STUDY_A_RESEARCHER')
    
    kc.create_user('safe-kg', 'researcher2', 'researcher2@university.edu',
                   'password123', 'Bob', 'Scientist')
    kc.assign_role_to_user('safe-kg', 'researcher2', 'STUDY_B_RESEARCHER')
    
    kc.create_client('safe-kg', 'fuseki-client', ['http://localhost:3030/*'])
    
    # Create Hospital A Realm (RBAC)
    print("\n📋 Setting up Hospital A Realm (RBAC)...")
    kc.create_realm('hospital-a')
    kc.create_role('hospital-a', 'HOSPITAL_STUDY_A_ACCESS', 'Hospital A Study A access')
    kc.create_role('hospital-a', 'RADIOLOGIST', 'Radiologist role')
    kc.create_role('hospital-a', 'RESEARCHER', 'Researcher role')
    
    kc.create_client('hospital-a', 'fuseki-client', ['http://localhost:3030/*'])
    
    # Create Hospital B Realm (ABAC)
    print("\n📋 Setting up Hospital B Realm (ABAC)...")
    kc.create_realm('hospital-b')
    kc.create_role('hospital-b', 'HOSPITAL_STUDY_B_ACCESS', 'Hospital B Study B access')
    kc.create_role('hospital-b', 'DATA_VIEWER', 'Can view data')
    
    kc.create_client('hospital-b', 'fuseki-client', ['http://localhost:3030/*'])
    
    print("\n" + "=" * 70)
    print("✅ Setup Complete!")
    print("=" * 70)
    print("\n📍 Access Keycloak:")
    print("   URL: http://localhost:8090")
    print("   Admin: admin / admin")
    print("\n📚 Realms created:")
    print("   • safe-kg (Central University)")
    print("   • hospital-a (Hospital A - RBAC)")
    print("   • hospital-b (Hospital B - ABAC)")
    print("\n👤 Test users:")
    print("   • researcher1 / password123 (has STUDY_A_RESEARCHER role)")
    print("   • researcher2 / password123 (has STUDY_B_RESEARCHER role)")
    print("\n🔗 Next steps:")
    print("   1. Configure Fuseki endpoints with Keycloak authentication")
    print("   2. Create federated SPARQL queries")
    print("   3. Build your demo application")
    print("=" * 70)

if __name__ == '__main__':
    main()