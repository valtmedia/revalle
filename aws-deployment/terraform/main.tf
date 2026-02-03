provider "aws" {
  region = var.aws_region
}

# VPC for Proxy Network
resource "aws_vpc" "proxy_vpc" {
  cidr_block           = var.vpc_cidr
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = {
    Name = "${var.project_name}-vpc"
  }
}

# Internet Gateway
resource "aws_internet_gateway" "proxy_igw" {
  vpc_id = aws_vpc.proxy_vpc.id

  tags = {
    Name = "${var.project_name}-igw"
  }
}

# Public Subnets (for proxy instances)
resource "aws_subnet" "proxy_public_subnets" {
  count             = length(var.availability_zones)
  vpc_id            = aws_vpc.proxy_vpc.id
  cidr_block         = cidrsubnet(var.vpc_cidr, 8, count.index)
  availability_zone  = var.availability_zones[count.index]
  map_public_ip_on_launch = true

  tags = {
    Name = "${var.project_name}-public-subnet-${count.index + 1}"
  }
}

# Private Subnets (optional, for future use)
resource "aws_subnet" "proxy_private_subnets" {
  count             = length(var.availability_zones)
  vpc_id            = aws_vpc.proxy_vpc.id
  cidr_block         = cidrsubnet(var.vpc_cidr, 8, count.index + 10)
  availability_zone  = var.availability_zones[count.index]

  tags = {
    Name = "${var.project_name}-private-subnet-${count.index + 1}"
  }
}

# Route Table for Public Subnets
resource "aws_route_table" "proxy_public_rt" {
  vpc_id = aws_vpc.proxy_vpc.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.proxy_igw.id
  }

  tags = {
    Name = "${var.project_name}-public-rt"
  }
}

# Route Table Associations
resource "aws_route_table_association" "proxy_public_rta" {
  count          = length(aws_subnet.proxy_public_subnets)
  subnet_id      = aws_subnet.proxy_public_subnets[count.index].id
  route_table_id = aws_route_table.proxy_public_rt.id
}

# Security Group for Proxy Servers
resource "aws_security_group" "proxy_sg" {
  name        = "${var.project_name}-proxy-sg"
  description = "Security group for Squid proxy servers"
  vpc_id      = aws_vpc.proxy_vpc.id

  # SSH access
  ingress {
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.ssh_access_cidr]
    description = "SSH access"
  }

  # Squid proxy port
  ingress {
    from_port   = var.proxy_port
    to_port     = var.proxy_port
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "Squid proxy access"
  }

  # Health check port
  ingress {
    from_port   = 8080
    to_port     = 8080
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr]
    description = "Health check server"
  }

  # HTTPS for proxy
  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "HTTPS proxy access"
  }

  # Outbound traffic
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
    description = "All outbound traffic"
  }

  tags = {
    Name = "${var.project_name}-proxy-sg"
  }
}

# Security Group for Load Balancer
resource "aws_security_group" "alb_sg" {
  name        = "${var.project_name}-alb-sg"
  description = "Security group for Application Load Balancer"
  vpc_id      = aws_vpc.proxy_vpc.id

  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "HTTP"
  }

  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "HTTPS"
  }

  ingress {
    from_port   = var.proxy_port
    to_port     = var.proxy_port
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "Proxy port"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
    description = "All outbound"
  }

  tags = {
    Name = "${var.project_name}-alb-sg"
  }
}

# Application Load Balancer
resource "aws_lb" "proxy_alb" {
  name               = "${var.project_name}-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb_sg.id]
  subnets            = aws_subnet.proxy_public_subnets[*].id

  enable_deletion_protection = false
  enable_http2              = true

  tags = {
    Name = "${var.project_name}-alb"
  }
}

# Target Group for Proxy Servers
resource "aws_lb_target_group" "proxy_tg" {
  name     = "${var.project_name}-tg"
  port     = 8080  # Health check server port
  protocol = "HTTP"
  vpc_id   = aws_vpc.proxy_vpc.id

  health_check {
    enabled             = true
    healthy_threshold   = 2
    unhealthy_threshold = 3
    timeout             = 5
    interval            = 30
    path                = "/"
    protocol            = "HTTP"
    matcher             = "200"
  }

  tags = {
    Name = "${var.project_name}-tg"
  }
}

