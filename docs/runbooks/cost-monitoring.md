# Cloud Cost Monitoring Runbook

Terraform applies these required allocation tags to supported AWS resources:
`Application`, `Environment`, `ManagedBy`, and `Repository`. Supply
`additional_tags` with at least `CostCenter` and `Owner` for each environment;
activate those tags in AWS Billing Cost Allocation Tags before relying on them
in Cost Explorer.

The `terraform/cost-monitoring.tf` configuration provides:

- an 80% forecast and 100% actual monthly AWS Budget alert;
- a daily Cost Explorer anomaly monitor by AWS service (USD 25 threshold);
- a CloudWatch dashboard with account estimated charges.

Set `cost_alert_emails` and `monthly_budget_limit_usd` in the environment's
secure Terraform variable source. Confirm recipients accept the SNS-style
subscription/notification email where AWS requires it.

## Alert response

1. Open Cost Explorer and group the affected period by **Service**, then by
   `CostCenter` and `Owner` allocation tags.
2. Compare the spike against deploys, RDS storage/backups, NAT data transfer,
   ECS task count, and CloudWatch log ingestion.
3. Stop or scale down non-production resources only after confirming impact.
4. Record the anomaly, owner, and remediation in the incident channel. Raise
   the budget only after the expected recurring cost is approved.
5. Review budget, anomaly threshold, and active allocation tags monthly.
