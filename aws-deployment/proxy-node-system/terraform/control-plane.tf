# Control Plane Infrastructure

# ECS Cluster for Control Plane
resource "aws_ecs_cluster" "control_plane" {
  name = "${var.project_name}-control-plane"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  tags = {
    Name = "${var.project_name}-control-plane"
  }
}

# ECS Task Definition
resource "aws_ecs_task_definition" "control_plane" {
  family                   = "${var.project_name}-control-plane"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "512"
  memory                   = "1024"
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn           = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([{
    name  = "control-plane"
    image = "${var.control_plane_image}:latest"
    
    portMappings = [{
      containerPort = 3000
      protocol      = "tcp"
    }]

    environment = [
      {
        name  = "PORT"
        value = "3000"
      },
      {
        name  = "REDIS_URL"
        value = "redis://${aws_elasticache_cluster.redis.cache_nodes[0].address}:6379"
      },
      {
        name  = "NODE_ENV"
        value = "production"
      }
    ]

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.control_plane.name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "ecs"
      }
    }

    healthCheck = {
      command     = ["CMD-SHELL", "curl -f http://localhost:3000/health || exit 1"]
      interval    = 30
      timeout     = 5
      retries     = 3
      startPeriod = 60
    }
  }])

  tags = {
    Name = "${var.project_name}-control-plane"
  }
}

# ECS Service
resource "aws_ecs_service" "control_plane" {
  name            = "${var.project_name}-control-plane"
  cluster         = aws_ecs_cluster.control_plane.id
  task_definition = aws_ecs_task_definition.control_plane.arn
  desired_count   = 2
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = aws_subnet.proxy_public_subnets[*].id
    security_groups  = [aws_security_group.control_plane.id]
    assign_public_ip = true
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.control_plane.arn
    container_name   = "control-plane"
    container_port   = 3000
  }

  depends_on = [
    aws_lb_listener.control_plane
  ]

  tags = {
    Name = "${var.project_name}-control-plane"
  }
}

# Application Load Balancer for Control Plane
resource "aws_lb" "control_plane" {
  name               = "${var.project_name}-control-plane-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.control_plane_alb.id]
  subnets            = aws_subnet.proxy_public_subnets[*].id

  enable_deletion_protection = false

  tags = {
    Name = "${var.project_name}-control-plane-alb"
  }
}

resource "aws_lb_target_group" "control_plane" {
  name     = "${var.project_name}-control-plane-tg"
  port     = 3000
  protocol = "HTTP"
  vpc_id   = aws_vpc.proxy_vpc.id
  target_type = "ip"

  health_check {
    enabled             = true
    healthy_threshold   = 2
    unhealthy_threshold = 3
    timeout             = 5
    interval            = 30
    path                = "/health"
    protocol            = "HTTP"
    matcher             = "200"
  }

  tags = {
    Name = "${var.project_name}-control-plane-tg"
  }
}

resource "aws_lb_listener" "control_plane" {
  load_balancer_arn = aws_lb.control_plane.arn
  port              = "80"
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.control_plane.arn
  }
}

# Redis for Control Plane
resource "aws_elasticache_subnet_group" "redis" {
  name       = "${var.project_name}-redis-subnet"
  subnet_ids = aws_subnet.proxy_private_subnets[*].id
}

resource "aws_elasticache_cluster" "redis" {
  cluster_id           = "${var.project_name}-redis"
  engine               = "redis"
  node_type            = "cache.t3.micro"
  num_cache_nodes      = 1
  parameter_group_name = "default.redis7"
  port                 = 6379
  subnet_group_name    = aws_elasticache_subnet_group.redis.name
  security_group_ids   = [aws_security_group.redis.id]

  tags = {
    Name = "${var.project_name}-redis"
  }
}

# Security Groups
resource "aws_security_group" "control_plane" {
  name        = "${var.project_name}-control-plane-sg"
  description = "Security group for control plane ECS tasks"
  vpc_id      = aws_vpc.proxy_vpc.id

  ingress {
    from_port   = 3000
    to_port     = 3000
    protocol    = "tcp"
    security_groups = [aws_security_group.control_plane_alb.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${var.project_name}-control-plane-sg"
  }
}

resource "aws_security_group" "control_plane_alb" {
  name        = "${var.project_name}-control-plane-alb-sg"
  description = "Security group for control plane ALB"
  vpc_id      = aws_vpc.proxy_vpc.id

  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${var.project_name}-control-plane-alb-sg"
  }
}

resource "aws_security_group" "redis" {
  name        = "${var.project_name}-redis-sg"
  description = "Security group for Redis"
  vpc_id      = aws_vpc.proxy_vpc.id

  ingress {
    from_port   = 6379
    to_port     = 6379
    protocol    = "tcp"
    security_groups = [aws_security_group.control_plane.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${var.project_name}-redis-sg"
  }
}

# CloudWatch Log Group
resource "aws_cloudwatch_log_group" "control_plane" {
  name              = "/ecs/${var.project_name}-control-plane"
  retention_in_days = 7

  tags = {
    Name = "${var.project_name}-control-plane-logs"
  }
}

# IAM Roles
resource "aws_iam_role" "ecs_execution" {
  name = "${var.project_name}-ecs-execution-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "ecs-tasks.amazonaws.com"
      }
    }]
  })
}

resource "aws_iam_role_policy" "ecs_execution" {
  name = "${var.project_name}-ecs-execution-policy"
  role = aws_iam_role.ecs_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ]
      Resource = "*"
    }]
  })
}

resource "aws_iam_role" "ecs_task" {
  name = "${var.project_name}-ecs-task-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "ecs-tasks.amazonaws.com"
      }
    }]
  })
}

# Outputs
output "control_plane_url" {
  description = "Control Plane API URL"
  value       = "http://${aws_lb.control_plane.dns_name}"
}

output "control_plane_dns" {
  description = "Control Plane DNS name"
  value       = aws_lb.control_plane.dns_name
}