# Target Group for actual proxy traffic
resource "aws_lb_target_group" "proxy_traffic_tg" {
  name     = "${var.project_name}-traffic-tg"
  port     = var.proxy_port
  protocol = "HTTP"
  vpc_id   = aws_vpc.proxy_vpc.id

  health_check {
    enabled             = true
    healthy_threshold   = 2
    unhealthy_threshold = 3
    timeout             = 5
    interval            = 30
    port                = 8080
    path                = "/"
    protocol            = "HTTP"
    matcher             = "200"
  }

  tags = {
    Name = "${var.project_name}-traffic-tg"
  }
}

# ALB Listener for proxy traffic
resource "aws_lb_listener" "proxy_listener" {
  load_balancer_arn = aws_lb.proxy_alb.arn
  port              = var.proxy_port
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.proxy_traffic_tg.arn
  }
}

# ALB Listener for health checks (port 8080)
resource "aws_lb_listener" "health_listener" {
  load_balancer_arn = aws_lb.proxy_alb.arn
  port              = 8080
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.proxy_tg.arn
  }
}

# Launch Template for Auto Scaling
resource "aws_launch_template" "proxy_lt" {
  name_prefix   = "${var.project_name}-"
  image_id      = var.ami_id != "" ? var.ami_id : data.aws_ami.ubuntu.id
  instance_type = var.instance_type
  key_name      = var.key_pair_name

  vpc_security_group_ids = [aws_security_group.proxy_sg.id]

  user_data = base64encode(templatefile("${path.module}/user-data.sh", {
    proxy_port      = var.proxy_port
    admin_username  = var.admin_username
    admin_password  = var.admin_password
    control_plane_url = var.control_plane_url != "" ? var.control_plane_url : ""
  }))

  iam_instance_profile {
    name = aws_iam_instance_profile.proxy_profile.name
  }

  tag_specifications {
    resource_type = "instance"
    tags = {
      Name = "${var.project_name}-proxy-instance"
    }
  }
}

# Auto Scaling Group
resource "aws_autoscaling_group" "proxy_asg" {
  name                = "${var.project_name}-asg"
  vpc_zone_identifier = aws_subnet.proxy_public_subnets[*].id
  target_group_arns   = [
    aws_lb_target_group.proxy_tg.arn,
    aws_lb_target_group.proxy_traffic_tg.arn
  ]
  health_check_type   = "ELB"
  health_check_grace_period = 300

  min_size         = var.min_instances
  max_size         = var.max_instances
  desired_capacity = var.desired_instances

  launch_template {
    id      = aws_launch_template.proxy_lt.id
    version = "$Latest"
  }

  tag {
    key                 = "Name"
    value               = "${var.project_name}-asg-instance"
    propagate_at_launch = true
  }
}

# IAM Role for EC2 Instances
resource "aws_iam_role" "proxy_role" {
  name = "${var.project_name}-ec2-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ec2.amazonaws.com"
        }
      }
    ]
  })

  tags = {
    Name = "${var.project_name}-ec2-role"
  }
}

# IAM Instance Profile
resource "aws_iam_instance_profile" "proxy_profile" {
  name = "${var.project_name}-ec2-profile"
  role = aws_iam_role.proxy_role.name
}

# IAM Policy for CloudWatch Logs
resource "aws_iam_role_policy" "proxy_policy" {
  name = "${var.project_name}-ec2-policy"
  role = aws_iam_role.proxy_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
          "logs:DescribeLogStreams"
        ]
        Resource = "arn:aws:logs:*:*:*"
      }
    ]
  })
}

# CloudWatch Log Group
resource "aws_cloudwatch_log_group" "proxy_logs" {
  name              = "/aws/ec2/${var.project_name}/squid"
  retention_in_days = 7

  tags = {
    Name = "${var.project_name}-logs"
  }
}

