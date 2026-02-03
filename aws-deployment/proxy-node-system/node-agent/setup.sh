#!/bin/bash

############################################################
# Proxy Node Agent Setup
# Sets up the node agent on a proxy instance
############################################################

set -e

echo "Setting up Proxy Node Agent..."

# Install dependencies
apt-get update -y
apt-get install -y curl jq net-tools

# Create agent directory
mkdir -p /opt/proxy-node-agent
cd /opt/proxy-node-agent

# Copy scripts
cp register.sh heartbeat.sh /opt/proxy-node-agent/
chmod +x /opt/proxy-node-agent/*.sh

# Create systemd service for heartbeat
cat > /etc/systemd/system/proxy-node-heartbeat.service <<EOF
[Unit]
Description=Proxy Node Heartbeat Service
After=network.target

[Service]
Type=oneshot
ExecStart=/opt/proxy-node-agent/heartbeat.sh
User=root

[Install]
WantedBy=multi-user.target
EOF

# Create timer for periodic heartbeat
cat > /etc/systemd/system/proxy-node-heartbeat.timer <<EOF
[Unit]
Description=Proxy Node Heartbeat Timer
Requires=proxy-node-heartbeat.service

[Timer]
OnBootSec=1min
OnUnitActiveSec=30s
Unit=proxy-node-heartbeat.service

[Install]
WantedBy=timers.target
EOF

# Enable and start timer
systemctl daemon-reload
systemctl enable proxy-node-heartbeat.timer
systemctl start proxy-node-heartbeat.timer

echo "✓ Proxy Node Agent setup complete!"
echo ""
echo "Next steps:"
echo "1. Set CONTROL_PLANE_URL environment variable"
echo "2. Run: /opt/proxy-node-agent/register.sh"
