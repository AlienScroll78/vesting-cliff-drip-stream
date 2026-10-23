# ─── GitHub Actions OIDC Role (No static AWS keys) ───────────────────────────
#
# Provides passwordless, temporary credentials for GitHub Actions workflows via
# OpenID Connect (OIDC). Eliminates static IAM access keys in GitHub secrets.

resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = [
    "6938fd4d98bab03faadb97b34396831e3780aea1",
    "1c58a3a8518e8759bf075b76b750d4f8d264fcd9"
  ]

  tags = {
    Name        = "github-actions-oidc"
    Environment = var.environment
    ManagedBy   = "terraform"
    Project     = var.project_name
  }
}

data "aws_iam_policy_document" "github_actions_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values = [
        "repo:AlienScroll78/vesting-cliff-drip-stream:*",
        "repo:Code-Cut/vesting-cliff-drip-stream:*"
      ]
    }
  }
}

resource "aws_iam_role" "github_actions" {
  name               = "${var.environment}-github-actions-deploy"
  description        = "Least-privilege role for GitHub Actions deployments without static keys"
  assume_role_policy = data.aws_iam_policy_document.github_actions_assume_role.json

  tags = {
    Name        = "${var.environment}-github-actions-deploy"
    Environment = var.environment
    ManagedBy   = "terraform"
    Project     = var.project_name
  }
}

data "aws_iam_policy_document" "github_actions_permissions" {
  statement {
    sid    = "EcsDeployments"
    effect = "Allow"
    actions = [
      "ecs:DescribeServices",
      "ecs:DescribeTaskDefinition",
      "ecs:DescribeTasks",
      "ecs:RegisterTaskDefinition",
      "ecs:UpdateService"
    ]
    resources = ["*"]
  }

  statement {
    sid    = "EcrImagePushPull"
    effect = "Allow"
    actions = [
      "ecr:GetAuthorizationToken",
      "ecr:BatchCheckLayerAvailability",
      "ecr:GetDownloadUrlForLayer",
      "ecr:BatchGetImage",
      "ecr:PutImage",
      "ecr:InitiateLayerUpload",
      "ecr:UploadLayerPart",
      "ecr:CompleteLayerUpload"
    ]
    resources = ["*"]
  }

  statement {
    sid    = "CloudWatchObservability"
    effect = "Allow"
    actions = [
      "logs:DescribeLogGroups",
      "logs:DescribeLogStreams",
      "logs:GetLogEvents"
    ]
    resources = ["*"]
  }

  statement {
    sid    = "TerraformRemoteStateAccess"
    effect = "Allow"
    actions = [
      "s3:GetObject",
      "s3:PutObject",
      "s3:ListBucket"
    ]
    resources = [
      "arn:aws:s3:::vestingdrips-terraform-state-${var.environment}",
      "arn:aws:s3:::vestingdrips-terraform-state-${var.environment}/*"
    ]
  }

  statement {
    sid    = "TerraformStateLocking"
    effect = "Allow"
    actions = [
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:DeleteItem"
    ]
    resources = [
      "arn:aws:dynamodb:*:*:table/vestingdrips-terraform-locks-${var.environment}",
      "arn:aws:dynamodb:*:*:table/vesting-tf-locks"
    ]
  }
}

resource "aws_iam_role_policy" "github_actions" {
  name   = "${var.environment}-github-actions-policy"
  role   = aws_iam_role.github_actions.id
  policy = data.aws_iam_policy_document.github_actions_permissions.json
}
