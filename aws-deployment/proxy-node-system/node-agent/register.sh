#!/bin/bash

############################################################
# Proxy Node Registration Script
# Registers this proxy node with the control plane
############################################################

set -e

CONTROL_PLANE_URL="${CONTROL_PLANE_URL:-http://localhost:3000}"
NODE_ID="${NODE_ID:-node-$(hostname)-$(date +%s)}"
NODE_NAME="${NODE_NAME:-$(hostname)}"
PROXY_HOST="${PROXY_HOST:-$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null || hostname -I | awk '{print $1}')}"
PROXY_PORT="${PROXY_PORT:-3128}"
REGION="${AWS_REGION:-us-east-1}"

echo "Registering proxy node with control plane..."
echo "Control Plane: $CONTROL_PLANE_URL"
echo "Node ID: $NODE_ID"
echo "Node Name: $NODE_NAME"
echo "Proxy Host: $PROXY_HOST"
echo "Proxy Port: $PROXY_PORT"

# Register node
RESPONSE=$(curl -s -X POST "$CONTROL_PLANE_URL/api/nodes/register" \
  -H "Content-Type: application/json" \
  -d "{
    \"id\": \"$NODE_ID\",
    \"name\": \"$NODE_NAME\",
    \"host\": \"$PROXY_HOST\",
    \"port\": $PROXY_PORT,
    \"region\": \"$REGION\",
    \"capacity\": 1000,
    \"metadata\": {
      \"instance_type\": \"$(curl -s http://169.254.169.254/latest/meta-data/instance-type 2>/dev/null || echo 'unknown')\",
      \"availability_zone\": \"$(curl -s http://169.254.169.254/latest/meta-data/placement/availability-zone 2>/dev/null || echo 'unknown')\"
    }
  }")

if echo "$RESPONSE" | grep -q '"success":true'; then
  echo "✓ Node registered successfully!"
  echo "$RESPONSE" | jq '.' 2>/dev/null || echo "$RESPONSE"
  
  # Save node ID for heartbeat script
  echo "$NODE_ID" > /tmp/proxy-node-id
  echo "$CONTROL_PLANE_URL" > /tmp/control-plane-url
  
  exit 0
else
  echo "✗ Registration failed!"
  echo "$RESPONSE"
  exit 1
fi
