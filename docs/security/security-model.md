# Security Model — Vesting Cliff Drip Stream

**Version:** 1.0.0
**Date:** 2026-07-30
**Status:** Active

> For vulnerability reporting, see [SECURITY.md](../../SECURITY.md).
> For CodeQL alert suppression guidance, see [codeql-suppression.md](./codeql-suppression.md).

---

## Table of Contents

1. [Scope](#1-scope)
2. [Trust Assumptions](#2-trust-assumptions)
3. [Threat Model](#3-threat-model)
   - 3.1 [Sponsor Scenarios](#31-sponsor-scenarios)
   - 3.2 [Recipient Scenarios](#32-recipient-scenarios)
   - 3.3 [Third-Party Attacker Scenarios](#33-third-party-attacker-scenarios)
   - 3.4 [Backend API Threat Scenarios](#34-backend-api-threat-scenarios)
4. [Attack Surface Analysis](#4-attack-surface-analysis)
   - 4.1 [Reentrancy](#41-reentrancy)
   - 4.2 [Integer Overflow and Underflow](#42-integer-overflow-and-underflow)
   - 4.3 [Authentication and Authorization Bypass](#43-authentication-and-authorization-bypass)
   - 4.4 [Storage Exhaustion](#44-storage-exhaustion)
   - 4.5 [Token Contract Risk](#45-token-contract-risk)
   - 4.6 [Backend API Surface](#46-backend-api-surface)
5. [Mitigation Mapping](#5-mitigation-mapping)
6. [Known Limitations and Accepted Risks](#6-known-limitations-and-accepted-risks)
7. [Vulnerability Disclosure](#7-vulnerability-disclosure)
8. [Review and Sign-off](#8-review-and-sign-off)

---

## 1. Scope

This document covers the security model for two distinct components that together form the Vesting Cliff Drip Stream system:

**Smart Contract (`src/contract.rs`)** — A Soroban WASM contract deployed on the Stellar network. It holds token custody and enforces the cliff-vesting schedule on-chain. All state transitions are atomic and deterministic.

**Backend API (`backend/src/`)** — A Node.js/TypeScript service that indexes on-chain events, caches schedule state, exposes REST and GraphQL endpoints, and optionally signs and submits Soroban transactions on behalf of users.

Out of scope for this document: Stellar network-level security, Stellar Horizon reliability, the frontend application, and individual user wallet key management.

---

## 2. Trust Assumptions

These are the foundational assumptions the security model relies on. Violations of any assumption may invalidate the mitigations described in later sections.

### 2.1 Blockchain Layer

| Assumption | Justification |
|---|---|
| The Stellar network and its consensus protocol are honest. | We inherit this from Stellar's federated Byzantine agreement. No additional trust required. |
| Soroban's host environment correctly enforces `require_auth()`. | Verified by Stellar core. Tests in `test_auth.rs` confirm enforcement at the contract level. |
| Ledger sequence numbers advance monotonically and cannot be manipulated by a contract caller. | Property of the Soroban host; `env.ledger().sequence()` is read-only from contract code. |
| XDR serialisation and deserialisation of `VestingSchedule` are deterministic. | Guaranteed by `#[contracttype]` and the Soroban SDK. Schema versioning (`version` field) guards against future format drift. |

### 2.2 Token (SAC) Assumptions

| Assumption | Justification |
|---|---|
| The token passed to `create_vesting_stream` is a legitimate Stellar Asset Contract (SAC). | The contract does not verify this; a malicious token could behave arbitrarily. Sponsors are responsible for using trusted SAC addresses. |
| `clawback_stream` is only available on tokens where the SAC issuer has set the clawback flag. | Enforced by probing `StellarAssetClient::try_clawback` at call time; failure returns `ClawbackNotSupported`. |
| The token issuer does not freeze the contract's account mid-stream. | If a token issuer freezes the contract vault, `transfer` calls will fail with `TransferFailed`. This is an accepted risk (see §6). |
| Token decimals and base-unit conventions are understood by the caller. | The contract operates entirely in raw `i128` base units; presentation is the caller's responsibility. |

### 2.3 No Admin Backdoor

**The contract has no privileged admin key that can redirect or seize tokens from an active stream.** The `admin` address introduced for `upgrade` and `transfer_admin` can only:

- Upgrade the WASM code hash (changing contract logic for future calls).
- Transfer the admin role to another address.
- Call `set_min_deposit` to adjust the minimum deposit threshold.
- Call `migrate_schedule` to stamp legacy `version = 0` entries with `version = 1`.

The admin **cannot** transfer tokens out of any vault, cancel a stream, or bypass a recipient's `require_auth()`. Only the original `sponsor` for a given stream can cancel it.

### 2.4 Backend API

| Assumption | Justification |
|---|---|
| `JWT_SECRET`, `SIGNING_SECRET_KEY`, and `ADMIN_API_KEY` are secrets stored securely (e.g., AWS Secrets Manager) and never logged. | Enforced by secret rotation policy (`infra/secrets/rotation-policy.json`) and the comment in `tx-submit.js`: "SIGNING_SECRET_KEY must never be logged or included in responses." |
| The backend process runs in an isolated container (ECS/K8s) with least-privilege IAM roles. | Enforced by Terraform IAM policy (`infra/secrets/iam-policy.json`) and Kubernetes NetworkPolicies (`k8s/network-policies/`). |
| The Soroban RPC endpoint the backend connects to is trusted. | Configured via `SOROBAN_RPC_URL`; the backend does not verify TLS certificate pinning. See §6. |

---

## 3. Threat Model

Threats are classified using a simplified STRIDE model. Each threat is tagged with a severity: **Critical**, **High**, **Medium**, or **Low**.

### 3.1 Sponsor Scenarios

These threats involve a sponsor acting maliciously or making an error.

---

**T-S1 — Sponsor cancels stream before cliff to reclaim all tokens (Medium)**

A sponsor may intentionally cancel the stream at any point before the cliff. Per the contract's documented design, pre-cliff cancellation refunds the full deposit to the sponsor. This is intended behaviour, not a bug.

*Residual risk:* Recipients cannot rely on a stream remaining active. Sponsors should be vetted by recipients before accepting a stream.

---

**T-S2 — Sponsor passes a malicious token address (High)**

A sponsor creates a stream with a token contract they control. The fake token's `transfer` could do nothing, emit false events, or re-enter the contract.

*See mitigation M-T5 (transfer-before-storage ordering) and M-T6 (Soroban reentrancy model) in §5.*

---

**T-S3 — Sponsor attempts to create a stream to themselves (Low)**

If `sponsor == recipient`, `cancel_stream` would produce ambiguous double-transfer semantics.

*Mitigation:* `InvalidRecipient` (error code 11) is returned when the two addresses are equal. See `test_create.rs`.

---

**T-S4 — Sponsor supplies overflow-inducing rate or duration (Medium)**

A very large `rate` combined with a large `total_duration` could overflow `i128` during deposit calculation.

*Mitigation:* `calculate_total_deposit` uses `checked_mul`, returning `DepositOverflow` (error 5) before any state or token transfer occurs. See §4.2 and `test_edge_cases.rs`.

---

**T-S5 — Sponsor attempts a second stream for the same recipient (Low)**

A sponsor (or any caller) tries to overwrite an existing schedule via a second `create_vesting_stream` call for the same recipient address.

*Mitigation:* `ScheduleAlreadyExists` (error 6) is returned. The existing schedule is untouched.

---

### 3.2 Recipient Scenarios

---

**T-R1 — Recipient attempts to claim before the cliff (Medium)**

A recipient calls `claim_vested` at a ledger below `cliff_ledger`.

*Mitigation:* `CliffNotReached` (error 2) is returned. No state is mutated and no tokens move.

---

**T-R2 — Recipient repeatedly claims to drain tokens faster than the rate allows (Low)**

A recipient calls `claim_vested` multiple times in quick succession hoping to claim more than accrued.

*Mitigation:* `claimable_amount` is computed as `(current_ledger.min(end_ledger) - last_claimed_ledger) × rate`. Repeated calls within the same ledger return `NothingToClaim` (error 7). `last_claimed_ledger` is only advanced after a successful transfer.

---

**T-R3 — Recipient key loss — tokens locked in vault after stream ends (Medium)**

If the recipient loses their private key, they can never call `claim_vested`. Once `end_ledger` is passed, the accrued tokens remain in the contract vault indefinitely.

*Mitigation:* `drain_expired_stream` is callable by anyone after `end_ledger + DRAIN_DELAY_LEDGERS` (~1 year at 5 s/ledger). Unclaimed tokens are returned to the original sponsor. See `test_drain.rs`.

---

**T-R4 — Recipient grief: abandoning a stream to lock sponsor funds (Low)**

A recipient intentionally never claims, hoping the sponsor cannot recover their tokens.

*Mitigation:* `cancel_stream` lets the sponsor cancel before `end_ledger`. Post-`end_ledger`, `emergency_drain` (sponsor-only) and `drain_expired_stream` (permissionless, after 1-year delay) both recover funds.

---

### 3.3 Third-Party Attacker Scenarios

---

**T-A1 — Unauthorized `create_vesting_stream` call (Critical)**

An attacker tries to create a stream using a victim sponsor's address without holding the sponsor's private key.

*Mitigation:* `sponsor.require_auth()` is called after input validation. Soroban's host enforces this: a transaction not signed by the sponsor's key will be rejected. Tested in `test_auth.rs::test_create_stream_unauthorized_caller_panics`.

---

**T-A2 — Unauthorized `claim_vested` call (Critical)**

An attacker tries to claim tokens to an address they control by passing a victim's recipient address.

*Mitigation:* `recipient.require_auth()` is enforced. The claim transfers to `recipient`, which is the address that must sign the transaction — not an arbitrary destination. Tested in `test_auth.rs::test_claim_vested_unauthorized_caller_panics`.

---

**T-A3 — Unauthorized `cancel_stream` call (Critical)**

An attacker tries to cancel a victim's stream, denying the recipient their vested tokens.

*Mitigation:* `sponsor.require_auth()` is enforced, and the schedule's stored `sponsor` field is **not** checked at call time — only the Soroban auth host check matters for `cancel_stream`. A caller who is not the legitimate sponsor will fail auth. Tested in `test_auth.rs::test_cancel_stream_unauthorized_caller_panics`.

---

**T-A4 — Front-running a claim transaction (Low)**

An attacker observes a pending claim transaction in the mempool and submits a competing transaction.

*Residual risk:* Soroban transactions are keyed by account sequence number and network passphrase; front-running does not allow stealing tokens. The worst case is the victim's transaction fails due to a sequence conflict and they resubmit.

---

**T-A5 — Storage key collision (Low)**

An attacker crafts an address that hashes to the same `DataKey::Schedule(address)` storage key as a legitimate recipient.

*Mitigation:* Soroban `Address` types use the full 32-byte Ed25519 public key; collisions are computationally infeasible.

---

**T-A6 — Drain-delay griefing (Low)**

An attacker calls `drain_expired_stream` on an expired stream before the legitimate recipient or sponsor notices, sending tokens to the original sponsor rather than the recipient.

*Design note:* This is the intended behaviour. The drain function is a safety valve for abandoned streams. Recipients should claim before `end_ledger` to avoid this.

---

**T-A7 — Clawback abuse (Medium)**

An attacker who gains control of the sponsor's key calls `clawback_stream` on all their funded streams.

*Mitigation:* `clawback_stream` requires `sponsor.require_auth()`. Sponsor key compromise is outside the contract's threat model, but operators should use multisig or hardware-secured keys for high-value sponsors. Additionally, clawback is only available on tokens with the SAC clawback flag set, limiting the blast radius to regulated-asset deployments.

---

### 3.4 Backend API Threat Scenarios

---

**T-B1 — JWT forgery or replay (High)**

An attacker forges a JWT to impersonate a user, or replays a captured valid JWT.

*Mitigations:* `authMiddleware` in `auth.js` verifies the JWT signature against `JWT_SECRET`. JWTs have a configurable expiry (`JWT_EXPIRY`, default 1 h). Nonces are single-use (deleted from Redis on first verification). Signature timestamps are validated within a ±5-minute window. Tested in `security.test.ts`.

---

**T-B2 — SQL injection via recipient address parameter (High)**

An attacker passes a crafted string as a `recipient` or `address` query parameter to poison SQL queries.

*Mitigations:* All Stellar addresses are validated against `/^G[A-Z2-7]{55}$/` before use. Parameterized queries are used throughout the ORM layer. Tested in `security.test.ts` (SQL injection in address parameter).

---

**T-B3 — Rate limiting bypass / DoS (Medium)**

An attacker floods the API with requests to exhaust server resources or Soroban RPC credits.

*Mitigation:* `rateLimitMiddleware` enforces sliding-window limits: 100 req/min per IP, 1000 req/min per API key, backed by Redis. The middleware fails open when Redis is unavailable. See §6 for the accepted risk of fail-open behaviour.

---

**T-B4 — SSRF via webhook URL (High)**

An attacker registers a webhook URL pointing to an internal service (e.g., `http://169.254.169.254/` AWS metadata endpoint or `http://localhost/`).

*Mitigation:* Non-HTTPS and private/loopback IP webhook URLs are rejected. Tested in `security.test.ts` (non-HTTPS webhook URL, private/loopback IP webhook URL).

---

**T-B5 — GraphQL query depth / complexity attack (Medium)**

An attacker sends a deeply nested GraphQL query to cause exponential resolver work.

*Mitigation:* `graphql-depth-limit.js` enforces a maximum query depth. Query complexity is also bounded at the resolver level.

---

**T-B6 — Oversized request body (Low)**

An attacker sends an extremely large JSON body to exhaust memory or parsing time.

*Mitigation:* Request bodies are validated for size before parsing. Tested in `security.test.ts` (oversized/missing request body).

---

**T-B7 — Admin API key leakage (Critical)**

The `ADMIN_API_KEY` used by `POST /admin/bulk-claim` is exposed in logs, error messages, or source code.

*Mitigation:* The key is loaded from environment variables via `loadConfig()` and never logged. Managed via AWS Secrets Manager with automatic rotation (`infra/secrets/rotation-policy.json`). Static analysis (CodeQL) runs on every PR.

---

## 4. Attack Surface Analysis

This section analyses each class of vulnerability and how the design addresses it.

### 4.1 Reentrancy

**Surface:** `claim_vested`, `cancel_stream`, `clawback_stream`, `emergency_drain`, and `drain_expired_stream` all call an external token contract (`token::Client::transfer` or `try_transfer`).

**Risk:** A malicious token's `transfer` implementation could call back into the vesting contract before the schedule is updated, allowing double-spending.

**Mitigation:** Two independent layers protect against this:

1. *Transfer-before-storage ordering* — All entry points perform the token transfer first, then mutate or remove the schedule. A reentrant call on the same recipient would find the schedule still present with the same `last_claimed_ledger`, resulting in the same `claimable_amount` being computed. However, the outer `try_transfer` would have already spent those tokens, so the contract vault would lack the balance for the inner transfer — causing it to fail with `TransferFailed`.
2. *Soroban execution model* — Soroban contracts execute in a single-threaded host environment. Cross-contract calls are synchronous and fully complete before control returns to the caller. There is no concept of a mid-execution callback that could interleave with the contract's own stack.

### 4.2 Integer Overflow and Underflow

**Surface:** Arithmetic in `create_vesting_stream` (deposit calculation, ledger derivation), `claim_vested` (accrual calculation), `cancel_stream` (share calculation), and `drain_expired_stream`.

**Risk:** Overflow of `i128` or `u32` values could allow a sponsor to deposit fewer tokens than recorded, or a recipient to claim more than they are owed.

**Mitigation:**

- `calculate_total_deposit` uses `rate.checked_mul(total_duration as i128)`, returning `DepositOverflow` (error 5) on overflow. The maximum safe rate for a given duration is `i128::MAX / total_duration`.
- Ledger additions (`start_ledger.checked_add(cliff_duration)`, `start_ledger.checked_add(total_duration)`) use `checked_add`, returning `DepositOverflow` on u32 wrap.
- Accrual calculations use `u32` subtraction between validated ledger fields that are always ordered (`last_claimed_ledger ≤ active_end ≤ end_ledger`), preventing underflow.
- `drain_expired_stream` uses `checked_add` for the drain delay ledger computation, returning `DepositOverflow` on u32 overflow.

Fuzz targets in `fuzz/fuzz_targets/create_vesting_stream.rs` specifically cover the `overflow` corpus entry.

### 4.3 Authentication and Authorization Bypass

**Surface:** Every state-mutating contract entry point takes an `Address` argument. The contract must ensure only the legitimate keyholder can trigger state changes.

**Risk:** An attacker supplies a victim's address as `sponsor` or `recipient` without holding the corresponding private key.

**Mitigation:** Every mutating entry point calls `<address>.require_auth()` before any storage read or token transfer. Soroban's host enforces that the transaction must be signed by the address that called `require_auth()`. This is not a software check that can be bypassed in Rust code — it is enforced by the host at the XDR/consensus layer.

View functions (`get_schedule`, `claimable_amount`, `is_cliff_passed`, `get_status`, `get_stats`) require no auth by design, as they only read public on-chain state.

The `drain_expired_stream` function deliberately requires no auth, as it is a permissionless community cleanup mechanism; tokens always flow to the recorded `sponsor`, never to the caller.

### 4.4 Storage Exhaustion

**Surface:** `create_vesting_stream` writes a new `VestingSchedule` entry to persistent storage for each recipient. An attacker could create a large number of streams to inflate storage costs.

**Risk:** On Stellar, persistent storage rent is paid by the contract deployer via minimum balance. Flooding the contract with tiny streams inflates the balance requirement.

**Mitigations:**

- `set_min_deposit` (default 100 base units) ensures each stream requires a non-trivial economic commitment from the sponsor. Creating spam streams costs the attacker real tokens.
- Each stream creation requires the sponsor to sign and fund the transaction, which has a Stellar transaction fee.
- `storage::remove_schedule` is called on stream completion, cancellation, clawback, and drain — ensuring storage entries are cleaned up and do not accumulate indefinitely.
- TTL management (`PERSISTENT_BUMP_AMOUNT = 518_400` ledgers, ~60 days) means entries for abandoned streams will eventually expire from the ledger state automatically.

### 4.5 Token Contract Risk

**Surface:** The vesting contract interacts with an arbitrary `token: Address` passed by the sponsor.

**Risk:** The token contract could be non-standard, malicious, or have admin-controlled features (freeze, clawback) that affect stream funds.

**Mitigation:**

- `try_transfer` is used wherever possible; transfer failures return `TransferFailed` (error 9) without corrupting schedule state.
- `clawback_stream` probes for SAC clawback support before proceeding; non-clawback tokens return `ClawbackNotSupported`.
- The contract does not attempt to validate the token address or enforce any allowlist. Token vetting is the sponsor's responsibility (see §6.1 L-C1).

### 4.6 Backend API Surface

**Surface:** REST endpoints (`/tx/submit`, `/admin/bulk-claim`, `/auth/challenge`, `/auth/token`), GraphQL endpoint, and WebSocket connections.

| Attack Class | Surface Point | Mitigation Reference |
|---|---|---|
| JWT forgery | `POST /auth/token`, all authenticated routes | M-B1 |
| Nonce replay | `POST /auth/token` | M-B1 (single-use nonce) |
| SQL injection | Address parameters in all DB queries | M-B2 |
| Rate limiting / DoS | All public routes | M-B3 |
| SSRF | Webhook registration | M-B4 |
| GraphQL depth attack | GraphQL endpoint | M-B5 |
| Oversized body | All POST routes | M-B6 |
| Secret leakage | Logging, error responses | M-B7 |
| Duplicate submission | `POST /tx/submit` | M-B8 (idempotency key) |
| Network lateral movement | Container egress | M-B9 (NetworkPolicies) |

---

## 5. Mitigation Mapping

Each row maps a threat to the specific mitigation implemented in the contract or backend, and to the test(s) that verify the mitigation.

### 5.1 Smart Contract Mitigations

| ID | Threat | Mitigation | Code Location | Test Reference |
|---|---|---|---|---|
| M-T1 | T-A1, T-A2, T-A3 — Auth bypass | `require_auth()` on every state-mutating entry point: `sponsor` in `create_vesting_stream`, `cancel_stream`, `clawback_stream`, `emergency_drain`; `recipient` in `claim_vested`. | `contract.rs` — each entry point | `src/tests/test_auth.rs` (all four panic tests) |
| M-T2 | T-S4 — Integer overflow in deposit | `rate.checked_mul(total_duration as i128)` returns `DepositOverflow` (error 5) on overflow; cliff and end ledger use `checked_add` too. | `contract.rs::calculate_total_deposit`, ledger derivation | `src/tests/test_edge_cases.rs` — overflow boundary cases |
| M-T3 | T-S3 — Sponsor equals recipient | Guard `if sponsor == recipient { return Err(VestingError::InvalidRecipient) }` before auth or storage access. | `contract.rs::create_vesting_stream` | `src/tests/test_create.rs` |
| M-T4 | T-S5 — Duplicate schedule | `storage::has_schedule` checked before creating; returns `ScheduleAlreadyExists` (error 6). | `contract.rs::create_vesting_stream`, `storage.rs::has_schedule` | `src/tests/test_create.rs` |
| M-T5 | T-S2, general — Transfer-before-storage ordering | Token transfers are performed via `try_transfer` before any storage mutation. If the transfer fails, storage is left intact. Only after a successful transfer is the schedule written or removed. | `contract.rs` — `claim_vested`, `cancel_stream`, `emergency_drain` | `src/tests/test_transfer_failed.rs` |
| M-T6 | T-S2 — Reentrancy via malicious token | Soroban's execution model is single-threaded and does not allow a callee to re-enter the same contract call. Cross-contract calls complete before the calling contract continues. | Soroban host (SDK) | N/A — property of the platform |
| M-T7 | T-R1 — Pre-cliff claim | `if current_ledger < schedule.cliff_ledger { return Err(VestingError::CliffNotReached) }` | `contract.rs::claim_vested` | `src/tests/test_claim.rs` |
| M-T8 | T-R2 — Over-claim | `claimable_ledgers = active_end - last_claimed_ledger` caps accrual at `end_ledger`; `last_claimed_ledger` is only advanced after a successful transfer. | `contract.rs::claim_vested` | `src/tests/test_claim.rs`, `test_edge_cases.rs` |
| M-T9 | T-R3, T-R4 — Token lock after stream ends | `drain_expired_stream` (permissionless, 1-year delay) and `emergency_drain` (sponsor-only, same delay) recover unclaimed tokens to the original sponsor. | `contract.rs::drain_expired_stream`, `emergency_drain` | `src/tests/test_drain.rs` |
| M-T10 | T-A7 — Clawback only on eligible tokens | `StellarAssetClient::try_clawback` probe returns `ClawbackNotSupported` if the token does not have the SAC clawback flag. | `contract.rs::clawback_stream` | `src/tests/test_clawback.rs` |
| M-T11 | Storage exhaustion — TTL management | Persistent entries are extended on every read/write with a 60-day bump amount (`PERSISTENT_BUMP_AMOUNT = 518_400` ledgers). Entries for completed/cancelled streams are explicitly removed via `storage::remove_schedule`. | `storage.rs` — `set_schedule`, `get_schedule`, `remove_schedule` | `src/tests/test_edge_cases.rs` |
| M-T12 | Minimum deposit spam | `set_min_deposit` (default 100 base units) prevents creation of economically trivial streams that would inflate storage costs. | `contract.rs::create_vesting_stream`, `storage.rs::get_min_deposit` | `src/tests/test_min_deposit.rs` |
| M-T13 | Fuzz-tested input boundaries | `libfuzzer`-based fuzz targets exercise `create_vesting_stream` (overflow, zero/negative rate, cliff-equals-total) and `claim_vested` (pre-cliff, at-cliff, past-end). | `fuzz/fuzz_targets/` | `fuzz/corpus/create_vesting_stream/`, `fuzz/corpus/claim_vested/` |
| M-T14 | Mutation testing coverage | Cargo-mutants test suite verifies that removing or inverting individual conditions causes test failures. Report in `docs/mutation/report.md`. | `.cargo-mutants.toml` | `docs/mutation/report.md` |

### 5.2 Backend API Mitigations

| ID | Threat | Mitigation | Code Location | Test Reference |
|---|---|---|---|---|
| M-B1 | T-B1 — JWT forgery / replay | HMAC-SHA256 JWT signature verification; single-use nonces stored in Redis with 5-minute TTL; timestamp window enforcement (±5 min). | `backend/src/routes/auth.js` — `authMiddleware`, `tokenHandler` | `backend/src/routes/auth.test.js`, `backend/src/routes/security.test.ts` |
| M-B2 | T-B2 — SQL injection | Stellar address format validated via `/^G[A-Z2-7]{55}$/` regex before use in any query; ORM uses parameterized queries. | `backend/src/routes/auth.js` — `challengeHandler`; all DB query layers | `backend/src/routes/security.test.ts` — SQL injection test |
| M-B3 | T-B3 — Rate limiting | Sliding-window Redis counter: 100 req/min per IP, 1000 req/min per API key. Configurable via environment variables. Returns `429 Too Many Requests` with `Retry-After` header. | `backend/src/middleware/rateLimit.ts` | `backend/src/middleware/rateLimit.test.ts` |
| M-B4 | T-B4 — SSRF via webhook | HTTPS enforcement and private/loopback IP rejection for all webhook URLs. | Webhook validation logic | `backend/src/routes/security.test.ts` — webhook URL tests |
| M-B5 | T-B5 — GraphQL depth attack | Query depth limit enforced by `graphql-depth-limit.js`. | `backend/src/graphql-depth-limit.js` | N/A |
| M-B6 | T-B6 — Oversized body | Body size limit enforced before JSON parsing; 400 returned on oversized or missing body. | `backend/src/routes/security.test.ts` pattern | `backend/src/routes/security.test.ts` — body size test |
| M-B7 | T-B7 — Secret leakage | Secrets loaded from environment / AWS Secrets Manager; not logged; CodeQL scans on every PR (`codeql.yml`). | `backend/src/lib.js::loadConfig`, `.github/workflows/codeql.yml` | N/A — static analysis |
| M-B8 | T-B3 — Idempotency | Idempotency keys (`X-Idempotency-Key` header) prevent duplicate transaction submissions on client retries. | `backend/src/middleware/idempotency.ts` | `backend/src/middleware/idempotency.test.ts` |
| M-B9 | General — Network isolation | Kubernetes NetworkPolicies enforce default-deny and only permit required traffic paths (frontend→backend, backend→datastores, event-worker→Horizon, Prometheus scrape). | `k8s/network-policies/` | `scripts/test-network-policies.sh` |
| M-B10 | General — Container integrity | Container images are signed and digest-pinned; `verify-image.yml` workflow enforces provenance on every release. | `.github/workflows/verify-image.yml`, `scripts/pin-image-digest.sh` | CI enforced |
| M-B11 | General — Dependency vulnerabilities | `cargo audit` (Rust) and npm audit run on every PR via `audit.yml`. SBOM (SPDX 2.3) generated per release; copyleft license scan blocks merges. | `.github/workflows/audit.yml`, `audit.toml` | CI enforced |

---

## 6. Known Limitations and Accepted Risks

The following risks have been evaluated and are accepted by the project maintainers. Each entry describes the risk, the reason it is accepted, and any compensating controls.

### 6.1 Contract

**L-C1 — Malicious SAC token**
The contract does not validate that the `token` address is a legitimate SAC. A sponsor could supply a malicious token that behaves unexpectedly (e.g., no-op transfers, emitting false events). *Accepted because:* only the sponsor, who funds the stream from their own wallet, chooses the token. Recipients should verify the token address before accepting a stream. A future version could add a SAC allowlist enforced by the admin.

**L-C2 — Token issuer freeze**
A token issuer can freeze the contract vault account at any time, causing all `transfer` calls to fail with `TransferFailed`. Active streams would be unclaimable and uncancellable until the freeze is lifted. *Accepted because:* this is a property of regulated Stellar assets. The contract faithfully propagates the error; no tokens are lost, only temporarily inaccessible.

**L-C3 — No rate cap at contract level**
There is no upper bound on `rate_per_ledger` other than the overflow guard on `rate × total_duration`. A sponsor could set a very high rate, meaning a small number of ledgers grants a large token amount. *Accepted because:* the sponsor is the one funding the deposit; they have no incentive to harm themselves. Recipients benefit from a high rate.

**L-C4 — Admin WASM upgrade scope**
The `upgrade` entry point allows the admin to replace the contract's WASM. A malicious admin (or compromised admin key) could upgrade to code that steals funds from future streams. *Accepted because:* active streams at upgrade time are unaffected if the new code preserves storage layout. The admin key should be held in a multisig or hardware wallet. A formal upgrade process (private fork, two-maintainer review, advisory) is documented in `SECURITY.md`. Post-upgrade, the on-chain WASM hash is publicly auditable.

**L-C5 — Drain caller identity not verified**
`drain_expired_stream` accepts any `caller` address with no auth requirement. The caller identity is recorded only in the emitted event and has no effect on token routing (tokens always go to the original sponsor). *Accepted because:* the permissionless design is intentional to allow community cleanup of abandoned streams.

**L-C6 — Clock relies on ledger sequence, not wall time**
All time-based logic (cliff, end, drain delay) uses `env.ledger().sequence()`. If the Stellar network experiences extended downtime or protocol-level ledger resets, durations in wall-clock time will differ from the configured ledger counts. *Accepted because:* this is a fundamental property of Soroban; there is no trustworthy on-chain wall clock. The README documents the approximate ledger-to-time conversion (5 s/ledger).

### 6.2 Backend API

**L-B1 — Rate limiter fails open**
When Redis is unavailable, `rateLimitMiddleware` passes all requests through without limiting. *Accepted because:* availability is prioritised over strict enforcement; a Redis outage should not make the API completely unusable. The circuit breaker and Horizon timeout tests verify that the system degrades gracefully. Monitoring alerts are configured to detect Redis unavailability.

**L-B2 — No RPC certificate pinning**
The backend connects to `SOROBAN_RPC_URL` without TLS certificate pinning. A network attacker with the ability to present a forged certificate (e.g., a compromised CA) could intercept RPC responses. *Accepted because:* the backend runs inside a VPC with controlled egress; the Soroban RPC endpoint uses standard TLS from a trusted CA. Certificate pinning adds deployment complexity without meaningful risk reduction in the current network topology.

**L-B3 — Single signing key for tx-submit**
`POST /tx/submit` uses a single `SIGNING_SECRET_KEY` for all transaction submissions. If this key is compromised, an attacker can submit arbitrary contract operations on behalf of the backend. *Accepted because:* the backend only permits a whitelist of three operations (`claim_vested`, `create_vesting_stream`, `cancel_stream`). Transactions are routed through the contract's `require_auth` checks, which bind operations to the correct signer at the contract level. Secret rotation is automated via Secrets Manager.

**L-B4 — Off-chain indexer can fall behind**
The event indexer polls Horizon and may lag behind the on-chain state. API consumers reading cached data may observe stale schedule state. *Accepted because:* all authoritative state lives on-chain. The backend explicitly invalidates its cache after `claim_vested` and `cancel_stream` operations. For critical operations, callers should query the contract directly via `get_schedule`.

**L-B5 — No per-user audit trail for admin bulk-claim**
`POST /admin/bulk-claim` logs errors per recipient but does not produce a structured audit log of who triggered the bulk operation. *Accepted because:* the admin key is already controlled and rotated, and claim operations are fully visible on-chain. A structured audit log is tracked as a future enhancement.

---

## 7. Vulnerability Disclosure

Security vulnerabilities in this project should be reported according to the process documented in [SECURITY.md](../../SECURITY.md).

**Do not open public GitHub issues for security vulnerabilities.**

Key points from the disclosure policy:

- Report to **security@example.com**.
- Include: description, reproduction steps, proof-of-concept (if applicable), and suggested fix.
- **Acknowledgment** within 48 hours.
- **Initial assessment** within 5 business days.
- **Resolution target** for critical issues: 30 days from confirmation.

For CodeQL findings and suppression decisions, see [codeql-suppression.md](./codeql-suppression.md).

---

## 8. Review and Sign-off

This document should be reviewed by a person with Soroban/Stellar smart contract security experience before each major release, and updated whenever:

- A new entry point is added to the contract.
- A new backend route is added that handles authentication, authorization, or token operations.
- A dependency with a known CVE is patched.
- A previously accepted risk is re-evaluated.

| Role | Name | Date | Notes |
|---|---|---|---|
| Author | — | 2026-07-30 | Initial version |
| Smart Contract Security Review | *Pending* | — | Required before mainnet deployment |
| Backend Security Review | *Pending* | — | Required before production launch |

> **Note:** The "Reviewed by someone with smart contract security background" acceptance criterion is a process requirement. The technical content in this document reflects the implemented mitigations. A qualified reviewer should validate that no threats or mitigations have been omitted before this document is marked fully approved.
