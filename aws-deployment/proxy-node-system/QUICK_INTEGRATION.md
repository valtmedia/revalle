# Quick Integration Guide

## 3-Step Integration

### Step 1: Deploy Control Plane (5 minutes)

```bash
cd aws-deployment/proxy-node-system/terraform

# Build and push Docker image (or use pre-built)
docker build -t proxy-control-plane:latest ../control-plane/
# Push to your ECR registry

# Deploy infrastructure
terraform init
terraform apply

# Get control plane URL
terraform output control_plane_url
```

### Step 2: Update Main Deployment (2 minutes)

```bash
cd ../../terraform

# Add to terraform.tfvars
echo 'control_plane_url = "http://YOUR_CONTROL_PLANE_DNS"' >> terraform.tfvars

# Apply changes
terraform apply
```

### Step 3: Verify (1 minute)

```bash
# Check nodes are registered
curl http://CONTROL_PLANE_URL/api/nodes

# Access dashboard
open http://CONTROL_PLANE_URL/dashboard
```

## That's It! 

Your proxy nodes will now:
- ✅ Automatically register on startup
- ✅ Send heartbeats every 30 seconds
- ✅ Appear in the dashboard
- ✅ Be managed by the control plane

## Next Steps

- Configure load balancing strategy
- Set up monitoring alerts
- Customize dashboard
- Add authentication tokens

See `INTEGRATION_GUIDE.md` for details.
