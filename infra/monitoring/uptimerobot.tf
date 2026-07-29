# UptimeRobot monitors via Terraform (MFO provider).
# Provider docs: https://registry.terraform.io/providers/vexxhost/uptimerobot/latest

terraform {
  required_providers {
    uptimerobot = {
      source  = "vexxhost/uptimerobot"
      version = "~> 0.8"
    }
  }
}

variable "uptimerobot_api_key" {
  description = "UptimeRobot main API key"
  type        = string
  sensitive   = true
}

variable "slack_webhook_url" {
  description = "Slack incoming webhook URL for alerts"
  type        = string
  sensitive   = true
}

# Alert contact — Slack
resource "uptimerobot_alert_contact" "slack" {
  friendly_name = "vesting-slack"
  type          = 11   # Slack
  value         = var.slack_webhook_url
}

locals {
  alert_contacts = [uptimerobot_alert_contact.slack.id]
  interval       = 60  # 1-minute check interval
}

# API health endpoint
resource "uptimerobot_monitor" "api_health" {
  friendly_name  = "Vesting API — health"
  type           = "http"
  url            = "https://api.vesting.example.com/health"
  interval       = local.interval
  alert_contacts = local.alert_contacts
}

# WebSocket connectivity
resource "uptimerobot_monitor" "websocket" {
  friendly_name  = "Vesting — WebSocket"
  type           = "keyword"
  url            = "https://ws.vesting.example.com/ping"
  keyword_type   = 1
  keyword_value  = "pong"
  interval       = local.interval
  alert_contacts = local.alert_contacts
}

# Indexer lag metric (HTTP probe on metrics endpoint)
resource "uptimerobot_monitor" "indexer_lag" {
  friendly_name  = "Vesting — indexer lag"
  type           = "keyword"
  url            = "https://api.vesting.example.com/metrics/indexer"
  keyword_type   = 2    # keyword must NOT be present
  keyword_value  = "lag_critical"
  interval       = local.interval
  alert_contacts = local.alert_contacts
}
