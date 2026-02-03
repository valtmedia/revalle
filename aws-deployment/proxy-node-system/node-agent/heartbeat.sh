#!/bin/bash

############################################################
# Proxy Node Heartbeat Script
# Sends periodic heartbeats to control plane
############################################################

NODE_ID=$(cat /tmp/proxy-node-id 2>/dev/null)
CONTROL_PLANE_URL=$(cat /tmp/control-plane-url 2>/dev/null || echo "http://localhost:3000")

if [ -z "$NODE_ID" ]; then
  echo "Node ID not found. Run register.sh first."
  exit 1
fi

# Get current load (simplified - count active connections)
CURRENT_LOAD=$(netstat -an | grep -c ESTABLISHED || echo 0)

# Check Squid health
if systemctl is-active --quiet squid 2>/dev/null || service squid status > /dev/null 2>&1; then
  HEALTH="healthy"
else
  HEALTH="unhealthy"
fi

# Get metrics
METRICS=$(cat <<EOF
{
  "load": $CURRENT_LOAD,
  "health": "$HEALTH",
  "metrics": {
    "connections": $CURRENT_LOAD,
    "uptime": $(awk '{print int($1)}' /proc/uptime),
    "memory_used": $(free -m | awk 'NR==2{printf "%.2f", $3*100/$2}'),
    "cpu_load": $(top -bn1 | grep "Cpu(s)" | sed "s/.*, *\([0-9.]*\)%* id.*/\1/" | awk '{print 100 - $1}')
  }
}
EOF
)

# Send heartbeat
curl -s -X POST "$CONTROL_PLANE_URL/api/nodes/$NODE_ID/heartbeat" \
  -H "Content-Type: application/json" \
  -d "$METRICS" > /dev/null

if [ $? -eq 0 ]; then
  echo "$(date): Heartbeat sent successfully (Load: $CURRENT_LOAD, Health: $HEALTH)"
else
  echo "$(date): Heartbeat failed!"
fi
