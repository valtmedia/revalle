variable "control_plane_image" {
  description = "Docker image for control plane"
  type        = string
  default     = "your-registry/proxy-control-plane"
}

# Include all variables from main terraform
variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Project name"
  type        = string
  default     = "squid-proxy"
}

variable "vpc_cidr" {
  description = "VPC CIDR"
  type        = string
  default     = "10.0.0.0/16"
}

variable "availability_zones" {
  description = "Availability zones"
  type        = list(string)
  default     = ["us-east-1a", "us-east-1b"]
}

# Reference to existing resources (from main terraform)
variable "proxy_vpc_id" {
  description = "VPC ID from main deployment"
  type        = string
}

variable "proxy_public_subnets" {
  description = "Public subnet IDs from main deployment"
  type        = list(string)
}

variable "proxy_private_subnets" {
  description = "Private subnet IDs from main deployment"
  type        = list(string)
}
