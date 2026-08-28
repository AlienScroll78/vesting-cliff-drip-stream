output "zone_id" {
  description = "Route53 zone ID"
  value       = aws_route53_zone.main.zone_id
}

output "zone_name_servers" {
  description = "Route53 zone name servers"
  value       = aws_route53_zone.main.name_servers
}
