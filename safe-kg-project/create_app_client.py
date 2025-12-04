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

admin_token = get_admin_token()

# Create public client for your app
url = "http://localhost:8090/admin/realms/safe-kg/clients"
headers = {
    'Authorization': f'Bearer {admin_token}',
    'Content-Type': 'application/json'
}

data = {
    'clientId': 'my-app',
    'enabled': True,
    'publicClient': True,  # Public = no secret needed
    'directAccessGrantsEnabled': True,  # Allow password grant
    'redirectUris': ['*']
}

response = requests.post(url, json=data, headers=headers)
if response.status_code == 201:
    print("✅ Created my-app client")
elif response.status_code == 409:
    print("⚠️  Client already exists")
else:
    print(f"❌ Failed: {response.text}")