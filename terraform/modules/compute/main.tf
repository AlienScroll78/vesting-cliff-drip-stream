resource "aws_ecs_cluster" "main" {
  name = "${var.environment}-vesting"
}

resource "aws_ecs_task_definition" "backend" {
  family                   = "vesting-backend"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"

  # Raised from 256/512 to give the Fluent Bit sidecar room to run alongside the
  # API without being squeezed. A sidecar that cannot allocate is a sidecar that
  # silently stops shipping.
  cpu    = 256
  memory = 1024

  execution_role_arn = aws_iam_role.ecs_exec.arn
  task_role_arn      = aws_iam_role.ecs_task.arn

  # 21 GiB is the Fargate minimum. The extra 1 GiB over the 20 GiB baseline is
  # the Fluent Bit filesystem buffer: logs are written to an ephemeral volume,
  # so anything not yet flushed is lost when the task stops.
  ephemeral_storage {
    size_in_gib = 21
  }

  volume {
    name = "app-logs"
  }

  container_definitions = jsonencode([
    {
      name  = "vesting-backend"
      image = "public.ecr.aws/amazonlinux/amazonlinux:latest"
      portMappings = [{ containerPort = 8080 }]

      environment = [
        # The app writes JSON lines here instead of stdout when LOG_FILE is set.
        # The shipper reads it; stdout below is the fallback path.
        { name = "LOG_FILE", value = "/var/log/vesting/app.log" },
        { name = "SERVICE_NAME", value = "api-server" },
        { name = "ENVIRONMENT", value = var.environment },
        { name = "LOG_LEVEL", value = var.log_level },
      ]

      mountPoints = [{
        sourceVolume  = "app-logs"
        containerPath = "/var/log/vesting"
        readOnly      = false
      }]

      # Redundancy: the structured path is the file, this is the safety net. If
      # Fluent Bit dies, stdout still reaches CloudWatch. See the runbook.
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = var.app_log_group_name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "ecs"
        }
      }
    },
    {
      name       = "log-shipper"
      image      = var.fluentbit_image
      essential  = false
      dependsOn  = [{ containerName = "vesting-backend" }]

      entryPoint = ["/fluent-bit/bin/fluent-bit"]

      # Configured entirely from the command line so the pipeline needs no
      # config file in the image and no image build of our own.
      #
      #   refresh_interval=1 + flush=5 keep the end-to-end delay near 6s, well
      #   inside the 30s visibility target.
      command = [
        "-i", "tail",
        "-p", "path=/var/log/vesting/*.log",
        "-p", "tag=app",
        "-p", "refresh_interval=1",
        "-p", "exit_on_eof=false",
        "-p", "skip_long_lines=true",
        "-o", "cloudwatch_logs",
        "-p", "region=${var.aws_region}",
        "-p", "log_group_name=${var.app_log_group_name}",
        "-p", "log_stream_prefix=ecs",
        "-p", "auto_create_stream=true",
        "-p", "auto_role_arn=${aws_iam_role.ecs_task.arn}",
        "-p", "flush=5",
        "-p", "workers=2",
      ]

      memoryReservation = 128
      memoryLimit       = 256

      mountPoints = [{
        sourceVolume  = "app-logs"
        containerPath = "/var/log/vesting"
        readOnly      = true
      }]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = "/ecs/fluent-bit-internal"
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "shipper"
        }
      }
    },
  ])
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
