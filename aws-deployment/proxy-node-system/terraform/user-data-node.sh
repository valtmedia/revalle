#!/bin/bash
set -e

# Include original user-data
source /path/to/original/user-data.sh

# Install node agent
wget -q -O /tmp/node-agent-setup.sh \
  https://raw.githubusercontent.com/your-repo/proxy-node-system/master/node-agent/setup.sh

chmod +x /tmp/node-agent-setup.sh
bash /tmp/node-agent-setup.sh

# Set control plane URL (from Terraform output or environment)
CONTROL_PLANE_URL="${control_plane_url}"
export CONTROL_PLANE_URL

# Register node
/opt/proxy-node-agent/register.sh

echo "Proxy node with agent setup complete!"
