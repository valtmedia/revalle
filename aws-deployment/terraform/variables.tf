variable "aws_region" {
  description = "AWS region for resources"
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Project name prefix for resources"
  type        = string
  default     = "squid-proxy"
}

variable "vpc_cidr" {
  description = "CIDR block for VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "availability_zones" {
  description = "Availability zones for subnets"
  type        = list(string)
  default     = ["us-east-1a", "us-east-1b"]
}

variable "proxy_port" {
  description = "Squid proxy port"
  type        = number
  default     = 3128
}

variable "instance_type" {
  description = "EC2 instance type"
  type        = string
  default     = "t3.medium"
}

variable "min_instances" {
  description = "Minimum number of instances"
  type        = number
  default     = 2
}

variable "max_instances" {
  description = "Maximum number of instances"
  type        = number
  default     = 5
}

variable "desired_instances" {
  description = "Desired number of instances"
  type        = number
  default     = 2
}

variable "key_pair_name" {
  description = "AWS Key Pair name for SSH access (REQUIRED)"
  type        = string
  default     = ""
  
  validation {
    condition     = var.key_pair_name != ""
    error_message = "key_pair_name is required. Create a key pair in AWS EC2 first."
  }
}

variable "ssh_access_cidr" {
  description = "CIDR block for SSH access"
  type        = string
  default     = "0.0.0.0/0"
}

variable "ami_id" {
  description = "AMI ID (leave empty to use latest Ubuntu)"
  type        = string
  default     = ""
}

variable "admin_username" {
  description = "Default admin username for proxy"
  type        = string
  default     = "admin"
  sensitive   = true
}

variable "admin_password" {
  description = "Default admin password for proxy"
  type        = string
  default     = "ChangeMe123!"
  sensitive   = true
}
