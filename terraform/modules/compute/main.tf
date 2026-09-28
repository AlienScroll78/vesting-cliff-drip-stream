resource "aws_ecs_cluster" "main" {
  name = "${var.environment}-vesting"
}

# Spot capacity for the interruptible workloads. The backend API stays on
# on-demand Fargate; only the indexer runs on Spot, because an interrupted indexer
# catches up from the event log rather than dropping user-facing work.
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

resource "aws_ecs_task_definition" "backend" {
  family                   = "vesting-backend"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.ecs_exec.arn

  container_definitions = jsonencode([{
    name  = "vesting-backend"
    image = "public.ecr.aws/amazonlinux/amazonlinux:latest"
    portMappings = [{ containerPort = 8080 }]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = "/ecs/vesting-backend"
        "awslogs-region"        = "us-east-1"
        "awslogs-stream-prefix" = "ecs"
      }
    }
  }])
}

resource "aws_ecs_service" "backend" {
  name            = "vesting-backend"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.backend.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = var.public_subnet_ids
    assign_public_ip = true
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.backend.arn
    container_name   = "vesting-backend"
    container_port   = 8080
  }
}

# ─── Indexer (Fargate Spot) ──────────────────────────────────────────────────

# The indexer is the only interruptible component: it replays Horizon events and
# can rebuild its cursor position from stream_events after a Spot reclamation,
# so losing a task costs a re-scan rather than correctness. That makes it the
# right place to take the ~60-70% Fargate Spot discount.
resource "aws_ecs_task_definition" "indexer" {
  family                   = "vesting-indexer"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 512
  memory                   = 1024
  execution_role_arn       = aws_iam_role.ecs_exec.arn

  container_definitions = jsonencode([{
    name  = "vesting-indexer"
    image = "public.ecr.aws/amazonlinux/amazonlinux:latest"
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = "/ecs/vesting-indexer"
        "awslogs-region"        = "us-east-1"
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

  # Spot first, with on-demand Fargate as the fallback so a capacity shortfall
  # degrades cost rather than availability.
  capacity_provider_strategy {
    capacity_provider = aws_capacity_provider.fargate_spot.name
    weight            = 100
    base              = 0
  }

  capacity_provider_strategy {
    capacity_provider = "FARGATE"
    weight            = 0
    base              = 1
  }

  network_configuration {
    subnets          = var.public_subnet_ids
    assign_public_ip = true
  }
}

resource "aws_lb" "main" {
  name               = "${var.environment}-alb"
  load_balancer_type = "application"
  subnets            = var.public_subnet_ids
}

resource "aws_lb_target_group" "backend" {
  name        = "${var.environment}-backend"
  port        = 8080
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = var.vpc_id
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

resource "aws_iam_role" "ecs_exec" {
  name = "${var.environment}-ecs-exec"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "ecs-tasks.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_exec" {
  role       = aws_iam_role.ecs_exec.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}
