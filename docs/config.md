# Configuration Reference

All configuration is supplied via environment variables. Copy `.env.example` to `.env` and fill in the required values before starting the service.

---

## Required Variables

| Variable | Type | Description |
|---|---|---|
| `HORIZON_URL` | `string` (URL) | Horizon REST API endpoint. Use `https://horizon-testnet.stellar.org` for testnet or `https://horizon.stellar.org` for mainnet. |
| `NETWORK_PASSPHRASE` | `string` | Stellar network passphrase. Must match the network your contract is deployed on. |
| `CONTRACT_ID` | `string` | Soroban contract address of the deployed `vesting_cliff_drip_stream` contract (starts with `C`). |

---

## Required Variables (admin / bulk-claim only)

These are only required if you run the `POST /admin/bulk-claim` endpoint.

| Variable | Type | Description |
|---|---|---|
| `ADMIN_API_KEY` | `string` (secret) | Bearer token that callers must supply in `Authorization: Bearer <key>`. Use a strong random value (≥ 32 bytes). Store in AWS Secrets Manager or equivalent. |
| `SPONSOR_SECRET_KEY` | `string` (secret) | Stellar secret key (`S...`) of the account that signs claim transactions on behalf of recipients. Never commit this value. |
| `SOROBAN_RPC_URL` | `string` (URL) | Soroban RPC endpoint for transaction submission. Defaults to the RPC path on the same host as `HORIZON_URL` (e.g. `http://localhost:8000/soroban/rpc`). |

---

## Optional Variables

| Variable | Type | Default | Description |
|---|---|---|---|
| `PORT` | `number` | `3000` | TCP port the HTTP server listens on. |
| `LOG_LEVEL` | `string` | `info` | Logging verbosity. Accepted values: `debug`, `info`, `warn`, `error`. |
| `REQUEST_TIMEOUT_MS` | `number` | `30000` | Maximum milliseconds to wait for a Soroban RPC response before aborting. |

---

## Startup Validation

The service validates all required environment variables on startup. If any are missing it logs a clear error and exits with code 1:

```
Error: Missing required environment variables: CONTRACT_ID, NETWORK_PASSPHRASE.
See docs/config.md for details.
```

This prevents silent misconfiguration in production deployments.

---

## Example Values

### Testnet

```dotenv
HORIZON_URL=https://horizon-testnet.stellar.org
SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
NETWORK_PASSPHRASE=Test SDF Network ; September 2015
CONTRACT_ID=CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

### Local quickstart

```dotenv
HORIZON_URL=http://localhost:8000
SOROBAN_RPC_URL=http://localhost:8000/soroban/rpc
NETWORK_PASSPHRASE=Standalone Network ; February 2017
CONTRACT_ID=CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

### Mainnet

```dotenv
HORIZON_URL=https://horizon.stellar.org
SOROBAN_RPC_URL=https://soroban.stellar.org
NETWORK_PASSPHRASE=Public Global Stellar Network ; September 2015
CONTRACT_ID=CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

---

## Security Notes

- `ADMIN_API_KEY` and `SPONSOR_SECRET_KEY` are secrets. Store them in a secrets manager (AWS Secrets Manager, HashiCorp Vault, etc.) and inject them at runtime. See `infra/secrets/` for the AWS Secrets Manager setup.
- Never commit `.env` to version control. It is listed in `.gitignore`.
- Rotate `ADMIN_API_KEY` periodically. Old keys are immediately invalid once the environment variable is updated and the service restarts.
