#!/bin/bash
set -e

# Log everything
exec > >(tee /var/log/user-data.log|logger -t user-data -s 2>/dev/console) 2>&1

echo "Starting user-data script at $(date)"

# Update system
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y

# Install dependencies
apt-get install -y wget curl apache2-utils squid squid-common || {
    echo "Failed to install packages, trying alternative method..."
    apt-get install -y wget curl apache2-utils
}

# Try to install Squid using the installer script
if ! command -v squid &> /dev/null; then
    echo "Squid not found, downloading installer..."
    wget -q --no-check-certificate -O /tmp/squid-install.sh \
      https://raw.githubusercontent.com/serverok/squid-proxy-installer/master/squid3-install.sh || {
        echo "Failed to download installer, installing Squid directly..."
        apt-get install -y squid squid-common
    }
    
    if [ -f /tmp/squid-install.sh ]; then
        chmod +x /tmp/squid-install.sh
        bash /tmp/squid-install.sh || {
            echo "Installer failed, installing Squid directly..."
            apt-get install -y squid squid-common
        }
    fi
fi

# Verify Squid is installed
if ! command -v squid &> /dev/null; then
    echo "ERROR: Squid installation failed!"
    exit 1
fi

# Configure Squid
PROXY_PORT="${proxy_port}"
ADMIN_USER="${admin_username}"
ADMIN_PASS="${admin_password}"

# Create admin user if not exists
if [ ! -f /etc/squid/passwd ]; then
    touch /etc/squid/passwd
fi

# Add admin user
htpasswd -b /etc/squid/passwd "$ADMIN_USER" "$ADMIN_PASS" || \
htpasswd -b -c /etc/squid/passwd "$ADMIN_USER" "$ADMIN_PASS"

# Find squid.conf location
SQUID_CONF="/etc/squid/squid.conf"
if [ ! -f "$SQUID_CONF" ]; then
    SQUID_CONF="/etc/squid3/squid.conf"
fi

if [ ! -f "$SQUID_CONF" ]; then
    echo "ERROR: squid.conf not found!"
    exit 1
fi

# Backup original config
cp "$SQUID_CONF" "${SQUID_CONF}.backup"

# Update squid.conf if port is different
if [ "$PROXY_PORT" != "3128" ]; then
    # Update or add http_port directive
    if grep -q "^http_port" "$SQUID_CONF"; then
        sed -i "s/^http_port.*/http_port $PROXY_PORT/" "$SQUID_CONF"
    else
        echo "http_port $PROXY_PORT" >> "$SQUID_CONF"
    fi
fi

# Ensure basic configuration exists
if ! grep -q "auth_param basic" "$SQUID_CONF"; then
    cat >> "$SQUID_CONF" <<EOF

# Basic authentication
auth_param basic program /usr/lib/squid/basic_ncsa_auth /etc/squid/passwd
auth_param basic children 5
auth_param basic realm Squid proxy-caching web server
auth_param basic credentialsttl 2 hours
acl password proxy_auth REQUIRED
http_access allow password
EOF
fi

# Configure firewall
if command -v ufw &> /dev/null; then
    ufw allow $PROXY_PORT/tcp
    ufw allow 22/tcp
elif command -v iptables &> /dev/null; then
    iptables -I INPUT -p tcp --dport $PROXY_PORT -j ACCEPT
    iptables-save > /etc/iptables/rules.v4 2>/dev/null || true
fi

# Restart Squid
systemctl restart squid || service squid restart
systemctl enable squid || systemctl enable squid3

# Install CloudWatch agent (optional)
if wget -q https://s3.amazonaws.com/amazoncloudwatch-agent/ubuntu/amd64/latest/amazon-cloudwatch-agent.deb -O /tmp/amazon-cloudwatch-agent.deb; then
    dpkg -i -E /tmp/amazon-cloudwatch-agent.deb || apt-get install -f -y
    
    # Create CloudWatch config directory
    mkdir -p /opt/aws/amazon-cloudwatch-agent/etc
    
    # Create CloudWatch config
    cat > /opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json <<EOF
{
  "logs": {
    "logs_collected": {
      "files": {
        "collect_list": [
          {
            "file_path": "/var/log/squid/access.log",
            "log_group_name": "/aws/ec2/squid-proxy/squid",
            "log_stream_name": "{instance_id}"
          },
          {
            "file_path": "/var/log/squid/cache.log",
            "log_group_name": "/aws/ec2/squid-proxy/squid",
            "log_stream_name": "{instance_id}-cache"
          }
        ]
      }
    }
  }
}
EOF

    # Start CloudWatch agent if installed
    if [ -f /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl ]; then
        /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
          -a fetch-config -m ec2 -c file:/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json -s || true
    fi
else
    echo "CloudWatch agent installation skipped (optional)"
fi

# Create a simple HTTP endpoint for health checks
cat > /usr/local/bin/proxy-health-check.sh <<'HEALTHEOF'
#!/bin/bash
# Check if Squid is running
if systemctl is-active --quiet squid 2>/dev/null || service squid status > /dev/null 2>&1; then
    # Try to connect to proxy port
    PROXY_PORT="${proxy_port:-3128}"
    if timeout 2 bash -c "echo > /dev/tcp/localhost/$PROXY_PORT" 2>/dev/null; then
        exit 0
    fi
