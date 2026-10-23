# ─── CloudFront Distribution for Frontend Static Hosting (#1092) ────────────
#
# Serves the frontend SPA from an S3 bucket via CloudFront with:
#   - Origin Access Control (OAC) — the modern replacement for OAI
#   - ACM certificate in us-east-1 (required by CloudFront)
#   - HTTP → HTTPS redirect
#   - Two-tier cache policy: HTML never cached, hashed assets cached 1 year
#   - Security headers policy (CSP, HSTS, X-Frame-Options, etc.)
#   - AWS Managed Rules WAF WebACL attached to the distribution
#   - Route53 alias record for the custom domain (app.{domain_name})

# ─── S3 Bucket ───────────────────────────────────────────────────────────────

resource "aws_s3_bucket" "frontend" {
  bucket = "${var.environment}-vesting-frontend-${data.aws_caller_identity.current.account_id}"

  tags = {
    Name        = "${var.environment}-vesting-frontend"
    Environment = var.environment
  }
}

resource "aws_s3_bucket_versioning" "frontend" {
  bucket = aws_s3_bucket.frontend.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "frontend" {
  bucket = aws_s3_bucket.frontend.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "frontend" {
  bucket = aws_s3_bucket.frontend.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Lifecycle rule: remove old object versions after 90 days to control cost
resource "aws_s3_bucket_lifecycle_configuration" "frontend" {
  bucket = aws_s3_bucket.frontend.id

  rule {
    id     = "expire-old-versions"
    status = "Enabled"

    noncurrent_version_expiration {
      noncurrent_days = 90
    }
  }
}

# Allow CloudFront OAC to read from the bucket.
# The bucket policy explicitly denies all requests that do not originate from
# this distribution's OAC, so even a valid AWS request from another principal
# is denied.
data "aws_iam_policy_document" "frontend_bucket" {
  statement {
    sid    = "AllowCloudFrontOAC"
    effect = "Allow"

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.frontend.arn}/*"]

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.frontend.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "frontend" {
  bucket = aws_s3_bucket.frontend.id
  policy = data.aws_iam_policy_document.frontend_bucket.json

  # The distribution must exist before the bucket policy references its ARN.
  depends_on = [aws_cloudfront_distribution.frontend]
}

# ─── ACM Certificate (us-east-1) ─────────────────────────────────────────────
#
# CloudFront requires ACM certificates in us-east-1 regardless of the provider's
# default region. A dedicated provider alias is used for this single resource.

provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"

  default_tags {
    tags = merge({
      Project     = var.project_name
      Application = "vesting-cliff-drip-stream"
      Environment = var.environment
      ManagedBy   = "terraform"
    }, var.additional_tags)
  }
}

resource "aws_acm_certificate" "frontend" {
  provider          = aws.us_east_1
  domain_name       = local.frontend_domain
  validation_method = "DNS"

  subject_alternative_names = [
    "www.${local.frontend_domain}"
  ]

  # Generate a new certificate before destroying the old one so CloudFront
  # always has a valid cert during a rotation.
  lifecycle {
    create_before_destroy = true
  }

  tags = {
    Name        = "${var.environment}-vesting-frontend"
    Environment = var.environment
  }
}

resource "aws_route53_record" "frontend_cert_validation" {
  for_each = {
    for dvo in aws_acm_certificate.frontend.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  }

  zone_id         = module.dns.zone_id
  name            = each.value.name
  type            = each.value.type
  ttl             = 60
  records         = [each.value.record]
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "frontend" {
  provider                = aws.us_east_1
  certificate_arn         = aws_acm_certificate.frontend.arn
  validation_record_fqdns = [for record in aws_route53_record.frontend_cert_validation : record.fqdn]
}

# ─── CloudFront Origin Access Control ────────────────────────────────────────

resource "aws_cloudfront_origin_access_control" "frontend" {
  name                              = "${var.environment}-vesting-frontend-oac"
  description                       = "OAC for ${var.environment} vesting frontend S3 bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# ─── Cache Policies ──────────────────────────────────────────────────────────

# HTML documents: never cache. The SPA shell (index.html) must always be fresh
# so users pick up new releases instantly. The CDN still connects (200/304) but
# does not serve stale HTML.
resource "aws_cloudfront_cache_policy" "html_no_store" {
  name        = "${var.environment}-vesting-html-no-store"
  comment     = "No caching for HTML documents — always fetch from S3"
  default_ttl = 0
  max_ttl     = 0
  min_ttl     = 0

  parameters_in_cache_key_and_forwarded_to_origin {
    cookies_config {
      cookie_behavior = "none"
    }
    headers_config {
      header_behavior = "none"
    }
    query_strings_config {
      query_string_behavior = "none"
    }
    enable_accept_encoding_gzip   = true
    enable_accept_encoding_brotli = true
  }
}

# Hashed assets (JS/CSS/images with a content hash in the filename): cache for
# one year. The content hash changes on every deploy, so there is never a stale
# asset. This is the standard "immutable" caching strategy for bundled SPAs.
resource "aws_cloudfront_cache_policy" "assets_immutable" {
  name        = "${var.environment}-vesting-assets-immutable"
  comment     = "1-year cache for content-hashed JS/CSS/image assets"
  default_ttl = 31536000 # 1 year
  max_ttl     = 31536000
  min_ttl     = 31536000

  parameters_in_cache_key_and_forwarded_to_origin {
    cookies_config {
      cookie_behavior = "none"
    }
    headers_config {
      header_behavior = "none"
    }
    query_strings_config {
      query_string_behavior = "none"
    }
    enable_accept_encoding_gzip   = true
    enable_accept_encoding_brotli = true
  }
}

# ─── Response Headers Policy ─────────────────────────────────────────────────
#
# CSP allows:
#   - Soroban RPC endpoints (soroban-testnet / mainnet)
#   - Horizon API (horizon-testnet / mainnet)
#   - Stellar Expert explorer
#   - Freighter / LOBSTR wallet extensions (via extension scheme)
#
# Adjust script-src / connect-src as new RPC providers are added.

resource "aws_cloudfront_response_headers_policy" "frontend" {
  name    = "${var.environment}-vesting-security-headers"
  comment = "Security headers for the vesting frontend SPA"

  security_headers_config {
    # HSTS: 1 year, include subdomains, eligible for preloading
    strict_transport_security {
      access_control_max_age_sec = 31536000
      include_subdomains         = true
      preload                    = true
      override                   = true
    }

    # Deny framing from any origin — the SPA has no iframe use-cases
    frame_options {
      frame_option = "DENY"
      override     = true
    }

    # Prevent MIME-type sniffing
    content_type_options {
      override = true
    }

    # Only send the origin when crossing protocol boundaries
    referrer_policy {
      referrer_policy = "strict-origin-when-cross-origin"
      override        = true
    }

    # CSP: restrict script/style origins; allow Stellar network endpoints
    content_security_policy {
      content_security_policy = join("; ", [
        "default-src 'self'",
        # Scripts: self + inline hashes added by the build tool at deploy time
        "script-src 'self' 'unsafe-inline'",
        # Styles: self + inline (required by many CSS-in-JS approaches)
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        # Fonts
        "font-src 'self' https://fonts.gstatic.com",
        # Images: self + data URIs for SVG icons
        "img-src 'self' data: https:",
        # XHR / fetch / WebSocket connections: Soroban RPC, Horizon, Stellar Expert
        join(" ", [
          "connect-src 'self'",
          "https://soroban-testnet.stellar.org",
          "https://horizon-testnet.stellar.org",
          "https://soroban-mainnet.stellar.org",
          "https://horizon-mainnet.stellar.org",
          "https://horizon.stellar.org",
          "https://mainnet.stellar.validationcloud.io",
          "https://stellar.expert",
          "https://api.stellar.expert",
          "wss://horizon-testnet.stellar.org",
          "wss://horizon.stellar.org",
        ]),
        # Media
        "media-src 'none'",
        # Object / embed
        "object-src 'none'",
        # Forms must stay on-origin
        "form-action 'self'",
        # Base URI locked to self
        "base-uri 'self'",
        # Upgrade insecure requests (belt-and-suspenders HTTPS enforcement)
        "upgrade-insecure-requests",
      ])
      override = true
    }
  }

  # Tell browsers not to store sensitive pages in their cache
  custom_headers_config {
    items {
      header   = "Permissions-Policy"
      value    = "camera=(), microphone=(), geolocation=(), interest-cohort=()"
      override = true
    }
  }
}

# ─── WAF WebACL (us-east-1) ──────────────────────────────────────────────────
#
# CloudFront WAF WebACLs must be created in us-east-1.
# Attaches the four core AWS Managed Rule Groups that cover the OWASP Top 10.

resource "aws_wafv2_web_acl" "frontend" {
  provider    = aws.us_east_1
  name        = "${var.environment}-vesting-frontend-waf"
  description = "WAF WebACL for the vesting frontend CloudFront distribution"
  scope       = "CLOUDFRONT"

  default_action {
    allow {}
  }

  # ── Rule 1: AWS Common Rule Set ────────────────────────────────────────────
  rule {
    name     = "AWSManagedRulesCommonRuleSet"
    priority = 10

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
      metric_name                = "${var.environment}-vesting-frontend-waf-common"
      sampled_requests_enabled   = true
    }
  }

  # ── Rule 2: Known Bad Inputs ───────────────────────────────────────────────
  rule {
    name     = "AWSManagedRulesKnownBadInputsRuleSet"
    priority = 20

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesKnownBadInputsRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.environment}-vesting-frontend-waf-bad-inputs"
      sampled_requests_enabled   = true
    }
  }

  # ── Rule 3: Amazon IP Reputation List ─────────────────────────────────────
  rule {
    name     = "AWSManagedRulesAmazonIpReputationList"
    priority = 30

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesAmazonIpReputationList"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.environment}-vesting-frontend-waf-ip-reputation"
      sampled_requests_enabled   = true
    }
  }

  # ── Rule 4: Rate limiting ──────────────────────────────────────────────────
  rule {
    name     = "RateLimit"
    priority = 40

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
      metric_name                = "${var.environment}-vesting-frontend-waf-rate-limit"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${var.environment}-vesting-frontend-waf"
    sampled_requests_enabled   = true
  }

  tags = {
    Name        = "${var.environment}-vesting-frontend-waf"
    Environment = var.environment
  }
}

# ─── CloudFront Distribution ─────────────────────────────────────────────────

resource "aws_cloudfront_distribution" "frontend" {
  enabled             = true
  is_ipv6_enabled     = true
  http_version        = "http2and3"
  price_class         = "PriceClass_100" # US, Canada, Europe
  default_root_object = "index.html"
  web_acl_id          = aws_wafv2_web_acl.frontend.arn
  aliases             = [local.frontend_domain]

  comment = "${var.environment} vesting frontend"

  origin {
    domain_name              = aws_s3_bucket.frontend.bucket_regional_domain_name
    origin_id                = "s3-frontend"
    origin_access_control_id = aws_cloudfront_origin_access_control.frontend.id
  }

  # ── Default behaviour: HTML documents ────────────────────────────────────
  # index.html and any path that falls through to the SPA must never be cached.
  default_cache_behavior {
    target_origin_id           = "s3-frontend"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD", "OPTIONS"]
    cached_methods             = ["GET", "HEAD"]
    cache_policy_id            = aws_cloudfront_cache_policy.html_no_store.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.frontend.id
    compress                   = true
  }

  # ── Hashed assets: JS, CSS, images, fonts, WASM ──────────────────────────
  # Files whose names include a content hash are safe to cache for a year.
  # The path pattern matches the Vite/webpack default output layout.
  ordered_cache_behavior {
    path_pattern               = "/assets/*"
    target_origin_id           = "s3-frontend"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    cache_policy_id            = aws_cloudfront_cache_policy.assets_immutable.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.frontend.id
    compress                   = true
  }

  # ── SPA fallback: return index.html for unknown paths ─────────────────────
  # React Router / client-side routing relies on this: a direct load of
  # /dashboard or /stream/123 must resolve to the SPA shell.
  custom_error_response {
    error_code            = 403
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 0
  }

  custom_error_response {
    error_code            = 404
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 0
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.frontend.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  restrictions {
    geo_restriction {
      restriction_type = length(var.waf_sanctioned_country_codes) > 0 ? "blacklist" : "none"
      locations        = var.waf_sanctioned_country_codes
    }
  }

  # Access logs: one prefix per environment so multiple environments can share
  # a logging bucket if needed.
  logging_config {
    bucket          = aws_s3_bucket.cloudfront_logs.bucket_domain_name
    prefix          = "${var.environment}/"
    include_cookies = false
  }

  tags = {
    Name        = "${var.environment}-vesting-frontend"
    Environment = var.environment
  }

  depends_on = [
    aws_acm_certificate_validation.frontend,
    aws_wafv2_web_acl.frontend,
  ]
}

# ─── CloudFront Access Logs Bucket ───────────────────────────────────────────

resource "aws_s3_bucket" "cloudfront_logs" {
  bucket = "${var.environment}-vesting-cf-logs-${data.aws_caller_identity.current.account_id}"

  tags = {
    Name        = "${var.environment}-vesting-cf-logs"
    Environment = var.environment
  }
}

resource "aws_s3_bucket_public_access_block" "cloudfront_logs" {
  bucket = aws_s3_bucket.cloudfront_logs.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "cloudfront_logs" {
  bucket = aws_s3_bucket.cloudfront_logs.id

  rule {
    # CloudFront delivers access logs using the bucket-owner-full-control ACL,
    # which requires BucketOwnerPreferred ownership.
    object_ownership = "BucketOwnerPreferred"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "cloudfront_logs" {
  bucket = aws_s3_bucket.cloudfront_logs.id

  rule {
    id     = "expire-cf-logs"
    status = "Enabled"

    expiration {
      days = var.waf_log_retention_days
    }
  }
}

# ─── Route53 DNS Record ──────────────────────────────────────────────────────

resource "aws_route53_record" "frontend" {
  zone_id = module.dns.zone_id
  name    = local.frontend_domain
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.frontend.domain_name
    zone_id                = aws_cloudfront_distribution.frontend.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "frontend_aaaa" {
  zone_id = module.dns.zone_id
  name    = local.frontend_domain
  type    = "AAAA"

  alias {
    name                   = aws_cloudfront_distribution.frontend.domain_name
    zone_id                = aws_cloudfront_distribution.frontend.hosted_zone_id
    evaluate_target_health = false
  }
}

# ─── Locals ──────────────────────────────────────────────────────────────────

locals {
  # The frontend is served from the apex domain for production and from a
  # subdomain for staging, matching the API's pattern.
  frontend_domain = "app.${var.domain_name}"
}

# ─── Data sources ────────────────────────────────────────────────────────────

data "aws_caller_identity" "current" {}
