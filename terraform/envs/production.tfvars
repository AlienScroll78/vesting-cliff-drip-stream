environment = "production"
aws_region  = "us-east-1"
domain_name = "vesting.example.com"
monthly_budget_limit_usd = 500

# Production needs the extra CPU and memory; the instance is single-AZ and
# sized to the budget, not to headroom.
db_instance_class = "db.t3.small"
