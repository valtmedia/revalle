#!/bin/bash

############################################################
# AWS Squid Proxy Deployment Script
# This script deploys a complete Squid proxy network on AWS
############################################################

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TERRAFORM_DIR="${SCRIPT_DIR}/terraform"
TFVARS_FILE="${TERRAFORM_DIR}/terraform.tfvars"

# Functions
print_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

check_requirements() {
    print_info "Checking requirements..."
    
    # Check AWS CLI
    if ! command -v aws &> /dev/null; then
        print_error "AWS CLI is not installed. Please install it first."
        exit 1
    fi
    
    # Check Terraform
    if ! command -v terraform &> /dev/null; then
        print_error "Terraform is not installed. Please install it first."
        exit 1
    fi
    
    # Check AWS credentials
    if ! aws sts get-caller-identity &> /dev/null; then
        print_error "AWS credentials not configured. Run 'aws configure' first."
        exit 1
    fi
    
    print_info "All requirements met!"
}

setup_tfvars() {
    if [ ! -f "$TFVARS_FILE" ]; then
        print_warn "terraform.tfvars not found. Creating from example..."
        if [ -f "${TERRAFORM_DIR}/terraform.tfvars.example" ]; then
            cp "${TERRAFORM_DIR}/terraform.tfvars.example" "$TFVARS_FILE"
            print_warn "Please edit ${TFVARS_FILE} with your configuration before continuing."
            read -p "Press Enter after editing terraform.tfvars..."
        else
            print_error "terraform.tfvars.example not found!"
            exit 1
        fi
    fi
}

deploy_infrastructure() {
    print_info "Deploying infrastructure with Terraform..."
    cd "$TERRAFORM_DIR"
    
    # Initialize Terraform
    print_info "Initializing Terraform..."
    terraform init
    
    # Validate configuration
    print_info "Validating Terraform configuration..."
    terraform validate
    
    # Plan deployment
    print_info "Planning deployment..."
    terraform plan -out=tfplan
    
    # Ask for confirmation
    read -p "Do you want to apply these changes? (yes/no): " confirm
    if [ "$confirm" != "yes" ]; then
        print_warn "Deployment cancelled."
        exit 0
    fi
    
    # Apply changes
    print_info "Applying Terraform plan..."
    terraform apply tfplan
    
    # Get outputs
    print_info "Deployment completed! Getting outputs..."
    terraform output
    
    cd "$SCRIPT_DIR"
}

show_outputs() {
    cd "$TERRAFORM_DIR"
    print_info "=== Deployment Outputs ==="
    terraform output
    cd "$SCRIPT_DIR"
}

destroy_infrastructure() {
    print_warn "This will destroy all infrastructure!"
    read -p "Type 'yes' to confirm: " confirm
    if [ "$confirm" != "yes" ]; then
        print_info "Cancelled."
        exit 0
    fi
    
    cd "$TERRAFORM_DIR"
    terraform destroy
    cd "$SCRIPT_DIR"
}

# Main menu
show_menu() {
    echo ""
    echo "=== AWS Squid Proxy Deployment ==="
    echo "1. Deploy infrastructure"
    echo "2. Show outputs"
    echo "3. Setup proxy on this machine"
    echo "4. Test proxy connection"
    echo "5. Destroy infrastructure"
    echo "6. Exit"
    echo ""
    read -p "Select option [1-6]: " option
    
    case $option in
        1)
            check_requirements
            setup_tfvars
            deploy_infrastructure
            ;;
        2)
            show_outputs
            ;;
        3)
            if [ -f "${SCRIPT_DIR}/setup-proxy.sh" ]; then
                bash "${SCRIPT_DIR}/setup-proxy.sh"
            else
                print_error "setup-proxy.sh not found"
            fi
            ;;
        4)
            if [ -f "${SCRIPT_DIR}/test-proxy.sh" ]; then
                bash "${SCRIPT_DIR}/test-proxy.sh"
            else
                print_error "test-proxy.sh not found"
            fi
            ;;
        5)
            destroy_infrastructure
            ;;
        6)
            print_info "Exiting..."
            exit 0
            ;;
        *)
            print_error "Invalid option"
            exit 1
            ;;
    esac
}

# Run main menu
if [ "$1" == "deploy" ]; then
    check_requirements
    setup_tfvars
    deploy_infrastructure
elif [ "$1" == "destroy" ]; then
    destroy_infrastructure
elif [ "$1" == "outputs" ]; then
    show_outputs
else
    show_menu
fi
