# AWS Secrets Manager — Setup Guide

## Create secrets

```bash
aws secretsmanager create-secret --name vesting/db-password \
  --secret-string '{"password":"CHANGE_ME"}'

aws secretsmanager create-secret --name vesting/rpc-key \
  --secret-string '{"key":"CHANGE_ME"}'

aws secretsmanager create-secret --name vesting/jwt-secret \
  --secret-string '{"secret":"CHANGE_ME"}'
```

## Attach IAM policy to ECS task role

```bash
aws iam put-role-policy \
  --role-name <ECS_TASK_ROLE> \
  --policy-name VestingSecretsAccess \
  --policy-document file://iam-policy.json
```

Replace `ACCOUNT_ID` in `iam-policy.json` with your AWS account ID first.

## Enable rotation (DB password)

```bash
aws secretsmanager rotate-secret \
  --secret-id vesting/db-password \
  --rotation-lambda-arn arn:aws:lambda:us-east-1:ACCOUNT_ID:function:vesting-secret-rotation \
  --rotation-rules AutomaticallyAfterDays=30
```

The rotation Lambda must implement the Secrets Manager rotation contract.
See: https://docs.aws.amazon.com/secretsmanager/latest/userguide/rotating-secrets.html
