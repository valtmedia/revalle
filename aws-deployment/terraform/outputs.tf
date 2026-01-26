output "vpc_id" {
  description = "VPC ID"
  value       = aws_vpc.proxy_vpc.id
}

output "load_balancer_dns" {
  description = "Load Balancer DNS name - Use this as your proxy server"
  value       = aws_lb.proxy_alb.dns_name
}

output "load_balancer_arn" {
  description = "Load Balancer ARN"
  value       = aws_lb.proxy_alb.arn
}

output "public_subnet_ids" {
  description = "Public Subnet IDs"
  value       = aws_subnet.proxy_public_subnets[*].id
}

output "security_group_id" {
  description = "Proxy Security Group ID"
  value       = aws_security_group.proxy_sg.id
}

output "proxy_endpoint" {
  description = "Proxy endpoint URL (format: http://DNS:PORT)"
  value       = "http://${aws_lb.proxy_alb.dns_name}:${var.proxy_port}"
}

output "autoscaling_group_name" {
  description = "Auto Scaling Group name"
  value       = aws_autoscaling_group.proxy_asg.name
}

output "target_group_arn" {
  description = "Target Group ARN for proxy traffic"
  value       = aws_lb_target_group.proxy_traffic_tg.arn
}
