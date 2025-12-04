import requests
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
    
    def create_client_for_idp(self, realm_name, client_id, redirect_realm):
        """Create a client that will be used by another realm's Identity Provider"""
        url = f"{self.base_url}/admin/realms/{realm_name}/clients"
        headers = {
            'Authorization': f'Bearer {self.admin_token}',
            'Content-Type': 'application/json'
        }
        
        # Build redirect URIs for the target realm
        redirect_uris = [
            f"http://localhost:8090/realms/{redirect_realm}/broker/safe-kg-idp/endpoint",
            f"http://localhost:8090/realms/{redirect_realm}/*"
        ]
        
        data = {
            'clientId': client_id,
            'name': f'Identity Provider Client for {redirect_realm}',
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
            print(f"  ✅ Created client: {client_id} in {realm_name}")
            return self.get_client_secret(realm_name, client_id)
        elif response.status_code == 409:
            print(f"  ⚠️  Client {client_id} already exists")
            return self.get_client_secret(realm_name, client_id)
        else:
            print(f"  ❌ Failed: {response.text}")
            return None
    
    def get_client_secret(self, realm_name, client_id):
        """Get client secret"""
        url = f"{self.base_url}/admin/realms/{realm_name}/clients"
        headers = {'Authorization': f'Bearer {self.admin_token}'}
        response = requests.get(url, headers=headers, params={'clientId': client_id})
        clients = response.json()
        
        if not clients:
            return None
            
        client_uuid = clients[0]['id']
        
        url = f"{self.base_url}/admin/realms/{realm_name}/clients/{client_uuid}/client-secret"
        response = requests.get(url, headers=headers)
        if response.status_code == 200:
            return response.json()['value']
        return None
    
    def create_keycloak_oidc_identity_provider(self, target_realm, source_realm, client_secret):
        """Create a Keycloak OIDC identity provider (NOT generic OIDC)"""
        url = f"{self.base_url}/admin/realms/{target_realm}/identity-provider/instances"
        headers = {
            'Authorization': f'Bearer {self.admin_token}',
            'Content-Type': 'application/json'
        }
        
        data = {
            'alias': 'safe-kg-idp',
            'displayName': 'Login via Central SaFE-KG',
            'providerId': 'keycloak-oidc',  # ⭐ CHANGED: was 'oidc', now 'keycloak-oidc'
            'enabled': True,
            'trustEmail': True,
            'storeToken': True,
            'addReadTokenRoleOnCreate': False,
            'authenticateByDefault': False,
            'linkOnly': False,
            'firstBrokerLoginFlowAlias': 'first broker login',
            'config': {
                'authorizationUrl': f'{self.base_url}/realms/{source_realm}/protocol/openid-connect/auth',
                'tokenUrl': f'{self.base_url}/realms/{source_realm}/protocol/openid-connect/token',
                'logoutUrl': f'{self.base_url}/realms/{source_realm}/protocol/openid-connect/logout',
                'userInfoUrl': f'{self.base_url}/realms/{source_realm}/protocol/openid-connect/userinfo',
                'clientId': f'{target_realm}-idp-client',
                'clientSecret': client_secret,
                'defaultScope': 'openid profile email',
                'syncMode': 'FORCE',
                'clientAuthMethod': 'client_secret_post',
                'validateSignature': 'false'
            }
        }
        
        response = requests.post(url, json=data, headers=headers)
        if response.status_code == 201:
            print(f"  ✅ Created Keycloak OIDC Identity Provider in {target_realm}")
            return True
        elif response.status_code == 409:
            print(f"  ⚠️  Identity Provider already exists in {target_realm}")
            return True
        else:
            print(f"  ❌ Failed: {response.text}")
            return False
    
    def create_external_role_mapper(self, target_realm, idp_alias, mapper_name, source_role, target_role):
        """Create External Role to Role mapper (works with Keycloak OIDC provider)"""
        url = f"{self.base_url}/admin/realms/{target_realm}/identity-provider/instances/{idp_alias}/mappers"
        headers = {
            'Authorization': f'Bearer {self.admin_token}',
            'Content-Type': 'application/json'
        }
        
        data = {
            'name': mapper_name,
            'identityProviderAlias': idp_alias,
            'identityProviderMapper': 'keycloak-oidc-role-to-role-idp-mapper',  # ⭐ CHANGED: specific mapper type
            'config': {
                'syncMode': 'FORCE',
                'external.role': source_role,  # ⭐ CHANGED: was 'claim.value', now 'external.role'
                'role': target_role
            }
        }
        
        response = requests.post(url, json=data, headers=headers)
        if response.status_code == 201:
            print(f"    ✅ Mapped: {source_role} → {target_role}")
        else:
            print(f"    ❌ Failed: {response.text}")

def main():
    print("=" * 70)
    print("Setting up Cross-Realm Identity Federation (Keycloak OIDC)")
    print("=" * 70)
    
    kc = KeycloakSetup()
    kc.get_admin_token()
    print("✅ Connected to Keycloak\n")
    
    # Setup Hospital A
    print("📋 Setting up Hospital A Identity Provider...")
    print("   Creating client in safe-kg realm...")
    client_secret_a = kc.create_client_for_idp('safe-kg', 'hospital-a-idp-client', 'hospital-a')
    
    if client_secret_a:
        print(f"   🔑 Client Secret: {client_secret_a}\n")
        print("   Creating Keycloak OIDC Identity Provider...")
        if kc.create_keycloak_oidc_identity_provider('hospital-a', 'safe-kg', client_secret_a):
            print("   Creating External Role to Role mappers...")
            kc.create_external_role_mapper(
                'hospital-a', 
                'safe-kg-idp',
                'map-study-a-researcher',
                'STUDY_A_RESEARCHER',
                'HOSPITAL_STUDY_A_ACCESS'
            )
            kc.create_external_role_mapper(
                'hospital-a',
                'safe-kg-idp',
                'map-radiology-viewer',
                'RADIOLOGY_VIEWER',
                'RADIOLOGIST'
            )
    
    # Setup Hospital B
    print("\n📋 Setting up Hospital B Identity Provider...")
    print("   Creating client in safe-kg realm...")
    client_secret_b = kc.create_client_for_idp('safe-kg', 'hospital-b-idp-client', 'hospital-b')
    
    if client_secret_b:
        print(f"   🔑 Client Secret: {client_secret_b}\n")
        print("   Creating Keycloak OIDC Identity Provider...")
        if kc.create_keycloak_oidc_identity_provider('hospital-b', 'safe-kg', client_secret_b):
            print("   Creating External Role to Role mappers...")
            kc.create_external_role_mapper(
                'hospital-b',
                'safe-kg-idp',
                'map-study-b-researcher',
                'STUDY_B_RESEARCHER',
                'HOSPITAL_STUDY_B_ACCESS'
            )
            kc.create_external_role_mapper(
                'hospital-b',
                'safe-kg-idp',
                'map-radiology-viewer',
                'RADIOLOGY_VIEWER',
                'DATA_VIEWER'
            )
    
    print("\n" + "=" * 70)
    print("✅ Identity Federation Setup Complete!")
    print("=" * 70)
    print("\n🔗 What this means:")
    print("   • Uses 'Keycloak OIDC' provider type (not generic OIDC)")
    print("   • Enables 'External Role to Role' mappers")
    print("   • researcher1: STUDY_A_RESEARCHER → HOSPITAL_STUDY_A_ACCESS")
    print("   • researcher2: STUDY_B_RESEARCHER → HOSPITAL_STUDY_B_ACCESS")
    print("\n🧪 Test it:")
    print("   1. Go to: http://localhost:8090/realms/hospital-a/account")
    print("   2. Click 'Login via Central SaFE-KG'")
    print("   3. Login with: researcher1 / password123")
    print("   4. Check role mapping - should have HOSPITAL_STUDY_A_ACCESS!")
    print("=" * 70)

if __name__ == '__main__':
    main()