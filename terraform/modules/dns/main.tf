resource "aws_route53_zone" "main" {
  name = var.zone_name

  tags = {
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

resource "aws_route53_record" "api" {
  zone_id = aws_route53_zone.main.zone_id
  name    = "api.${var.zone_name}"
  type    = "A"

  alias {
    name                   = var.alb_dns_name
    zone_id                = var.alb_zone_id
    evaluate_target_health = true
  }
}

resource "aws_route53_record" "app" {
  zone_id = aws_route53_zone.main.zone_id
  name    = "app.${var.zone_name}"
  type    = "CNAME"
  ttl     = 300
  records = ["api.${var.zone_name}"]
}

resource "aws_route53_record" "vault" {
  count   = var.environment == "production" ? 1 : 0
  zone_id = aws_route53_zone.main.zone_id
  name    = "vault.${var.zone_name}"
  type    = "CNAME"
  ttl     = 300
  records = ["api.${var.zone_name}"]
}
