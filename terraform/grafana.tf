# ─────────────────────────────────────────────────────────────────────────────
# Grafana managed workspace + operational dashboard
#
# Deploys an Amazon Managed Grafana workspace and uploads the
# monitoring/grafana-dashboard.json dashboard for vesting-backend
# operational monitoring.
#
# Prerequisites:
#   - The aws_grafana provider requires Grafana workspace V2 (AMG).
#   - Set var.grafana_admin_ids to the list of SSO user IDs that should
#     receive admin access.
# ─────────────────────────────────────────────────────────────────────────────

# ── Variables ─────────────────────────────────────────────────────────────────

variable "grafana_admin_ids" {
  description = "List of AWS SSO user IDs to grant Grafana admin access"
  type        = list(string)
  default     = []
}

variable "grafana_workspace_name" {
  description = "Name for the Amazon Managed Grafana workspace"
  type        = string
  default     = "vesting-backend-monitoring"
}

# ── IAM role for Grafana ──────────────────────────────────────────────────────

resource "aws_iam_role" "grafana" {
  name = "${var.environment}-grafana-workspace-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect    = "Allow"
        Principal = { Service = "grafana.amazonaws.com" }
        Action    = "sts:AssumeRole"
      }
    ]
  })

  tags = {
    Name    = "${var.environment}-grafana-workspace-role"
    Purpose = "Amazon Managed Grafana workspace IAM role"
  }
}

resource "aws_iam_role_policy_attachment" "grafana_cloudwatch" {
  role       = aws_iam_role.grafana.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonGrafanaCloudWatchAccess"
}

# ── Grafana workspace ─────────────────────────────────────────────────────────

resource "aws_grafana_workspace" "main" {
  name                     = "${var.environment}-${var.grafana_workspace_name}"
  account_access_type      = "CURRENT_ACCOUNT"
  authentication_providers = ["AWS_SSO"]
  permission_type          = "SERVICE_MANAGED"
  role_arn                 = aws_iam_role.grafana.arn

  data_sources = ["PROMETHEUS", "CLOUDWATCH"]

  description = "Operational monitoring for vesting-backend (${var.environment})"

  tags = {
    Name        = "${var.environment}-${var.grafana_workspace_name}"
    Environment = var.environment
    Purpose     = "vesting-backend operational monitoring"
  }
}

# ── Grafana role associations (admin users) ───────────────────────────────────

resource "aws_grafana_role_association" "admins" {
  count        = length(var.grafana_admin_ids) > 0 ? 1 : 0
  role         = "ADMIN"
  user_ids     = var.grafana_admin_ids
  workspace_id = aws_grafana_workspace.main.id
}

# ── Grafana dashboard ─────────────────────────────────────────────────────────

resource "aws_grafana_dashboard" "vesting_backend_ops" {
  workspace_id  = aws_grafana_workspace.main.id
  # Read the dashboard JSON from the monitoring/ directory
  config_json   = file("${path.root}/../monitoring/grafana-dashboard.json")
  # Folder 0 = General (default Grafana folder)
  folder_id     = 0

  depends_on = [aws_grafana_workspace.main]
}

# ── Outputs ───────────────────────────────────────────────────────────────────

output "grafana_workspace_endpoint" {
  description = "URL endpoint for the Grafana workspace"
  value       = "https://${aws_grafana_workspace.main.endpoint}"
}

output "grafana_workspace_id" {
  description = "ID of the Amazon Managed Grafana workspace"
  value       = aws_grafana_workspace.main.id
}