fi
exit 1
HEALTHEOF

chmod +x /usr/local/bin/proxy-health-check.sh

# Create a simple HTTP server for ALB health checks (listens on port 8080)
cat > /usr/local/bin/health-check-server.sh <<'HEALTHEOF'
#!/bin/bash
while true; do
    PROXY_PORT="${proxy_port:-3128}"
    if timeout 2 bash -c "echo > /dev/tcp/localhost/$PROXY_PORT" 2>/dev/null; then
        echo -e "HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nOK" | nc -l -p 8080 -q 1
    else
        echo -e "HTTP/1.1 503 Service Unavailable\r\nContent-Length: 13\r\n\r\nNot Available" | nc -l -p 8080 -q 1
    fi
    sleep 1
done
HEALTHEOF

chmod +x /usr/local/bin/health-check-server.sh

# Install netcat for health check server
apt-get install -y netcat-openbsd || apt-get install -y nc

# Start health check server as a service
cat > /etc/systemd/system/proxy-health.service <<EOF
[Unit]
Description=Proxy Health Check Server
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/health-check-server.sh
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable proxy-health
systemctl start proxy-health

# Verify Squid is running
sleep 5
if systemctl is-active --quiet squid || service squid status > /dev/null 2>&1; then
    echo "Squid proxy installation completed successfully at $(date)" > /var/log/squid-install.log
    echo "SUCCESS: Squid proxy is running"
    
    # Install Proxy Node Agent (if control plane URL is provided)
    if [ -n "${control_plane_url}" ] && [ "${control_plane_url}" != "" ]; then
        echo "Installing Proxy Node Agent..."
        
        # Install dependencies
        apt-get install -y curl jq net-tools || true
        
        # Create agent directory
        mkdir -p /opt/proxy-node-agent
        
        # Get instance metadata
        INSTANCE_ID=$(curl -s http://169.254.169.254/latest/meta-data/instance-id 2>/dev/null || echo "local-$(hostname)")
        NODE_ID="node-${INSTANCE_ID}"
        echo "$NODE_ID" > /tmp/proxy-node-id
        echo "${control_plane_url}" > /tmp/control-plane-url
        
        # Get proxy host and region
        PROXY_HOST=$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null || hostname -I | awk '{print $1}')
        REGION=$(curl -s http://169.254.169.254/latest/meta-data/placement/region 2>/dev/null || echo "us-east-1")
        
        # Create heartbeat script
        cat > /opt/proxy-node-agent/heartbeat.sh <<'HEARTBEATEOF'
#!/bin/bash
NODE_ID=$(cat /tmp/proxy-node-id 2>/dev/null)
CONTROL_PLANE_URL=$(cat /tmp/control-plane-url 2>/dev/null)
if [ -z "$NODE_ID" ] || [ -z "$CONTROL_PLANE_URL" ]; then exit 0; fi
CURRENT_LOAD=$(netstat -an 2>/dev/null | grep -c ESTABLISHED || echo 0)
HEALTH=$(systemctl is-active --quiet squid 2>/dev/null && echo "healthy" || echo "unhealthy")
curl -s -X POST "$CONTROL_PLANE_URL/api/nodes/$NODE_ID/heartbeat" \
  -H "Content-Type: application/json" \
  -d "{\"load\":$CURRENT_LOAD,\"health\":\"$HEALTH\"}" > /dev/null
HEARTBEATEOF
        chmod +x /opt/proxy-node-agent/heartbeat.sh
        
        # Setup heartbeat timer
        cat > /etc/systemd/system/proxy-node-heartbeat.timer <<HEARTBEATEOF
[Unit]
Description=Proxy Node Heartbeat Timer
[Timer]
OnBootSec=1min
OnUnitActiveSec=30s
Unit=proxy-node-heartbeat.service
[Install]
WantedBy=timers.target
HEARTBEATEOF
        
        cat > /etc/systemd/system/proxy-node-heartbeat.service <<'HEARTBEATEOF'
[Unit]
Description=Proxy Node Heartbeat Service
After=network.target
[Service]
Type=oneshot
ExecStart=/opt/proxy-node-agent/heartbeat.sh
HEARTBEATEOF
        
        systemctl daemon-reload
        systemctl enable proxy-node-heartbeat.timer
        systemctl start proxy-node-heartbeat.timer
        
        # Register node after a delay
        sleep 15
        curl -s -X POST "${control_plane_url}/api/nodes/register" \
          -H "Content-Type: application/json" \
          -d "{\"id\":\"$NODE_ID\",\"name\":\"$(hostname)\",\"host\":\"$PROXY_HOST\",\"port\":${proxy_port:-3128},\"region\":\"$REGION\",\"capacity\":1000}" > /dev/null && \
          echo "Node registered with control plane" || echo "Node registration will retry via heartbeat"
    fi
else
    echo "ERROR: Squid proxy failed to start" > /var/log/squid-install.log
    systemctl status squid || service squid status
    exit 1
fi
