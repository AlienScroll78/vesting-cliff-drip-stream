locals {
  alb_metric_dimension = "app/${aws_lb.main.name}/${element(split("/", aws_lb.main.arn), 3)}"
}

# ─── Security Groups ──────────────────────────────────────────────────────────

resource "aws_security_group" "alb" {
  name        = "${var.environment}-alb-sg"
  description = "Security group for Application Load Balancer"
  vpc_id      = var.vpc_id

  ingress {
    description = "HTTP from internet"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTPS from internet"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description = "Outbound traffic to target tasks"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name        = "${var.environment}-alb-sg"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

resource "aws_security_group" "backend" {
  name        = "${var.environment}-ecs-backend-sg"
  description = "Security group for ECS backend API tasks: reachable from ALB only"
  vpc_id      = var.vpc_id

  ingress {
    description     = "Inbound traffic from ALB only"
    from_port       = var.container_port
    to_port         = var.container_port
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  egress {
    description = "Outbound to internet via NAT and DB"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name        = "${var.environment}-ecs-backend-sg"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

resource "aws_security_group" "indexer" {
  name        = "${var.environment}-ecs-indexer-sg"
  description = "Security group for ECS event indexer tasks"
  vpc_id      = var.vpc_id

  egress {
    description = "Outbound traffic for RPC and DB"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name        = "${var.environment}-ecs-indexer-sg"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

# ─── ECS Cluster ──────────────────────────────────────────────────────────────

resource "aws_ecs_cluster" "main" {
  name = "${var.environment}-vesting"

  tags = {
    Name        = "${var.environment}-vesting-cluster"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

resource "aws_capacity_provider" "fargate_spot" {
  name = "${var.environment}-fargate-spot"

  capacity_provider_strategy {
    capacity_provider = "FARGATE_SPOT"
    weight            = 1
    base              = 0
  }
}

resource "aws_ecs_cluster_capacity_providers" "main" {
  cluster_name       = aws_ecs_cluster.main.name
  capacity_providers = ["FARGATE", aws_capacity_provider.fargate_spot.name]
}

# ─── Log Groups ───────────────────────────────────────────────────────────────

resource "aws_cloudwatch_log_group" "backend" {
  name              = "/ecs/${var.environment}-vesting-backend"
  retention_in_days = 90

  tags = {
    Name        = "/ecs/${var.environment}-vesting-backend"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

resource "aws_cloudwatch_log_group" "indexer" {
  name              = "/ecs/${var.environment}-vesting-indexer"
  retention_in_days = 90

  tags = {
    Name        = "/ecs/${var.environment}-vesting-indexer"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

# ─── ECS Task Definitions ─────────────────────────────────────────────────────

resource "aws_ecs_task_definition" "backend" {
  family                   = "vesting-backend"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.container_cpu
  memory                   = var.container_memory
  execution_role_arn       = aws_iam_role.ecs_exec.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([{
    name      = var.container_name
    image     = var.container_image
    essential = true
    portMappings = [{
      containerPort = var.container_port
      hostPort      = var.container_port
      protocol      = "tcp"
    }]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.backend.name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "backend"
      }
    }
  }])

  tags = {
    Name        = "${var.environment}-vesting-backend-task"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

resource "aws_ecs_task_definition" "indexer" {
  family                   = "vesting-indexer"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.container_cpu
  memory                   = var.container_memory
  execution_role_arn       = aws_iam_role.ecs_exec.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([{
    name      = "vesting-indexer"
    image     = var.indexer_container_image
    essential = true
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.indexer.name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "indexer"
      }
    }
  }])

  tags = {
    Name        = "${var.environment}-vesting-indexer-task"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

# ─── Application Load Balancer ────────────────────────────────────────────────

resource "aws_lb" "main" {
  name               = "${var.environment}-alb"
  load_balancer_type = "application"
  subnets            = var.public_subnet_ids
  security_groups    = [aws_security_group.alb.id]
  idle_timeout       = var.alb_idle_timeout

  tags = {
    Name        = "${var.environment}-alb"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

resource "aws_lb_target_group" "backend" {
  name        = "${var.environment}-backend"
  port        = var.container_port
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = var.vpc_id

  health_check {
    enabled             = true
    healthy_threshold   = 2
    interval            = 30
    matcher             = "200-399"
    path                = "/health"
    timeout_threshold   = 5
    unhealthy_threshold = 2
  }

  deregistration_delay = 30

  tags = {
    Name        = "${var.environment}-backend-tg"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

resource "aws_lb_target_group" "backend_green" {
  name        = "${var.environment}-backend-green"
  port        = var.container_port
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = var.vpc_id

  health_check {
    enabled             = true
    healthy_threshold   = 2
    interval            = 30
    matcher             = "200-399"
    path                = "/health"
    timeout_threshold   = 5
    unhealthy_threshold = 2
  }

  deregistration_delay = 30

  tags = {
    Name        = "${var.environment}-backend-green-tg"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.backend.arn
  }
}

resource "aws_lb_listener" "test" {
  load_balancer_arn = aws_lb.main.arn
  port              = 8081
  protocol          = "HTTP"

  default_action {
    type = "fixed-response"
    fixed_response {
      content_type = "text/plain"
      message_body = "CodeDeploy test listener"
      status_code  = "200"
    }
  }
}

# ─── ECS Services ─────────────────────────────────────────────────────────────

resource "aws_ecs_service" "backend" {
  name                               = "vesting-backend"
  cluster                            = aws_ecs_cluster.main.id
  task_definition                    = aws_ecs_task_definition.backend.arn
  desired_count                      = 2
  launch_type                        = "FARGATE"
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200
  health_check_grace_period_seconds  = 60

  deployment_controller {
    type = "CODE_DEPLOY"
  }

  network_configuration {
    subnets          = length(var.private_subnet_ids) > 0 ? var.private_subnet_ids : var.public_subnet_ids
    security_groups  = [aws_security_group.backend.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.backend.arn
    container_name   = var.container_name
    container_port   = var.container_port
  }

  lifecycle {
    ignore_changes = [task_definition, load_balancer]
  }

  tags = {
    Name        = "${var.environment}-vesting-backend-service"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

resource "aws_ecs_service" "indexer" {
  name            = "vesting-indexer"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.indexer.arn
  desired_count   = 1

  capacity_provider_strategy {
    capacity_provider = aws_capacity_provider.fargate_spot.name
    weight            = 1
    base              = 0
  }

  network_configuration {
    subnets          = length(var.private_subnet_ids) > 0 ? var.private_subnet_ids : var.public_subnet_ids
    security_groups  = [aws_security_group.indexer.id]
    assign_public_ip = false
  }

  tags = {
    Name        = "${var.environment}-vesting-indexer-service"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

# ─── IAM Roles ────────────────────────────────────────────────────────────────

data "aws_iam_policy_document" "ecs_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

data "aws_iam_policy_document" "ecs_exec" {
  statement {
    sid    = "ECRImagePullAndLogging"
    effect = "Allow"
    actions = [
      "ecr:GetAuthorizationToken",
      "ecr:BatchCheckLayerAvailability",
      "ecr:GetDownloadUrlForLayer",
      "ecr:BatchGetImage",
      "logs:CreateLogStream",
      "logs:PutLogEvents"
    ]
    resources = ["*"]
  }

  dynamic "statement" {
    for_each = length(var.secret_arns) > 0 ? [1] : []
    content {
      sid       = "SecretsManagerAccess"
      effect    = "Allow"
      actions   = ["secretsmanager:GetSecretValue"]
      resources = var.secret_arns
    }
  }

  dynamic "statement" {
    for_each = length(var.secrets_kms_key_arns) > 0 ? [1] : []
    content {
      sid       = "KMSDecryptAccess"
      effect    = "Allow"
      actions   = ["kms:Decrypt"]
      resources = var.secrets_kms_key_arns
    }
  }
}

resource "aws_iam_role" "ecs_exec" {
  name               = "${var.environment}-ecs-exec"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json

  tags = {
    Name        = "${var.environment}-ecs-exec"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

resource "aws_iam_role_policy" "ecs_exec" {
  name   = "${var.environment}-ecs-exec-policy"
  role   = aws_iam_role.ecs_exec.id
  policy = data.aws_iam_policy_document.ecs_exec.json
}

# ECS Task Role with least-privilege DB access, S3, and CloudWatch
data "aws_iam_policy_document" "ecs_task_policy" {
  statement {
    sid    = "CloudWatchLogsAndMetrics"
    effect = "Allow"
    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents",
      "logs:DescribeLogStreams",
      "cloudwatch:PutMetricData"
    ]
    resources = ["*"]
  }

  statement {
    sid    = "S3Access"
    effect = "Allow"
    actions = [
      "s3:GetObject",
      "s3:PutObject",
      "s3:ListBucket"
    ]
    resources = [
      "arn:aws:s3:::*vesting*",
      "arn:aws:s3:::*vesting*/*"
    ]
  }

  statement {
    sid    = "DatabaseSecretsAccess"
    effect = "Allow"
    actions = [
      "secretsmanager:GetSecretValue",
      "secretsmanager:DescribeSecret",
      "rds-db:connect"
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role" "ecs_task" {
  name               = "${var.environment}-ecs-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json

  tags = {
    Name        = "${var.environment}-ecs-task"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

resource "aws_iam_role_policy" "ecs_task" {
  name   = "${var.environment}-ecs-task-least-privilege"
  role   = aws_iam_role.ecs_task.id
  policy = data.aws_iam_policy_document.ecs_task_policy.json
}

# ─── CodeDeploy Configuration ─────────────────────────────────────────────────

resource "aws_iam_role" "codedeploy" {
  name = "${var.environment}-codedeploy"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Service = "codedeploy.amazonaws.com"
      }
      Action = "sts:AssumeRole"
    }]
  })

  tags = {
    Name        = "${var.environment}-codedeploy"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

resource "aws_iam_role_policy_attachment" "codedeploy" {
  role       = aws_iam_role.codedeploy.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSCodeDeployRoleForECS"
}

resource "aws_sns_topic" "deployment_notifications" {
  name              = "${var.environment}-vesting-deployment-events"
  kms_master_key_id = "alias/aws/sns"

  tags = {
    Name        = "${var.environment}-deployment-events"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

resource "aws_sns_topic_subscription" "deployment_notifications" {
  for_each  = var.deployment_notification_emails
  topic_arn = aws_sns_topic.deployment_notifications.arn
  protocol  = "email"
  endpoint  = each.value
}

resource "aws_iam_role_policy" "codedeploy" {
  name = "${var.environment}-codedeploy-inline"
  role = aws_iam_role.codedeploy.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "PublishDeploymentNotifications"
        Effect   = "Allow"
        Action   = ["sns:Publish"]
        Resource = [aws_sns_topic.deployment_notifications.arn]
      },
      {
        Sid      = "PassEcsExecutionRole"
        Effect   = "Allow"
        Action   = ["iam:PassRole"]
        Resource = [aws_iam_role.ecs_exec.arn]
      }
    ]
  })
}

resource "aws_codedeploy_app" "api" {
  name             = "${var.environment}-vesting-api"
  compute_platform = "ECS"
}

resource "aws_codedeploy_deployment_config" "api" {
  deployment_config_name = "${var.environment}-vesting-api-linear"
  compute_platform       = "ECS"

  traffic_routing_config {
    type = "TimeBasedLinear"

    time_based_linear {
      interval   = 1
      percentage = var.traffic_shift_percentages[0]
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "deployment_health" {
  alarm_name          = "${var.environment}-vesting-deployment-health"
  alarm_description   = "Stops a deployment when target health failures exceed the configured threshold"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  threshold           = var.health_check_failure_threshold_percent
  treat_missing_data  = "notBreaching"
  actions_enabled     = false

  metric_query {
    id = "unhealthy"

    metric {
      metric_name = "UnHealthyHostCount"
      namespace   = "AWS/ApplicationELB"
      period      = 60
      stat        = "Maximum"
      dimensions = {
        LoadBalancer = local.alb_metric_dimension
      }
    }

    return_data = false
  }

  metric_query {
    id = "requests"

    metric {
      metric_name = "RequestCount"
      namespace   = "AWS/ApplicationELB"
      period      = 60
      stat        = "Sum"
      dimensions = {
        LoadBalancer = local.alb_metric_dimension
      }
    }

    return_data = false
  }

  metric_query {
    id          = "health_failure_rate"
    expression  = "IF(requests > 0, unhealthy / requests * 100, 0)"
    label       = "Target health failure percentage"
    return_data = true
  }

  tags = {
    Name        = "${var.environment}-deployment-health-alarm"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

resource "aws_codedeploy_deployment_group" "api" {
  app_name               = aws_codedeploy_app.api.name
  deployment_config_name = aws_codedeploy_deployment_config.api.id
  deployment_group_name  = "${var.environment}-vesting-api"
  service_role_arn       = aws_iam_role.codedeploy.arn

  auto_rollback_configuration {
    enabled = true
    events  = ["DEPLOYMENT_FAILURE", "DEPLOYMENT_STOP_ON_ALARM", "DEPLOYMENT_STOP_ON_REQUEST"]
  }

  alarm_configuration {
    alarms                    = [aws_cloudwatch_metric_alarm.deployment_health.alarm_name]
    enabled                   = true
    ignore_poll_alarm_failure = false
  }

  blue_green_deployment_config {
    deployment_ready_option {
      action_on_timeout    = "STOP_DEPLOYMENT"
      wait_time_in_minutes = var.codedeploy_bake_minutes
    }

    terminate_blue_instances_on_deployment_success {
      action                           = "TERMINATE"
      termination_wait_time_in_minutes = var.codedeploy_bake_minutes
    }
  }

  deployment_style {
    deployment_option = "WITH_TRAFFIC_CONTROL"
    deployment_type   = "BLUE_GREEN"
  }

  ecs_service {
    cluster_name = aws_ecs_cluster.main.name
    service_name = aws_ecs_service.backend.name
  }

  load_balancer_info {
    target_group_pair_info {
      prod_traffic_route {
        listener_arns = [aws_lb_listener.http.arn]
      }

      test_traffic_route {
        listener_arns = [aws_lb_listener.test.arn]
      }

      target_group {
        name = aws_lb_target_group.backend.name
      }

      target_group {
        name = aws_lb_target_group.backend_green.name
      }
    }
  }

  trigger_configuration {
    trigger_events     = ["DeploymentStart", "DeploymentSuccess", "DeploymentFailure", "DeploymentStop", "DeploymentRollback"]
    trigger_name       = "${var.environment}-deployment-events"
    trigger_target_arn = aws_sns_topic.deployment_notifications.arn
  }
}

# ─── Task role for the log shipper ────────────────────────────────────────────
#
# The execution role is for the ECS agent (pulling images, creating log streams
# for the awslogs driver). The shipper is an ordinary container, so it needs a
# task role of its own.

data "aws_iam_policy_document" "ecs_task_logs" {
  statement {
    sid    = "WriteApplicationLogStreams"
    effect = "Allow"
    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]
    # Fluent Bit scopes writes per stream, which is expressed as a suffix on
    # the group ARN. Scoping to these groups means a compromised task cannot
    # write into an account's other log groups.
    resources = [for arn in var.app_log_group_arns : "${arn}:*"]
  }
}

resource "aws_iam_role" "ecs_task" {
  name = "${var.environment}-ecs-task"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "ecs_task_logs" {
  role   = aws_iam_role.ecs_task.id
  policy = data.aws_iam_policy_document.ecs_task_logs.json
}

# ─── Indexer ECS Service ─────────────────────────────────────────────────────
#
# Runs on Fargate Spot to reduce cost — an interrupted indexer catches up from
# the event log rather than dropping user-facing work.

resource "aws_ecs_task_definition" "indexer" {
  family                   = "vesting-indexer"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.indexer_cpu
  memory                   = var.indexer_memory
  execution_role_arn       = aws_iam_role.ecs_exec.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([{
    name  = "vesting-indexer"
    image = var.container_image
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = "/ecs/indexer"
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "ecs"
      }
    }
  }])
}

resource "aws_ecs_service" "indexer" {
  name            = "vesting-indexer"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.indexer.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  capacity_provider_strategy {
    capacity_provider = aws_capacity_provider.fargate_spot.name
    weight            = 1
  }

  network_configuration {
    subnets          = var.private_subnet_ids
    assign_public_ip = false
  }

  lifecycle {
    ignore_changes = [task_definition]
  }
}

# ─── WAF Web ACL ──────────────────────────────────────────────────────────────

resource "aws_wafv2_web_acl" "main" {
  name        = "${var.environment}-vesting-alb"
  description = "WAF rules for the ${var.environment} ALB"
  scope       = "REGIONAL"

  default_action {
    allow {}
  }

  # Rate-based rule: block IPs exceeding the threshold
  rule {
    name     = "rate-limit"
    priority = 1

    action {
      block {}
    }

    statement {
      rate_based_statement {
        limit              = var.waf_rate_limit
        aggregate_key_type = "IP"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name               = "${var.environment}-rate-limit"
      sampled_requests_enabled   = true
    }
  }

  # Geo-block sanctioned countries
  rule {
    name     = "geo-block"
    priority = 2

    action {
      block {}
    }

    statement {
      geo_match_statement {
        country_codes = var.waf_sanctioned_country_codes
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name               = "${var.environment}-geo-block"
      sampled_requests_enabled   = true
    }
  }

  # AWS Managed Rules Common Rule Set
  rule {
    name     = "aws-managed-common"
    priority = 3

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesCommonRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name               = "${var.environment}-managed-common"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name               = "${var.environment}-vesting-waf"
    sampled_requests_enabled   = true
  }

  tags = { Name = "${var.environment}-vesting-waf" }
}

# Associate the WAF with the ALB
resource "aws_wafv2_web_acl_association" "alb" {
  resource_arn = aws_lb.main.arn
  web_acl_arn  = aws_wafv2_web_acl.main.arn
}

# WAF logging to CloudWatch
resource "aws_cloudwatch_log_group" "waf" {
  name              = "aws/wafv2/${var.environment}-vesting-alb"
  retention_in_days = var.waf_log_retention_days
  tags              = { Name = "aws/wafv2/${var.environment}-vesting-alb" }
}

resource "aws_wafv2_web_acl_logging_configuration" "alb" {
  log_destination_configs = [aws_cloudwatch_log_group.waf.arn]
  resource_arn            = aws_wafv2_web_acl.main.arn
}

# WAF dashboard
resource "aws_cloudwatch_dashboard" "waf" {
  dashboard_name = "${var.environment}-vesting-waf"

  dashboard_body = jsonencode({
    widgets = [
      {
        type = "metric", x = 0, y = 0, width = 12, height = 6
        properties = {
          title  = "Blocked requests"
          view   = "timeSeries"
          region = var.aws_region
          stat   = "Sum"
          period = 300
          metrics = [
            ["AWS/WAFV2", "BlockedRequests", "WebACL", "${var.environment}-vesting-alb"]
          ]
        }
      },
      {
        type = "metric", x = 12, y = 0, width = 12, height = 6
        properties = {
          title  = "Allowed requests"
          view   = "timeSeries"
          region = var.aws_region
          stat   = "Sum"
          period = 300
          metrics = [
            ["AWS/WAFV2", "AllowedRequests", "WebACL", "${var.environment}-vesting-alb"]
          ]
        }
      }
    ]
  })
}
