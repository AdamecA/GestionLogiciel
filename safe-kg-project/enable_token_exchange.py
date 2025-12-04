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

def get_client_uuid(realm, client_id, admin_token):
    url = f"http://localhost:8090/admin/realms/{realm}/clients"
    headers = {'Authorization': f'Bearer {admin_token}'}
    response = requests.get(url, headers=headers, params={'clientId': client_id})
    clients = response.json()
    return clients[0]['id'] if clients else None

def enable_token_exchange(admin_token):
    # Step 1: Make fuseki-client accept token exchange
    uuid_fuseki = get_client_uuid('hospital-a', 'fuseki-client', admin_token)
    
    # Enable token exchange on fuseki-client
    url = f"http://localhost:8090/admin/realms/hospital-a/clients/{uuid_fuseki}"
    headers = {
        'Authorization': f'Bearer {admin_token}',
        'Content-Type': 'application/json'
    }
    
    data = {
        'serviceAccountsEnabled': True,
        'authorizationServicesEnabled': True  # Enable fine-grained authorization
    }
    
    response = requests.put(url, json=data, headers=headers)
    if response.status_code == 204:
        print("✅ Enabled authorization services on fuseki-client")
    
    # Step 2: Create token-exchange permission
    # Get my-app client from safe-kg
    uuid_myapp_safekg = get_client_uuid('safe-kg', 'my-app', admin_token)
    
    print(f"✅ my-app UUID in safe-kg: {uuid_myapp_safekg}")
    print(f"✅ fuseki-client UUID in hospital-a: {uuid_fuseki}")
    print("\nNext: Configure token exchange permission in Keycloak Admin UI")

admin_token = get_admin_token()
enable_token_exchange(admin_token)