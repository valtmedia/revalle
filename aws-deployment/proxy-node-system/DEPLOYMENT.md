# Proxy Node System Deployment

## Complete Deployment Guide

### Prerequisites

1. Existing AWS Squid Proxy deployment
2. Docker image for control plane (or use provided Dockerfile)
3. ECR repository for control plane image
4. Terraform >= 1.0

### Step 1: Build Control Plane Image

```bash
cd proxy-node-system/control-plane
docker build -t proxy-control-plane:latest .
docker tag proxy-control-plane:latest YOUR_ECR_REGISTRY/proxy-control-plane:latest
docker push YOUR_ECR_REGISTRY/proxy-control-plane:latest
```

### Step 2: Deploy Control Plane Infrastructure

```bash
cd proxy-node-system/terraform

# Get outputs from main deployment
cd ../../terraform
CONTROL_PLANE_VPC=$(terraform output -raw vpc_id)
CONTROL_PLANE_SUBNETS=$(terraform output -json public_subnet_ids | jq -r '.[]')

cd ../proxy-node-system/terraform

# Create terraform.tfvars
cat > terraform.tfvars <<EOF
control_plane_image = "YOUR_ECR_REGISTRY/proxy-control-plane:latest"
proxy_vpc_id = "$CONTROL_PLANE_VPC"
proxy_public_subnets = $CONTROL_PLANE_SUBNETS
proxy_private_subnets = ["subnet-xxx", "subnet-yyy"]  # Get from main deployment
EOF

terraform init
terraform plan
terraform apply
```

### Step 3: Update Proxy Nodes

Update your existing proxy node user-data to include the agent:

```bash
# Get control plane URL
CONTROL_PLANE_URL=$(cd proxy-node-system/terraform && terraform output -raw control_plane_url)

# Update main terraform user-data.sh
# Add node agent installation at the end
```

### Step 4: Redeploy Proxy Nodes

```bash
cd ../../terraform
terraform apply  # This will update instances with node agent
```

### Step 5: Verify Deployment

```bash
# Check control plane health
curl http://$(cd proxy-node-system/terraform && terraform output -raw control_plane_dns)/health

# Check registered nodes
curl -H "Authorization: Bearer TOKEN" \
  http://$(cd proxy-node-system/terraform && terraform output -raw control_plane_dns)/api/nodes

# Access dashboard
open http://$(cd proxy-node-system/terraform && terraform output -raw control_plane_dns)/dashboard
```

## Architecture

```
┌─────────────────────────────────────────┐
│         Control Plane (ECS)            │
│  ┌──────────┐  ┌──────────┐           │
│  │   API    │  │ Dashboard│           │
│  └────┬─────┘  └──────────┘           │
│       │                                 │
│  ┌────▼─────┐  ┌──────────┐           │
│  │  Node    │  │ Metrics  │           │
│  │ Manager  │  │Collector │           │
│  └────┬─────┘  └──────────┘           │
│       │                                 │
│  ┌────▼─────┐                          │
│  │  Load    │                          │
│  │ Balancer │                          │
│  └──────────┘                          │
└───────┬─────────────────────────────────┘
        │
        │ Redis Cache
        │
┌───────▼─────────────────────────────────┐
│         Proxy Nodes (Auto Scaling)      │
│  ┌────────┐  ┌────────┐  ┌────────┐   │
│  │ Node 1 │  │ Node 2 │  │ Node N │   │
│  │ Agent  │  │ Agent  │  │ Agent  │   │
│  └────────┘  └────────┘  └────────┘   │
└───────┬─────────────────────────────────┘
        │
        │ Users
        │
┌───────▼──────┐
│   Clients    │
└──────────────┘
```

## Features

✅ **Automatic Node Registration** - Nodes register themselves on startup  
✅ **Health Monitoring** - Real-time health checks and heartbeat tracking  
✅ **Load Balancing** - Multiple strategies (round-robin, least-connections, weighted)  
✅ **Metrics Collection** - Request counts, latency, bandwidth usage  
✅ **Real-time Dashboard** - Web UI with live updates via WebSocket  
✅ **Dynamic Scaling** - Auto-add/remove nodes based on health  
✅ **Geographic Routing** - Route to nearest node by region  
✅ **API Management** - RESTful API for all operations  

## Cost Estimate

- **Control Plane (ECS Fargate)**: ~$30/month (2 tasks)
- **Redis Cache**: ~$15/month (cache.t3.micro)
- **ALB for Control Plane**: ~$20/month
- **Additional Data Transfer**: Variable
- **Total Additional**: ~$65/month

## Maintenance

### Update Control Plane

```bash
# Build new image
docker build -t proxy-control-plane:v2 .
docker push YOUR_ECR_REGISTRY/proxy-control-plane:v2

# Update ECS service
aws ecs update-service --cluster CLUSTER_NAME --service SERVICE_NAME --force-new-deployment
```

### Add New Proxy Node

Nodes automatically register when they start. Just launch a new instance with the updated user-data.

### Remove Node

```bash
curl -X DELETE \
  -H "Authorization: Bearer TOKEN" \
  http://CONTROL_PLANE_URL/api/nodes/NODE_ID
```

## Troubleshooting

### Control Plane Not Starting
- Check ECS task logs in CloudWatch
- Verify Redis connectivity
- Check security group rules

### Nodes Not Registering
- Verify CONTROL_PLANE_URL is set correctly
- Check node agent logs: `journalctl -u proxy-node-heartbeat`
- Test registration manually: `/opt/proxy-node-agent/register.sh`

### Dashboard Not Loading
- Check ALB health checks
- Verify ECS service is running
- Check browser console for errors
