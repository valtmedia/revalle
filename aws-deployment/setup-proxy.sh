#!/bin/bash

############################################################
# Proxy Setup Helper Script
# Automatically configures your machine to use the proxy
############################################################

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TERRAFORM_DIR="${SCRIPT_DIR}/terraform"

print_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_header() {
    echo -e "${BLUE}=== $1 ===${NC}"
}

# Check if Terraform outputs exist
if [ ! -d "$TERRAFORM_DIR" ]; then
    print_error "Terraform directory not found. Have you deployed yet?"
    exit 1
fi

cd "$TERRAFORM_DIR"

# Check if terraform state exists
if [ ! -f terraform.tfstate ]; then
    print_error "Terraform state not found. Please deploy first:"
    echo "  cd aws-deployment && ./deploy.sh deploy"
    exit 1
fi

print_header "Getting Proxy Information"

# Get proxy endpoint
PROXY_DNS=$(terraform output -raw load_balancer_dns 2>/dev/null || echo "")
PROXY_PORT=$(terraform output -raw proxy_port 2>/dev/null || echo "3128")

if [ -z "$PROXY_DNS" ]; then
    print_error "Could not get load balancer DNS. Is the deployment complete?"
    exit 1
fi

PROXY_ENDPOINT="$PROXY_DNS:$PROXY_PORT"

print_info "Proxy Endpoint: $PROXY_ENDPOINT"

# Get credentials from tfvars
TFVARS_FILE="terraform.tfvars"
if [ -f "$TFVARS_FILE" ]; then
    ADMIN_USER=$(grep -E "^admin_username\s*=" "$TFVARS_FILE" | cut -d'"' -f2 | cut -d"'" -f2 | head -1)
    ADMIN_PASS=$(grep -E "^admin_password\s*=" "$TFVARS_FILE" | cut -d'"' -f2 | cut -d"'" -f2 | head -1)
    
    if [ -z "$ADMIN_USER" ] || [ -z "$ADMIN_PASS" ]; then
        print_warn "Could not read credentials from terraform.tfvars"
        read -p "Enter proxy username: " ADMIN_USER
        read -sp "Enter proxy password: " ADMIN_PASS
        echo
    else
        print_info "Using credentials from terraform.tfvars"
    fi
else
    print_warn "terraform.tfvars not found"
    read -p "Enter proxy username: " ADMIN_USER
    read -sp "Enter proxy password: " ADMIN_PASS
    echo
fi

PROXY_URL="http://${ADMIN_USER}:${ADMIN_PASS}@${PROXY_ENDPOINT}"

print_header "Testing Proxy Connection"

# Test connection
print_info "Testing proxy connection..."
if curl -s --proxy "$PROXY_URL" --max-time 10 http://httpbin.org/ip > /dev/null 2>&1; then
    print_info "✓ Proxy is working!"
    
    # Get IP through proxy
    YOUR_IP=$(curl -s --proxy "$PROXY_URL" https://api.ipify.org)
    print_info "Your IP through proxy: $YOUR_IP"
else
    print_error "✗ Proxy connection failed!"
    print_warn "Please check:"
    echo "  1. Instances are running"
    echo "  2. Security groups allow your IP"
    echo "  3. Credentials are correct"
    exit 1
fi

print_header "Configuration Options"

echo ""
echo "Choose how to configure the proxy:"
echo "1. Export environment variables (current session)"
echo "2. Add to shell profile (~/.bashrc or ~/.zshrc)"
echo "3. Create proxy configuration file"
echo "4. Show manual configuration instructions"
echo "5. Exit without configuring"
echo ""
read -p "Select option [1-5]: " option

case $option in
    1)
        print_info "Setting environment variables for current session..."
        export http_proxy="$PROXY_URL"
        export https_proxy="$PROXY_URL"
        export HTTP_PROXY="$PROXY_URL"
        export HTTPS_PROXY="$PROXY_URL"
        export no_proxy="localhost,127.0.0.1"
        print_info "✓ Environment variables set!"
        print_info "Test with: curl http://example.com"
        ;;
    2)
        SHELL_RC=""
        if [ -f "$HOME/.zshrc" ]; then
            SHELL_RC="$HOME/.zshrc"
        elif [ -f "$HOME/.bashrc" ]; then
            SHELL_RC="$HOME/.bashrc"
        elif [ -f "$HOME/.bash_profile" ]; then
            SHELL_RC="$HOME/.bash_profile"
        fi
        
        if [ -n "$SHELL_RC" ]; then
            print_info "Adding to $SHELL_RC..."
            cat >> "$SHELL_RC" <<EOF

# AWS Squid Proxy Configuration
export http_proxy="$PROXY_URL"
export https_proxy="$PROXY_URL"
export HTTP_PROXY="$PROXY_URL"
export HTTPS_PROXY="$PROXY_URL"
export no_proxy="localhost,127.0.0.1"
EOF
            print_info "✓ Added to $SHELL_RC"
            print_info "Run: source $SHELL_RC"
        else
            print_error "Could not find shell RC file"
        fi
        ;;
    3)
        CONFIG_FILE="$HOME/.proxy_config"
        cat > "$CONFIG_FILE" <<EOF
# AWS Squid Proxy Configuration
# Source this file: source ~/.proxy_config

export http_proxy="$PROXY_URL"
export https_proxy="$PROXY_URL"
export HTTP_PROXY="$PROXY_URL"
export HTTPS_PROXY="$PROXY_URL"
export no_proxy="localhost,127.0.0.1"

echo "Proxy configured: $PROXY_ENDPOINT"
EOF
        print_info "✓ Created $CONFIG_FILE"
        print_info "Use: source $CONFIG_FILE"
        ;;
    4)
        print_header "Manual Configuration"
        echo ""
        echo "Proxy Endpoint: $PROXY_ENDPOINT"
        echo "Username: $ADMIN_USER"
        echo "Password: $ADMIN_PASS"
        echo ""
        echo "Environment Variables:"
        echo "  export http_proxy=\"$PROXY_URL\""
        echo "  export https_proxy=\"$PROXY_URL\""
        echo ""
        echo "Curl:"
        echo "  curl -x $PROXY_URL http://example.com"
        echo ""
        echo "Browser:"
        echo "  HTTP Proxy: $PROXY_DNS"
        echo "  Port: $PROXY_PORT"
        echo "  Username: $ADMIN_USER"
        echo "  Password: $ADMIN_PASS"
        ;;
    5)
        print_info "Exiting without configuration"
        exit 0
        ;;
    *)
        print_error "Invalid option"
        exit 1
        ;;
esac

print_header "Setup Complete!"

echo ""
print_info "Your proxy is ready to use!"
echo ""
echo "Proxy URL: $PROXY_ENDPOINT"
echo "Username: $ADMIN_USER"
echo ""
echo "Test commands:"
echo "  curl --proxy $PROXY_URL http://example.com"
echo "  curl --proxy $PROXY_URL https://api.ipify.org"
echo ""
