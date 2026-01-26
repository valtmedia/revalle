#!/bin/bash

############################################################
# Quick Proxy Test Script
# Tests if your proxy is working
############################################################

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TERRAFORM_DIR="${SCRIPT_DIR}/terraform"

cd "$TERRAFORM_DIR"

# Get proxy info
PROXY_DNS=$(terraform output -raw load_balancer_dns 2>/dev/null || echo "")
PROXY_PORT=$(terraform output -raw proxy_port 2>/dev/null || echo "3128")

if [ -z "$PROXY_DNS" ]; then
    echo "ERROR: Could not get proxy endpoint. Is it deployed?"
    exit 1
fi

# Get credentials
read -p "Proxy username: " USERNAME
read -sp "Proxy password: " PASSWORD
echo

PROXY_URL="http://${USERNAME}:${PASSWORD}@${PROXY_DNS}:${PROXY_PORT}"

echo "Testing proxy connection..."
echo ""

# Test 1: Basic connectivity
echo "1. Testing basic connectivity..."
if curl -s --proxy "$PROXY_URL" --max-time 10 http://httpbin.org/get > /dev/null; then
    echo "   ✓ Connected successfully"
else
    echo "   ✗ Connection failed"
    exit 1
fi

# Test 2: Get IP
echo "2. Testing IP forwarding..."
YOUR_IP=$(curl -s --proxy "$PROXY_URL" https://api.ipify.org)
if [ -n "$YOUR_IP" ]; then
    echo "   ✓ Your IP through proxy: $YOUR_IP"
else
    echo "   ✗ Failed to get IP"
fi

# Test 3: HTTPS
echo "3. Testing HTTPS..."
if curl -s --proxy "$PROXY_URL" --max-time 10 https://httpbin.org/get > /dev/null; then
    echo "   ✓ HTTPS working"
else
    echo "   ✗ HTTPS failed"
fi

# Test 4: Speed test
echo "4. Testing speed..."
START=$(date +%s)
curl -s --proxy "$PROXY_URL" http://httpbin.org/bytes/1024 > /dev/null
END=$(date +%s)
DURATION=$((END - START))
echo "   ✓ Downloaded 1KB in ${DURATION}s"

echo ""
echo "All tests completed!"
