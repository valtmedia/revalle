# Proxy Node System Integration Guide

## Overview

This guide explains how to integrate the proxy node management system with your existing AWS deployment.

## Architecture Changes

### Before (Simple Proxy)
```
Users → Load Balancer → Proxy Instances
```

### After (Node Management System)
```
Users → Load Balancer → Proxy Nodes
                    ↓
            Control Plane API
                    ↓
        Node Registry + Metrics
```

## Integration Steps

### 1. Deploy Control Plane

```bash
cd aws-deployment/proxy-node-system/terraform
terraform init
terraform apply
```

This creates:
- ECS Fargate cluster for control plane
- Redis cache for node registry
- Application Load Balancer for API
- Security groups and IAM roles

### 2. Update Proxy Node User Data

Modify your existing `terraform/user-data.sh` to include node agent:

```bash
# Add at the end of user-data.sh
wget -q -O /tmp/node-agent-setup.sh \
  https://raw.githubusercontent.com/your-repo/proxy-node-system/master/node-agent/setup.sh
chmod +x /tmp/node-agent-setup.sh
bash /tmp/node-agent-setup.sh

# Set control plane URL
export CONTROL_PLANE_URL=$(terraform output -raw control_plane_url)

# Register node
/opt/proxy-node-agent/register.sh
```

### 3. Update Terraform Variables

Add to `terraform/variables.tf`:

```hcl
variable "control_plane_url" {
  description = "Control Plane API URL"
  type        = string
  default     = ""
}
```

### 4. Deploy Updated Infrastructure

```bash
cd aws-deployment/terraform
terraform apply
```

## Using the System

### Register a Node Manually

```bash
curl -X POST http://CONTROL_PLANE_URL/api/nodes/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "my-proxy-node",
    "host": "1.2.3.4",
    "port": 3128,
    "region": "us-east-1",
    "capacity": 1000
  }'
```

### Get Next Available Node

```bash
curl http://CONTROL_PLANE_URL/api/load-balancer/next-node
```

### View All Nodes

```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  http://CONTROL_PLANE_URL/api/nodes
```

### Access Dashboard

Open: `http://CONTROL_PLANE_URL/dashboard`

## API Endpoints

### Node Management
- `POST /api/nodes/register` - Register new node
- `GET /api/nodes` - List all nodes
- `GET /api/nodes/:id` - Get node details
- `PUT /api/nodes/:id` - Update node
- `DELETE /api/nodes/:id` - Remove node
- `POST /api/nodes/:id/heartbeat` - Send heartbeat

### Load Balancing
- `GET /api/load-balancer/next-node` - Get next available node
- `GET /api/load-balancer/stats` - Get load balancer statistics

### Metrics
- `GET /api/metrics` - Get global metrics
- `GET /api/metrics/nodes/:id` - Get node-specific metrics
- `GET /api/stats/overview` - Get overview statistics

## Load Balancing Strategies

1. **Round Robin** (default) - Distribute evenly
2. **Least Connections** - Use node with fewest connections
3. **Weighted** - Based on capacity and current load
4. **Geographic** - Prefer nodes in same region

## Monitoring

- **Real-time Updates**: WebSocket connections for live updates
- **Health Checks**: Automatic node health monitoring
- **Metrics Collection**: Request counts, latency, bandwidth
- **Dashboard**: Web UI for visualization

## Scaling

The system automatically:
- Detects unhealthy nodes
- Removes inactive nodes
- Distributes load efficiently
- Supports dynamic node addition/removal

## Security

- JWT authentication for API access
- Rate limiting on API endpoints
- Security groups restrict access
- Redis for secure data storage

## Next Steps

1. Set up authentication tokens
2. Configure load balancing strategy
3. Set up monitoring alerts
4. Integrate with your application
5. Scale nodes as needed
