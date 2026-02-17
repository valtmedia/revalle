#!/bin/bash
# ===========================================
# Node Agent - Configuration Sync
# Periodically syncs configuration from control plane
# ===========================================

CONTROL_PLANE_URL="${CONTROL_PLANE_URL:-http://localhost:3000}"
SQUID_CONF="/etc/squid/squid.conf"
BLACKLIST_FILE="/etc/squid/blacklist.acl"
CONFIG_VERSION_FILE="/tmp/config_version"

NODE_ID_FILE="/tmp/node_id"
if [ ! -f "$NODE_ID_FILE" ]; then
    exit 0
fi
NODE_ID=$(cat "$NODE_ID_FILE")

# Get current config version
CURRENT_VERSION=""
if [ -f "$CONFIG_VERSION_FILE" ]; then
    CURRENT_VERSION=$(cat "$CONFIG_VERSION_FILE")
fi

# Check for config updates
RESPONSE=$(curl -sf --max-time 10 \
    "$CONTROL_PLANE_URL/api/config/node/$NODE_ID" \
    -H "Content-Type: application/json" 2>/dev/null)

if [ $? -ne 0 ]; then
    exit 0
fi

NEW_VERSION=$(echo "$RESPONSE" | jq -r '.version // empty')

# No update needed
if [ "$NEW_VERSION" = "$CURRENT_VERSION" ]; then
    exit 0
fi

echo "Configuration update detected: $CURRENT_VERSION -> $NEW_VERSION"

# Update blacklist
BLACKLIST=$(echo "$RESPONSE" | jq -r '.blacklist[]? // empty')
if [ -n "$BLACKLIST" ]; then
    echo "$BLACKLIST" > "$BLACKLIST_FILE"
    echo "Updated blacklist ($(echo "$BLACKLIST" | wc -l) entries)"
fi

# Update proxy users
USERS=$(echo "$RESPONSE" | jq -r '.users[]? // empty')
if [ -n "$USERS" ]; then
    > /etc/squid/passwd  # Clear existing
    echo "$USERS" | while read -r user_entry; do
        user=$(echo "$user_entry" | jq -r '.username')
        pass=$(echo "$user_entry" | jq -r '.password')
        if [ -n "$user" ] && [ -n "$pass" ]; then
            htpasswd -b /etc/squid/passwd "$user" "$pass" 2>/dev/null
        fi
    done
    echo "Updated proxy users"
fi

# Check if Squid needs reconfiguration
RECONFIGURE=$(echo "$RESPONSE" | jq -r '.reconfigure // false')
if [ "$RECONFIGURE" = "true" ]; then
    echo "Reconfiguring Squid..."
    squid -k reconfigure 2>/dev/null
    
    # Verify configuration is valid
    if squid -k parse 2>/dev/null; then
        echo "Squid reconfigured successfully"
    else
        echo "WARNING: Squid configuration may be invalid"
    fi
fi

# Save new version
echo "$NEW_VERSION" > "$CONFIG_VERSION_FILE"

# Report config update to control plane
curl -sf --max-time 10 \
    -X POST "$CONTROL_PLANE_URL/api/nodes/$NODE_ID/config-ack" \
    -H "Content-Type: application/json" \
    -d "{
        \"version\": \"$NEW_VERSION\",
        \"status\": \"applied\",
        \"timestamp\": \"$(date -u '+%Y-%m-%dT%H:%M:%SZ')\"
    }" 2>/dev/null
