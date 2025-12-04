#!/bin/bash

# SaFE-KG Demo - Quick Start Script
# Run this before your demo tomorrow

set -e

echo "========================================="
echo "  SaFE-KG Demo - Starting Services"
echo "========================================="
echo ""

# Start Docker services
echo "1️⃣  Starting Keycloak and Fuseki..."
docker-compose up -d

# Wait for Keycloak
echo "2️⃣  Waiting for Keycloak to start (60 seconds)..."
sleep 60

# Check Keycloak health
echo "3️⃣  Checking Keycloak health..."
curl -s http://localhost:8090/health/ready > /dev/null && echo "   ✅ Keycloak ready" || echo "   ❌ Keycloak not ready"

# Check Fuseki health  
echo "4️⃣  Checking Fuseki health..."
curl -s http://localhost:3031/$/ping > /dev/null && echo "   ✅ Fuseki ready" || echo "   ❌ Fuseki not ready"

# Load data
echo "5️⃣  Loading data into Fuseki..."
curl -s -X POST http://localhost:3031/hospital-a/data \
  -H "Content-Type: text/turtle" \
  --data-binary @h1.ttl \
  -u admin:admin123 > /dev/null && echo "   ✅ Data loaded" || echo "   ⚠️  Data load failed - load manually"

echo ""
echo "========================================="
echo "  ✅ Infrastructure Ready!"
echo "========================================="
echo ""
echo "Next steps:"
echo "1. Start the proxy in a new terminal:"
echo "   python3 hospital_a_proxy.py"
echo ""
echo "2. Test with researcher1 (should work):"
echo "   ./test_researcher1.sh"
echo ""
echo "3. Test with researcher2 (should fail):"
echo "   ./test_researcher2.sh"
echo ""
echo "Service URLs:"
echo "  • Keycloak Admin: http://localhost:8090/admin"
echo "  • Fuseki UI: http://localhost:3031"
echo "  • Hospital A Proxy: http://localhost:4001"
echo ""
echo "========================================="
