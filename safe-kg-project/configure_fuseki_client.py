import requests

def get_admin_token():
    url = "http://localhost:8090/realms/master/protocol/openid-connect/token"
    data = {
        'grant_type': 'password',
        'client_id': 'admin-cli',
        'username': 'admin',
        'password': 'admin'
    }
    response = requests.post(url, data=data)
    return response.json()['access_token']

def configure_client(realm, client_id, admin_token):
    base_url = "http://localhost:8090"
    
    # Get client UUID
    url = f"{base_url}/admin/realms/{realm}/clients"
    headers = {'Authorization': f'Bearer {admin_token}'}
    response = requests.get(url, headers=headers, params={'clientId': client_id})
    clients = response.json()
    
    if not clients:
        print(f"❌ Client {client_id} not found in {realm}")
        return None
    
    client_uuid = clients[0]['id']
    
    # Update client settings
    url = f"{base_url}/admin/realms/{realm}/clients/{client_uuid}"
    headers['Content-Type'] = 'application/json'
    
    data = {
        'serviceAccountsEnabled': True,  # Enable for token introspection
        'publicClient': False  # Make confidential
    }
    
    response = requests.put(url, json=data, headers=headers)
    if response.status_code == 204:
        print(f"✅ Configured {client_id} in {realm}")
        
        # Get secret
        secret_url = f"{base_url}/admin/realms/{realm}/clients/{client_uuid}/client-secret"
        response = requests.get(secret_url, headers={'Authorization': f'Bearer {admin_token}'})
        if response.status_code == 200:
            secret = response.json()['value']
            print(f"🔑 Client Secret: {secret}")
            return secret
    return None

# Run it
admin_token = get_admin_token()
secret = configure_client('hospital-a', 'fuseki-client', admin_token)