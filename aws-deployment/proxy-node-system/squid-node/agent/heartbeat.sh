#!/bin/bash
# ===========================================
# Node Agent - Heartbeat Script
# Sends periodic health updates to control plane
# ===========================================

CONTROL_PLANE_URL="${CONTROL_PLANE_URL:-http://localhost:3000}"
PROXY_PORT="${PROXY_PORT:-3128}"

# Read node ID from registration
NODE_ID_FILE="/tmp/node_id"
if [ ! -f "$NODE_ID_FILE" ]; then
    echo "Node not registered yet. Skipping heartbeat."
    exit 1
fi

NODE_ID=$(cat "$NODE_ID_FILE")

# ===========================================
# Collect System Metrics
# ===========================================

# CPU usage percentage
get_cpu_usage() {
    top -bn1 2>/dev/null | grep "Cpu(s)" | awk '{print $2 + $4}' || echo "0"
}

# Memory usage percentage
get_memory_usage() {
    free 2>/dev/null | awk '/Mem:/ {printf("%.1f", $3/$2 * 100)}' || echo "0"
}

# Disk usage percentage
get_disk_usage() {
    df /var/spool/squid 2>/dev/null | tail -1 | awk '{print $5}' | tr -d '%' || echo "0"
}

# Active connections to squid
get_active_connections() {
    netstat -tn 2>/dev/null | grep ":$PROXY_PORT " | grep ESTABLISHED | wc -l || echo "0"
}

# Squid process check
is_squid_running() {
    pgrep squid >/dev/null 2>&1 && echo "true" || echo "false"
}

# Squid cache stats
get_cache_hit_ratio() {
    squidclient mgr:info 2>/dev/null | grep "Request Hit Ratios" -A 1 | tail -1 | awk '{print $3}' || echo "0"
}

# Open file descriptors
get_open_fds() {
    ls /proc/$(pgrep -o squid 2>/dev/null || echo 1)/fd 2>/dev/null | wc -l || echo "0"
}

# Network throughput (bytes per second, approximate)
get_network_bytes() {
    local iface=$(ip route get 8.8.8.8 2>/dev/null | head -1 | awk '{print $5}')
    if [ -n "$iface" ] && [ -f "/sys/class/net/$iface/statistics/rx_bytes" ]; then
        local rx=$(cat "/sys/class/net/$iface/statistics/rx_bytes" 2>/dev/null || echo 0)
        local tx=$(cat "/sys/class/net/$iface/statistics/tx_bytes" 2>/dev/null || echo 0)
        echo "{\"rx\": $rx, \"tx\": $tx}"
    else
        echo "{\"rx\": 0, \"tx\": 0}"
    fi
}

# Uptime
get_uptime_seconds() {
    awk '{print int($1)}' /proc/uptime 2>/dev/null || echo "0"
}

# ===========================================
# Build and Send Heartbeat
# ===========================================

CPU_USAGE=$(get_cpu_usage)
MEM_USAGE=$(get_memory_usage)
DISK_USAGE=$(get_disk_usage)
ACTIVE_CONNS=$(get_active_connections)
SQUID_RUNNING=$(is_squid_running)
CACHE_HIT=$(get_cache_hit_ratio)
OPEN_FDS=$(get_open_fds)
NETWORK=$(get_network_bytes)
UPTIME=$(get_uptime_seconds)

# Calculate load score (0-100)
LOAD=$(echo "$CPU_USAGE $MEM_USAGE $ACTIVE_CONNS" | awk '{
    cpu_score = $1 * 0.4;
    mem_score = $2 * 0.3;
    conn_score = ($3 / 500) * 100 * 0.3;
    total = cpu_score + mem_score + conn_score;
    if (total > 100) total = 100;
    printf "%d", total
}')

# Determine health status
if [ "$SQUID_RUNNING" = "false" ]; then
    HEALTH="unhealthy"
elif [ "$LOAD" -gt 90 ]; then
    HEALTH="degraded"
elif [ "$CPU_USAGE" = "0" ] && [ "$MEM_USAGE" = "0" ]; then
    HEALTH="unknown"
else
    HEALTH="healthy"
fi

# Send heartbeat
RESPONSE=$(curl -sf --max-time 10 \
    -X POST "$CONTROL_PLANE_URL/api/nodes/$NODE_ID/heartbeat" \
    -H "Content-Type: application/json" \
    -d "{
        \"load\": $LOAD,
        \"health\": \"$HEALTH\",
        \"metrics\": {
            \"cpuUsage\": $CPU_USAGE,
            \"memoryUsage\": $MEM_USAGE,
            \"diskUsage\": $DISK_USAGE,
            \"activeConnections\": $ACTIVE_CONNS,
            \"squidRunning\": $SQUID_RUNNING,
            \"cacheHitRatio\": $CACHE_HIT,
            \"openFileDescriptors\": $OPEN_FDS,
            \"network\": $NETWORK,
            \"uptimeSeconds\": $UPTIME,
            \"timestamp\": \"$(date -u '+%Y-%m-%dT%H:%M:%SZ')\"
        }
    }" 2>/dev/null)

if [ $? -eq 0 ]; then
    # Silent success in normal operation
    :
else
    echo "Heartbeat failed for node $NODE_ID"
fi
