#!/bin/bash
set -e

echo "=== ProxyNodeSystem - Squid Node Startup ==="
echo "Timestamp: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"

# ===========================================
# Environment Variables
# ===========================================
CONTROL_PLANE_URL="${CONTROL_PLANE_URL:-http://localhost:3000}"
NODE_NAME="${NODE_NAME:-$(hostname)}"
NODE_REGION="${NODE_REGION:-unknown}"
PROXY_PORT="${PROXY_PORT:-3128}"
ADMIN_USER="${ADMIN_USER:-admin}"
ADMIN_PASS="${ADMIN_PASS:-admin123}"

# ===========================================
# Setup Authentication
# ===========================================
echo "Setting up proxy authentication..."
if [ ! -f /etc/squid/passwd ]; then
    touch /etc/squid/passwd
fi

# Add admin user
htpasswd -b /etc/squid/passwd "$ADMIN_USER" "$ADMIN_PASS" 2>/dev/null

# Add any extra users from environment
if [ -n "$PROXY_USERS" ]; then
    echo "$PROXY_USERS" | tr ',' '\n' | while read -r user_pass; do
        user=$(echo "$user_pass" | cut -d: -f1)
        pass=$(echo "$user_pass" | cut -d: -f2)
        if [ -n "$user" ] && [ -n "$pass" ]; then
            htpasswd -b /etc/squid/passwd "$user" "$pass" 2>/dev/null
            echo "  Added user: $user"
        fi
    done
fi

# ===========================================
# Setup Blacklist
# ===========================================
if [ ! -f /etc/squid/blacklist.acl ]; then
    touch /etc/squid/blacklist.acl
fi

# ===========================================
# Initialize Squid cache
# ===========================================
echo "Initializing Squid cache..."
squid -z -N 2>/dev/null || true

# Fix permissions
chown -R proxy:proxy /var/spool/squid /var/log/squid

# ===========================================
# Start Node Agent (background)
# ===========================================
echo "Starting node agent..."
export CONTROL_PLANE_URL NODE_NAME NODE_REGION PROXY_PORT

# Registration with control plane
/opt/proxy-agent/register.sh &

# Heartbeat daemon
(
    sleep 10  # Wait for squid to start
    while true; do
        /opt/proxy-agent/heartbeat.sh 2>/dev/null || true
        sleep 30
    done
) &

# Log forwarding daemon
(
    sleep 15
    while true; do
        /opt/proxy-agent/log-forwarder.sh 2>/dev/null || true
        sleep 60
    done
) &

# ===========================================
# Start Squid
# ===========================================
echo "Starting Squid proxy on port $PROXY_PORT..."
echo "Control Plane: $CONTROL_PLANE_URL"
echo "Node Name: $NODE_NAME"
echo "Region: $NODE_REGION"

# Validate config
squid -k parse 2>&1 || {
    echo "ERROR: Squid configuration is invalid!"
    exit 1
}

# Start squid in foreground
exec squid -NYC -d 1
