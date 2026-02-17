#!/bin/bash
# ===========================================
# Node Agent - Registration Script
# Registers this proxy node with the control plane
# ===========================================

CONTROL_PLANE_URL="${CONTROL_PLANE_URL:-http://localhost:3000}"
NODE_NAME="${NODE_NAME:-$(hostname)}"
NODE_REGION="${NODE_REGION:-unknown}"
PROXY_PORT="${PROXY_PORT:-3128}"
MAX_RETRIES=10
RETRY_DELAY=5

# Get public IP
get_public_ip() {
    curl -sf --max-time 5 http://checkip.amazonaws.com 2>/dev/null \
        || curl -sf --max-time 5 http://ifconfig.me 2>/dev/null \
        || curl -sf --max-time 5 http://api.ipify.org 2>/dev/null \
        || echo "127.0.0.1"
}

# Get local IP
get_local_ip() {
    hostname -I 2>/dev/null | awk '{print $1}' || echo "127.0.0.1"
}

# Get system info
get_cpu_count() {
    nproc 2>/dev/null || echo "1"
}

get_total_memory() {
    free -m 2>/dev/null | awk '/^Mem:/{print $2}' || echo "1024"
}

get_disk_free() {
    df -m /var/spool/squid 2>/dev/null | tail -1 | awk '{print $4}' || echo "10240"
}

echo "=== Node Registration ==="
echo "Control Plane: $CONTROL_PLANE_URL"
echo "Node Name: $NODE_NAME"
echo "Region: $NODE_REGION"

PUBLIC_IP=$(get_public_ip)
LOCAL_IP=$(get_local_ip)
CPU_COUNT=$(get_cpu_count)
TOTAL_MEM=$(get_total_memory)
DISK_FREE=$(get_disk_free)

echo "Public IP: $PUBLIC_IP"
echo "Local IP: $LOCAL_IP"
echo "CPUs: $CPU_COUNT"
echo "Memory: ${TOTAL_MEM}MB"
echo "Disk Free: ${DISK_FREE}MB"

# Retry registration
for i in $(seq 1 $MAX_RETRIES); do
    echo "Registration attempt $i/$MAX_RETRIES..."
    
    RESPONSE=$(curl -sf --max-time 10 \
        -X POST "$CONTROL_PLANE_URL/api/nodes/register" \
        -H "Content-Type: application/json" \
        -d "{
            \"host\": \"$PUBLIC_IP\",
            \"localIp\": \"$LOCAL_IP\",
            \"port\": $PROXY_PORT,
            \"name\": \"$NODE_NAME\",
            \"region\": \"$NODE_REGION\",
            \"capabilities\": {
                \"ssl\": true,
                \"http2\": false,
                \"compression\": true,
                \"caching\": true
            },
            \"resources\": {
                \"cpuCores\": $CPU_COUNT,
                \"memoryMb\": $TOTAL_MEM,
                \"diskFreeMb\": $DISK_FREE
            },
            \"version\": \"1.0.0\"
        }" 2>/dev/null)
    
    if [ $? -eq 0 ] && echo "$RESPONSE" | jq -e '.success' >/dev/null 2>&1; then
        NODE_ID=$(echo "$RESPONSE" | jq -r '.node.id')
        echo "Registration successful! Node ID: $NODE_ID"
        
        # Save node ID for heartbeat
        echo "$NODE_ID" > /tmp/node_id
        echo "$RESPONSE" > /tmp/registration_response.json
        
        exit 0
    else
        echo "Registration failed (attempt $i). Response: $RESPONSE"
        sleep $RETRY_DELAY
    fi
done

echo "ERROR: Failed to register after $MAX_RETRIES attempts"
exit 1
