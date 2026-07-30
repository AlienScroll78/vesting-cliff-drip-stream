# Error Handling Guide

This guide covers every error code the `VestingDrips` contract can return.
It is intended for frontend engineers, backend/integration developers, and
anyone building a client that calls this contract.

---

## Contents

1. [How errors surface](#how-errors-surface)
2. [Network vs contract error distinction](#network-vs-contract-error-distinction)
3. [Error categories](#error-categories)
4. [Retry-safe vs non-retry-safe errors](#retry-safe-vs-non-retry-safe-errors)
5. [Error code reference (codes 1–15)](#error-code-reference)
6. [User-facing message copy](#user-facing-message-copy)
7. [Tone guidelines](#tone-guidelines)
8. [Frontend error display patterns](#frontend-error-display-patterns)
9. [Backend error propagation patterns](#backend-error-propagation-patterns)
10. [TypeScript try/catch examples](#typescript-trycatch-examples)
11. [Rust client examples](#rust-client-examples)
12. [Retry logic and polling helpers](#retry-logic-and-polling-helpers)

---

## How errors surface

Soroban contract errors are returned as a `u32` code inside a
`ScError::Contract` variant. All `VestingError` codes are pinned to explicit
`u32` values (see ADR-0004) so they are stable across contract upgrades.

| Context | How the error appears |
|---|---|
| **Stellar CLI** | `Error(Contract, #N)` printed to stderr |
| **JavaScript SDK** | Simulation returns `isSimulationError(result) === true`; the raw code is extracted from `result.error` |
| **Rust client (generated bindings)** | `Err(VestingError::Variant)` from the generated client method |
| **Rust client (raw invoke)** | `InvokeContractError` containing the raw `u32` code |
| **Horizon/RPC response** | `result_codes.transaction` or the `diagnosticEvents` array on a failed transaction |

> **Code 0 is reserved.** The Soroban runtime uses 0 to signal success; the
> contract never emits it.

---

## Network vs contract error distinction

These two failure classes require different handling strategies.

### Contract errors (deterministic)

A contract error means the transaction was simulated or executed and the
contract itself rejected it with a typed `VestingError` code. The call is
**deterministic**: submitting the same transaction again will produce the same
error unless an external condition changes (time passes, state changes, etc.).

- Identified by `ScError::Contract` in the XDR result.
- Codes 1–15 in this document are all contract errors.
- Do **not** blindly retry. Fix the input or wait for the condition to change.

### Network / infrastructure errors (transient)

A network error means the transaction never reached the contract, or the
Stellar network itself rejected the envelope before execution.

Common causes:

- RPC node timeout or HTTP 5xx
- Sequence number mismatch (`tx_bad_seq`)
- Fee too low during a surge-pricing window (`tx_insufficient_fee`)
- Ledger close before submission (`tx_too_late`)

These errors **do not carry a `VestingError` code**. They arrive as HTTP errors
or as `TransactionResultCode` values outside the `ScError::Contract` namespace.
They are generally safe to retry after a short back-off.

```typescript
import { rpc, xdr } from "@stellar/stellar-sdk";

function classifyError(error: unknown): "contract" | "network" | "unknown" {
  // Simulation errors from the RPC node
  if (typeof error === "object" && error !== null && "result" in error) {
    const sim = error as rpc.Api.SimulateTransactionResponse;
    if (rpc.Api.isSimulationError(sim)) return "contract";
  }
  // HTTP / fetch errors
  if (error instanceof TypeError || (error as NodeJS.ErrnoException).code === "ECONNREFUSED") {
    return "network";
  }
  // Soroban host errors that are not contract errors
  if (error instanceof Error && error.message.includes("tx_bad_seq")) {
    return "network";
  }
  return "unknown";
}
```

---

## Error categories

Errors are grouped into four UI categories. Each maps to a distinct
illustration, colour scheme, and set of available actions.

| Category | Colour | Purpose |
|---|---|---|
| `validation` | Amber | Input was wrong before submission — fix the form |
| `state` | Blue/indigo | Contract state or timing condition not met — wait or take action |
| `network` | Orange | Token-level transfer failure — show a retry button |
| `admin` | Violet | Admin-only operation failed or contract already configured |
| `unexpected` | Red | Unknown code — show a support/docs link |

---

## Retry-safe vs non-retry-safe errors

| Safe to retry? | Errors |
|---|---|
| **Yes — after waiting** | `CliffNotReached` (2), `NothingToClaim` (7), `StreamNotExpired` (8), `DrainDelayNotExpired` (10) |
| **Yes — immediately (transient)** | `TransferFailed` (9) — investigate before retrying |
| **No — fix input first** | `InvalidDuration` (3), `InvalidRate` (4), `DepositOverflow` (5), `DepositBelowMinimum` (12), `InvalidRecipient` (11) |
| **No — state change required** | `ScheduleNotFound` (1), `ScheduleAlreadyExists` (6), `ClawbackNotSupported` (13) |
| **No — one-time operations** | `AlreadyInitialized` (14) |
| **No — permission denied** | `Unauthorized` (15) |

---

## Error code reference

The contract currently defines **15 error codes**. Codes are appended in order
as new variants are introduced; existing codes are never renumbered (ADR-0004).

> **Note on `error.rs` doc-comment bug:** `DrainDelayNotExpired` carries the
> comment `/// Code 11` but its actual value is `= 10`. The numeric value `10`
> is authoritative. Code 11 is `InvalidRecipient`. This doc-comment typo is
> tracked for correction in `error.rs`.

> **Note on codes 12–15:** `DepositBelowMinimum`, `ClawbackNotSupported`,
> `AlreadyInitialized`, and `Unauthorized` are used in `contract.rs` and
> verified by the test suite. They are pending addition to `error.rs` (the
> `#[contracterror]` enum).

---

### Code 1 — `ScheduleNotFound`

| Field | Value |
|---|---|
| Category | `state` |
| Retry-safe | No |
| Emitted by | `claim_vested`, `cancel_stream`, `clawback_stream`, `drain_expired_stream`, `emergency_drain`, `migrate_schedule` |

**Description:** No active vesting schedule exists in contract storage for the
given recipient address. The stream was either never created, has already been
fully claimed and removed, or was cancelled.

**When it occurs:**
- Recipient calls `claim_vested` with an address that has no stream.
- Sponsor calls `cancel_stream` for a recipient whose stream was already cancelled.
- Any drain or clawback call targeting a non-existent or already-cleaned-up stream.

**Recommended client action:**
Check whether a stream exists first using `get_schedule(recipient)`. If the
result is `None`, there is nothing to do — do not surface a retry button.

**User-facing message:**
> **No vesting stream found.**
> We couldn't find an active vesting stream for this address. Make sure you're
> connected with the correct wallet. If you're expecting a stream, ask your
> sponsor to create one.

---

### Code 2 — `CliffNotReached`

| Field | Value |
|---|---|
| Category | `state` |
| Retry-safe | Yes — after cliff ledger passes |
| Emitted by | `claim_vested` |

**Description:** The current ledger sequence is still below `cliff_ledger`.
No tokens can be claimed until the cliff is reached; the contract rejects any
claim attempt before that point.

**When it occurs:**
- Recipient calls `claim_vested` before the cliff ledger.

**Recommended client action:**
Call `is_cliff_passed(recipient)` before attempting a claim. If it returns
`false`, display the estimated time until the cliff (derive from
`schedule.cliff_ledger - current_ledger` multiplied by the average ledger
close time, ~5 s/ledger). Poll `is_cliff_passed` and enable the claim button
only once it returns `true`.

**User-facing message:**
> **Tokens are still locked.**
> Your vesting cliff hasn't been reached yet. Tokens can't be claimed until
> the cliff date passes. Check back then — no action is needed right now.

---

### Code 3 — `InvalidDuration`

| Field | Value |
|---|---|
| Category | `validation` |
| Retry-safe | No — fix input |
| Emitted by | `create_vesting_stream` |

**Description:** `total_duration` is less than or equal to `cliff_duration`. A
stream where the cliff equals or exceeds the total stream length would produce
no post-cliff drip period and is rejected at creation time.

**When it occurs:**
- Sponsor submits `create_vesting_stream` with `total_duration <= cliff_duration`.

**Recommended client action:**
Validate client-side before submission: `total_duration > cliff_duration`.
Display an inline form error; never submit if this condition is violated.

**User-facing message:**
> **Invalid stream duration.**
> The total vesting period must be longer than the cliff period. Increase the
> total duration or shorten the cliff so there is time left after the cliff to
> drip tokens.

---

### Code 4 — `InvalidRate`

| Field | Value |
|---|---|
| Category | `validation` |
| Retry-safe | No — fix input |
| Emitted by | `create_vesting_stream`, `set_min_deposit` |

**Description:** The `rate_per_ledger` value passed to `create_vesting_stream`
is zero or negative. Also returned by `set_min_deposit` when `min_deposit <= 0`.

**When it occurs:**
- Sponsor submits `create_vesting_stream` with `rate <= 0`.
- Admin calls `set_min_deposit` with `min_deposit <= 0`.

**Recommended client action:**
Validate client-side: `rate > 0` and `min_deposit > 0`. Display an inline
form error. Never submit if the condition is violated.

**User-facing message (stream creation):**
> **Invalid token rate.**
> The token rate per ledger must be a positive number greater than zero.
> Enter a rate of at least 1.

**User-facing message (admin config):**
> **Invalid minimum deposit.**
> The minimum deposit threshold must be greater than zero.

---

### Code 5 — `DepositOverflow`

| Field | Value |
|---|---|
| Category | `validation` |
| Retry-safe | No — reduce rate or duration |
| Emitted by | `create_vesting_stream`, `drain_expired_stream` |

**Description:** The computed total deposit (`rate × total_duration`) would
overflow an `i128`. Also returned when intermediate ledger arithmetic
(`start_ledger + cliff_duration` or `start_ledger + total_duration`) overflows
a `u32`. The safe upper bound for `rate` is `i128::MAX / total_duration`.

**When it occurs:**
- `rate × total_duration > i128::MAX` in `create_vesting_stream`.
- `end_ledger + DRAIN_DELAY_LEDGERS` overflows `u32` in `drain_expired_stream`
  (extremely unlikely in practice; requires an `end_ledger` near `u32::MAX`).

**Recommended client action:**
Guard client-side using BigInt arithmetic before submission:

```typescript
const MAX_I128 = BigInt("170141183460469231731687303715884105727");
if (BigInt(rate) * BigInt(totalDuration) > MAX_I128) {
  // Show overflow error, do not submit
}
```

**User-facing message:**
> **Deposit amount too large.**
> The combination of rate and duration would create a deposit that is too
> large to process. Reduce the rate, shorten the duration, or both.

---

### Code 6 — `ScheduleAlreadyExists`

| Field | Value |
|---|---|
| Category | `state` |
| Retry-safe | No — cancel existing stream first |
| Emitted by | `create_vesting_stream` |

**Description:** A vesting schedule already exists in storage for this
recipient address. Only one active stream per recipient is allowed.

**When it occurs:**
- Sponsor calls `create_vesting_stream` for a recipient who already has an
  active stream.

**Recommended client action:**
Query `get_schedule(recipient)` before creating a new stream. If a schedule
exists, offer the sponsor the option to view or cancel the existing stream
before creating a replacement.

**User-facing message:**
> **Stream already exists.**
> A vesting stream is already active for this recipient address. Cancel the
> existing stream before creating a new one.

---

### Code 7 — `NothingToClaim`

| Field | Value |
|---|---|
| Category | `state` |
| Retry-safe | Yes — wait at least one ledger |
| Emitted by | `claim_vested` |

**Description:** The claimable amount at the current ledger is zero. This
occurs either when the stream has already been fully claimed up to `end_ledger`,
or when the ledger sequence has not advanced since the last claim.

**When it occurs:**
- Recipient calls `claim_vested` immediately after a previous claim in the same
  ledger (no accrual since last claim).
- Stream has reached `end_ledger` and all tokens have already been claimed.

**Recommended client action:**
Use `claimable_amount(recipient)` to check the claimable balance before
presenting a claim button. Suppress the "nothing to claim" state from the user
unless the stream is fully drained; otherwise show "Your balance grows every
ledger — check back soon."

**User-facing message:**
> **Nothing to claim right now.**
> There are no tokens available at this moment. Tokens accrue every ledger.
> Wait a moment and try again.

---

### Code 8 — `StreamNotExpired`

| Field | Value |
|---|---|
| Category | `state` |
| Retry-safe | Yes — after `end_ledger` passes |
| Emitted by | `drain_expired_stream`, `emergency_drain` |

**Description:** A drain or emergency-drain was attempted before the stream's
`end_ledger` has been reached. Both functions require the stream to be fully
expired before the drain-delay window even starts.

**When it occurs:**
- `drain_expired_stream` or `emergency_drain` called when
  `current_ledger < end_ledger`.

**Recommended client action:**
Show the stream end date and disable drain controls until `current_ledger >=
end_ledger`. Derive the end date from `schedule.end_ledger` multiplied by
~5 s/ledger.

**User-facing message:**
> **Stream hasn't ended yet.**
> This action requires the stream to have fully completed. Wait until the
> stream's end date has passed before trying again.

---

### Code 9 — `TransferFailed`

| Field | Value |
|---|---|
| Category | `network` |
| Retry-safe | Yes — investigate before retrying |
| Emitted by | `create_vesting_stream`, `claim_vested`, `cancel_stream`, `emergency_drain` |

**Description:** The underlying SAC `transfer` call was rejected by the token
contract. No contract state is mutated when this error is returned — the
schedule remains intact and the original balances are unchanged.

Common causes: frozen account, insufficient balance in the contract vault
(should not happen under normal operation), or a token-level restriction on
the recipient or sponsor account.

**When it occurs:**
- Initial deposit transfer fails during `create_vesting_stream`.
- Payout transfer to recipient fails during `claim_vested`.
- Refund transfer to sponsor or recipient fails during `cancel_stream`.
- Recovery transfer to sponsor fails during `emergency_drain`.

**Recommended client action:**
Show a retry button. Also surface a secondary action to check the token
account status (frozen flag, balance). If retries consistently fail, direct
the user to their token issuer.

**User-facing message:**
> **Token transfer failed.**
> The token transfer couldn't be completed. This can happen if the account
> is frozen, has an insufficient balance, or the token contract rejected the
> transfer. Check your account status and try again. If the problem persists,
> contact your token issuer.

---

### Code 10 — `DrainDelayNotExpired`

| Field | Value |
|---|---|
| Category | `state` |
| Retry-safe | Yes — after drain delay passes |
| Emitted by | `drain_expired_stream`, `emergency_drain` |

**Description:** The mandatory drain-delay period has not yet elapsed. After
`end_ledger` is reached, callers must wait an additional `DRAIN_DELAY_LEDGERS`
(3,153,600 ledgers, approximately one year at ~5 s/ledger) before either
drain function becomes available. This prevents abuse on recently-ended
streams where the recipient may still intend to claim.

**When it occurs:**
- `drain_expired_stream` or `emergency_drain` called when
  `current_ledger < end_ledger + DRAIN_DELAY_LEDGERS`.

**Recommended client action:**
Compute `drainAvailableAt = end_ledger + 3_153_600` and show a countdown.
Disable drain controls and poll until `current_ledger >= drainAvailableAt`.

**User-facing message:**
> **Too early to drain.**
> There is a mandatory one-year waiting period after a stream ends before
> unclaimed tokens can be recovered. Wait for the delay period to pass
> after the stream's end date, then try again.

---

### Code 11 — `InvalidRecipient`

| Field | Value |
|---|---|
| Category | `validation` |
| Retry-safe | No — fix input |
| Emitted by | `create_vesting_stream` |

**Description:** The `sponsor` and `recipient` addresses passed to
`create_vesting_stream` are identical. A sponsor streaming to themselves is
almost certainly a mistake: `cancel_stream` would pay both the earned-tokens
share and the refund to the same address, producing confusing accounting.

**When it occurs:**
- Sponsor connects the same wallet as both the funding address and the recipient
  when creating a stream.

**Recommended client action:**
Validate client-side: `sponsor !== recipient`. Highlight both address fields
with an inline error. Never submit if they match.

**User-facing message:**
> **Invalid recipient address.**
> The sponsor and recipient must be different wallet addresses. Enter a
> recipient address that is different from your own wallet.

---

### Code 12 — `DepositBelowMinimum`

| Field | Value |
|---|---|
| Category | `validation` |
| Retry-safe | No — increase rate or duration |
| Emitted by | `create_vesting_stream` |

**Description:** The computed total deposit (`rate × total_duration`) is below
the contract's configured minimum deposit threshold (default: 100 tokens;
configurable by the admin via `set_min_deposit`). This guard prevents
micro-streams that would produce negligible economic value while still
consuming storage.

**When it occurs:**
- `rate × total_duration < min_deposit` in `create_vesting_stream`.

**Recommended client action:**
Fetch `get_min_deposit()` on page load and display it in the creation form.
Compute the total deposit in real time and show an inline warning if it falls
below the minimum. Never submit if `rate * totalDuration < minDeposit`.

**User-facing message:**
> **Deposit too small.**
> The total deposit for this stream is below the minimum required amount.
> Increase the rate or duration so the total deposit meets the minimum.

---

### Code 13 — `ClawbackNotSupported`

| Field | Value |
|---|---|
| Category | `state` |
| Retry-safe | No — token does not support clawback |
| Emitted by | `clawback_stream` |

**Description:** The token used in the stream does not have the SAC clawback
flag enabled. The `clawback_stream` function is only available for
clawback-enabled (regulated) assets; it verifies this by probing the SAC admin
interface before proceeding.

**When it occurs:**
- `clawback_stream` called on a stream whose token contract rejects the
  zero-value clawback probe.

**Recommended client action:**
Check whether the token supports clawback before showing the clawback option in
the UI. Use the Horizon API or the SAC admin interface to inspect the token's
flags. Only render the clawback button for tokens with `clawback_enabled: true`.

**User-facing message:**
> **Clawback not available.**
> This token does not support compliance clawbacks. Clawback is only
> available on tokens with the clawback feature enabled by the token issuer.
> Contact the token issuer if you believe this is incorrect.

---

### Code 14 — `AlreadyInitialized`

| Field | Value |
|---|---|
| Category | `admin` |
| Retry-safe | No — one-time operation |
| Emitted by | `initialize` |

**Description:** `initialize` was called when an admin address is already set
in instance storage. The function is idempotent-safe by rejection: it can only
succeed once, preventing admin hijack after deployment.

**When it occurs:**
- `initialize` called a second time on an already-configured contract.

**Recommended client action:**
Call `initialize` only during the deployment script. In the frontend, never
expose `initialize` to end users. If the admin is lost, this requires a
contract re-deployment.

**User-facing message (admin tooling only):**
> **Contract already initialized.**
> An admin has already been set for this contract. `initialize` can only
> be called once.

---

### Code 15 — `Unauthorized`

| Field | Value |
|---|---|
| Category | `admin` |
| Retry-safe | No — caller lacks permission |
| Emitted by | `upgrade`, `transfer_admin` |

**Description:** The caller is not the address stored as the contract admin.
`upgrade` and `transfer_admin` are gated behind the admin address set during
`initialize`; any other signer is rejected.

**When it occurs:**
- A non-admin address signs an `upgrade` or `transfer_admin` transaction.
- The admin address was transferred and the old admin attempts a privileged
  operation.

**Recommended client action:**
Admin operations should only be accessible to the admin key holder. The UI
should not surface `upgrade` or `transfer_admin` controls to non-admin users.
Log the failure securely on the backend for audit purposes.

**User-facing message (admin tooling only):**
> **Unauthorized.**
> This action requires admin authority. Only the designated contract admin
> can perform this operation.

---

## User-facing message copy

Quick-reference table. These strings are shown directly to end users. No
numeric error codes are ever exposed in the UI.

| Code | Title | Explanation | Suggested action label |
|---|---|---|---|
| 1 | No vesting stream found | We couldn't find an active vesting stream for this wallet address. | Check wallet / Contact sponsor |
| 2 | Tokens are still locked | Your vesting cliff hasn't been reached yet. Tokens can't be claimed until the cliff date passes. | View cliff date |
| 3 | Invalid stream duration | The total vesting period must be longer than the cliff period. | Fix duration |
| 4 | Invalid token rate | The token rate per ledger must be a positive number greater than zero. | Fix rate |
| 5 | Deposit amount too large | The combination of rate and duration would create a deposit that is too large to process. | Reduce rate or duration |
| 6 | Stream already exists | A vesting stream is already active for this recipient address. | View existing stream |
| 7 | Nothing to claim right now | There are no tokens available at this moment. Tokens accrue every ledger. | Try again later |
| 8 | Stream hasn't ended yet | This action requires the stream to have fully completed. | View end date |
| 9 | Token transfer failed | The token transfer couldn't be completed. This can happen if the account is frozen or has an insufficient balance. | Retry / Check account |
| 10 | Too early to drain | There is a mandatory one-year waiting period after a stream ends before unclaimed tokens can be recovered. | View drain date |
| 11 | Invalid recipient address | The sponsor and recipient must be different wallet addresses. | Fix recipient |
| 12 | Deposit too small | The total deposit for this stream is below the minimum required amount. | Increase rate or duration |
| 13 | Clawback not available | This token does not support compliance clawbacks. | Contact token issuer |
| 14 | Already initialized | An admin has already been set for this contract. | — |
| 15 | Unauthorized | This action requires admin authority. | — |

---

## Tone guidelines

Apply these rules to all user-facing copy.

- **Calm.** Never use words like "fatal", "crash", "broken", or "error" in titles.
- **Actionable.** Every message tells the user exactly what to do next.
- **Jargon-free.** Avoid "ledger", "SAC", "i128", "XDR", "contracterror" in copy
  visible to end users. Use "tokens", "date", "amount", "wallet".
- **No codes.** Never render a raw numeric code to end users.
- **Present tense.** "Tokens are locked", not "Tokens were locked".
- **Consistent grammar.** Sentence case for titles; full sentences with punctuation
  for explanations.

---

## Frontend error display patterns

### Component hierarchy

The recommended component pattern for rendering contract errors:

```
<StreamAction>
  ├── [success] → <SuccessToast> or inline confirmation
  ├── [contract error] → <ContractErrorState code={N} onRetry={fn} />
  └── [network error] → <NetworkErrorBanner onRetry={fn} />
```

### `ContractErrorState` component

Renders a full error state with illustration, title, explanation, and
contextual action buttons. Import from `@/components/ContractErrorState`.

```tsx
import { ContractErrorState } from "@/components/ContractErrorState";

// Code 9 (TransferFailed) — show a retry button
<ContractErrorState code={9} onRetry={() => submitTx()} />

// Code 2 (CliffNotReached) — no retry button; show cliff date instead
<ContractErrorState
  code={2}
  context={{ cliffDate: estimatedCliffDate }}
/>

// Code 1 (ScheduleNotFound) — static informational state
<ContractErrorState code={1} />
```

Props:

| Prop | Type | Required | Description |
|---|---|---|---|
| `code` | `number` | Yes | The numeric `VestingError` code |
| `onRetry` | `() => void` | No | If provided, renders a "Try again" button |
| `context` | `Record<string, unknown>` | No | Extra data passed to the message renderer (e.g. cliff date) |

### `ErrorStateIllustration` component

Renders only the SVG illustration for a given category.

```tsx
import { ErrorStateIllustration } from "@/components/ErrorStateIllustration";

<ErrorStateIllustration category="network" size={64} />
<ErrorStateIllustration category="state" size={48} />
```

### Inline form validation

For validation errors (codes 3, 4, 5, 11, 12) that can be detected before
submission, display them as inline field errors rather than full-page error
states.

```tsx
// Pseudocode: inline error on the rate field
const rateError = rate <= 0 ? VESTING_ERRORS[4].message : null;

<TextInput
  label="Rate per ledger"
  value={rate}
  error={rateError}
/>
```

### Toast vs full-page error

| Scenario | Recommended pattern |
|---|---|
| Transient failure (code 9) | Toast with retry button; disappears on retry |
| User-correctable input error (codes 3, 4, 5, 11, 12) | Inline form validation; never reaches submission |
| State/timing error (codes 2, 7, 8, 10) | Inline informational banner with countdown or "check back" copy |
| Permanent/not-found error (codes 1, 6, 13) | Full-page error state |
| Admin error (codes 14, 15) | Log to console/monitoring; show generic "operation not permitted" in UI |

### Accessibility

- Error messages must be rendered in an `aria-live="polite"` region so screen
  readers announce them without interrupting ongoing speech.
- Do not rely on colour alone to indicate error state — pair colour with an icon
  and text label.
- Retry buttons must have a descriptive `aria-label`, e.g.
  `aria-label="Retry token transfer"`.

```tsx
<div role="alert" aria-live="polite">
  <ContractErrorState code={errorCode} onRetry={handleRetry} />
</div>
```

---

## Backend error propagation patterns

Backend services (indexers, relayers, cron jobs) that invoke the contract
should follow these patterns.

### Classify before logging

Map the raw code to a named error before writing logs so that log aggregation
tools can filter by name rather than magic numbers.

```typescript
// Node.js / TypeScript backend service
function toNamedError(code: number): { name: string; retryable: boolean } {
  const err = VESTING_ERRORS[code];
  if (!err) return { name: "UnknownVestingError", retryable: false };
  return { name: err.name, retryable: err.retryable };
}

logger.warn("contract_error", {
  recipient,
  ...toNamedError(contractErrorCode),
  raw_code: contractErrorCode,
});
```

### Do not swallow state errors silently

Errors like `ScheduleNotFound` (1) and `ScheduleAlreadyExists` (6) indicate a
mismatch between the backend's view of state and the contract's actual state.
These should trigger a reconciliation step (re-query `get_schedule`) rather
than being silently discarded.

```typescript
async function reconcileSchedule(recipient: string): Promise<void> {
  const schedule = await contract.getSchedule(recipient);
  if (!schedule) {
    await db.markStreamNotFound(recipient);
  } else {
    await db.upsertStream(recipient, schedule);
  }
}

try {
  await contract.claimVested(recipient);
} catch (err) {
  const code = extractContractErrorCode(err);
  if (code === 1) {
    // State is inconsistent — reconcile before surfacing to UI
    await reconcileSchedule(recipient);
  }
  throw err;
}
```

### Retry policy for backend workers

| Error code | Backend retry policy |
|---|---|
| 2 (`CliffNotReached`) | Exponential back-off; re-queue after estimated cliff time |
| 7 (`NothingToClaim`) | Skip this run; re-queue on next cron tick |
| 8 (`StreamNotExpired`) | Re-queue after `end_ledger` |
| 9 (`TransferFailed`) | Immediate retry up to 3×; then alert on-call |
| 10 (`DrainDelayNotExpired`) | Re-queue after `end_ledger + DRAIN_DELAY_LEDGERS` |
| All others | Do not retry; alert and require human review |

### Structured error envelope (REST API)

When wrapping contract calls in a REST API, return a consistent error envelope
so API consumers can handle errors programmatically.

```typescript
// Express.js handler example
app.post("/api/claim", async (req, res) => {
  try {
    const amount = await vestingService.claimVested(req.body.recipient);
    res.json({ ok: true, amount });
  } catch (err) {
    const code = extractContractErrorCode(err);
    const vestingErr = VESTING_ERRORS[code];

    if (vestingErr) {
      res.status(422).json({
        ok: false,
        error: {
          code,
          name: vestingErr.name,
          message: vestingErr.message,
          retryable: vestingErr.retryable,
        },
      });
    } else {
      // Network or unknown error
      res.status(502).json({
        ok: false,
        error: {
          code: null,
          name: "NetworkError",
          message: "The Stellar network request failed. Please try again.",
          retryable: true,
        },
      });
    }
  }
});
```

---

## TypeScript try/catch examples

### Error map

Define this once and import it everywhere:

```typescript
// src/lib/vestingErrors.ts
import { rpc } from "@stellar/stellar-sdk";

export interface VestingErrorMeta {
  name: string;
  message: string;   // user-facing copy
  retryable: boolean;
  category: "validation" | "state" | "network" | "admin" | "unexpected";
}

export const VESTING_ERRORS: Record<number, VestingErrorMeta> = {
  1:  { name: "ScheduleNotFound",      retryable: false, category: "state",
        message: "No vesting stream found for this address." },
  2:  { name: "CliffNotReached",       retryable: true,  category: "state",
        message: "Tokens are still locked. The cliff period has not passed yet." },
  3:  { name: "InvalidDuration",       retryable: false, category: "validation",
        message: "Total duration must be greater than the cliff duration." },
  4:  { name: "InvalidRate",           retryable: false, category: "validation",
        message: "Token rate must be a positive number greater than zero." },
  5:  { name: "DepositOverflow",       retryable: false, category: "validation",
        message: "Rate or duration is too large. Please reduce them." },
  6:  { name: "ScheduleAlreadyExists", retryable: false, category: "state",
        message: "A vesting stream already exists for this recipient." },
  7:  { name: "NothingToClaim",        retryable: true,  category: "state",
        message: "Nothing to claim right now. Try again in a moment." },
  8:  { name: "StreamNotExpired",      retryable: true,  category: "state",
        message: "The stream hasn't ended yet. Wait until the end date." },
  9:  { name: "TransferFailed",        retryable: true,  category: "network",
        message: "Token transfer failed. Check your account and try again." },
  10: { name: "DrainDelayNotExpired",  retryable: true,  category: "state",
        message: "Too early to drain. Wait for the one-year delay to pass." },
  11: { name: "InvalidRecipient",      retryable: false, category: "validation",
        message: "Sponsor and recipient must be different wallet addresses." },
  12: { name: "DepositBelowMinimum",   retryable: false, category: "validation",
        message: "Total deposit is below the minimum. Increase the rate or duration." },
  13: { name: "ClawbackNotSupported",  retryable: false, category: "state",
        message: "This token does not support compliance clawbacks." },
  14: { name: "AlreadyInitialized",    retryable: false, category: "admin",
        message: "The contract has already been initialized." },
  15: { name: "Unauthorized",          retryable: false, category: "admin",
        message: "This action requires admin authority." },
};

/**
 * Extract the numeric VestingError code from any thrown error object.
 * Returns null if the error is not a contract error.
 */
export function extractContractErrorCode(error: unknown): number | null {
  const str = String(error);
  const match = str.match(/Error\(Contract,\s*#(\d+)\)/);
  if (match) return parseInt(match[1], 10);
  return null;
}

/**
 * Parse a thrown error and return the VestingErrorMeta, or null for network errors.
 */
export function parseVestingError(error: unknown): VestingErrorMeta | null {
  const code = extractContractErrorCode(error);
  if (code === null) return null;
  return VESTING_ERRORS[code] ?? {
    name: "UnknownVestingError",
    message: "An unexpected error occurred.",
    retryable: false,
    category: "unexpected",
  };
}
```

---

### Pre-flight validation before submission

Always simulate before submitting. A simulation failure is free; a submitted
failure costs a fee.

```typescript
// src/lib/vestingClient.ts
import { Contract, rpc, TransactionBuilder, Networks } from "@stellar/stellar-sdk";
import { parseVestingError, VESTING_ERRORS } from "./vestingErrors";

const MAX_I128 = BigInt("170141183460469231731687303715884105727");

/** Client-side guard — run before constructing the transaction. */
export function validateCreateParams(params: {
  sponsor: string;
  recipient: string;
  rate: bigint;
  cliffDuration: bigint;
  totalDuration: bigint;
  minDeposit: bigint;
}): void {
  const { sponsor, recipient, rate, cliffDuration, totalDuration, minDeposit } = params;

  if (sponsor === recipient) {
    throw new Error(VESTING_ERRORS[11].message);
  }
  if (rate <= 0n) {
    throw new Error(VESTING_ERRORS[4].message);
  }
  if (totalDuration <= cliffDuration) {
    throw new Error(VESTING_ERRORS[3].message);
  }
  if (rate * totalDuration > MAX_I128) {
    throw new Error(VESTING_ERRORS[5].message);
  }
  if (rate * totalDuration < minDeposit) {
    throw new Error(VESTING_ERRORS[12].message);
  }
}
```

---

### `claim_vested` — full try/catch flow

```typescript
// src/actions/claimVested.ts
import { rpc } from "@stellar/stellar-sdk";
import { parseVestingError } from "../lib/vestingErrors";

export type ClaimResult =
  | { ok: true; amount: bigint }
  | { ok: false; userMessage: string; retryable: boolean; code: number | null };

export async function claimVested(
  server: rpc.Server,
  contract: { call: (method: string, args: object) => Promise<unknown> },
  recipientAddress: string,
  sign: (tx: unknown) => Promise<unknown>,
): Promise<ClaimResult> {
  let tx: unknown;

  try {
    // 1. Build the transaction
    tx = await contract.call("claim_vested", { recipient: recipientAddress });
  } catch (buildErr) {
    return {
      ok: false,
      userMessage: "Failed to build the transaction. Please try again.",
      retryable: true,
      code: null,
    };
  }

  // 2. Simulate — free, catches contract errors before paying a fee
  const sim = await server.simulateTransaction(tx as Parameters<typeof server.simulateTransaction>[0]);

  if (rpc.Api.isSimulationError(sim)) {
    const vestingErr = parseVestingError(sim.error);
    if (vestingErr) {
      return {
        ok: false,
        userMessage: vestingErr.message,
        retryable: vestingErr.retryable,
        code: vestingErr ? Object.entries(vestingErr).length : null,
      };
    }
    // Non-contract simulation error (network/host)
    return {
      ok: false,
      userMessage: "Simulation failed. Please try again.",
      retryable: true,
      code: null,
    };
  }

  // 3. Sign and submit
  try {
    const signedTx = await sign(rpc.assembleTransaction(tx as Parameters<typeof rpc.assembleTransaction>[0], sim).build());
    const sendResult = await server.sendTransaction(signedTx as Parameters<typeof server.sendTransaction>[0]);

    if (sendResult.status === "ERROR") {
      const vestingErr = parseVestingError(sendResult);
      return {
        ok: false,
        userMessage: vestingErr?.message ?? "Transaction failed. Please try again.",
        retryable: vestingErr?.retryable ?? true,
        code: null,
      };
    }

    // Poll for confirmation
    const finalResult = await server.getTransaction(sendResult.hash);
    const amount = BigInt(String((finalResult as { returnValue?: unknown }).returnValue ?? "0"));
    return { ok: true, amount };

  } catch (submitErr) {
    // Network-level error — safe to retry
    return {
      ok: false,
      userMessage: "Network error. Please check your connection and try again.",
      retryable: true,
      code: null,
    };
  }
}
```

---

### `create_vesting_stream` — with pre-flight validation

```typescript
// src/actions/createStream.ts
import { rpc } from "@stellar/stellar-sdk";
import { validateCreateParams } from "../lib/vestingClient";
import { parseVestingError } from "../lib/vestingErrors";

export async function createVestingStream(
  server: rpc.Server,
  contract: { call: (method: string, args: object) => Promise<unknown> },
  params: {
    sponsor: string;
    recipient: string;
    token: string;
    rate: bigint;
    cliffDuration: bigint;
    totalDuration: bigint;
    minDeposit: bigint;
  },
  sign: (tx: unknown) => Promise<unknown>,
) {
  // Client-side validation — throws with a user-friendly message before
  // ever touching the network.
  validateCreateParams(params);

  const tx = await contract.call("create_vesting_stream", {
    sponsor: params.sponsor,
    recipient: params.recipient,
    token: params.token,
    rate: params.rate,
    cliff_duration: params.cliffDuration,
    total_duration: params.totalDuration,
  });

  const sim = await server.simulateTransaction(tx as Parameters<typeof server.simulateTransaction>[0]);

  if (rpc.Api.isSimulationError(sim)) {
    const vestingErr = parseVestingError(sim.error);
    const message = vestingErr?.message ?? "Simulation failed. Please try again.";
    throw new Error(message);
  }

  const signedTx = await sign(
    rpc.assembleTransaction(tx as Parameters<typeof rpc.assembleTransaction>[0], sim).build(),
  );
  return server.sendTransaction(signedTx as Parameters<typeof server.sendTransaction>[0]);
}
```

---

### React hook pattern

```tsx
// src/hooks/useClaimVested.ts
import { useState, useCallback } from "react";
import { claimVested, ClaimResult } from "../actions/claimVested";

export function useClaimVested(recipient: string) {
  const [state, setState] = useState<
    | { status: "idle" }
    | { status: "pending" }
    | { status: "success"; amount: bigint }
    | { status: "error"; message: string; retryable: boolean }
  >({ status: "idle" });

  const claim = useCallback(async () => {
    setState({ status: "pending" });
    const result: ClaimResult = await claimVested(
      /* server, contract, sign */ {} as never, {} as never, recipient, {} as never,
    );
    if (result.ok) {
      setState({ status: "success", amount: result.amount });
    } else {
      setState({
        status: "error",
        message: result.userMessage,
        retryable: result.retryable,
      });
    }
  }, [recipient]);

  return { state, claim };
}

// Usage in a component:
//
// const { state, claim } = useClaimVested(recipientAddress);
//
// if (state.status === "error") {
//   return (
//     <div role="alert" aria-live="polite">
//       <p>{state.message}</p>
//       {state.retryable && <button onClick={claim}>Try again</button>}
//     </div>
//   );
// }
```

---

## Rust client examples

### With generated bindings

```rust
use vesting_cliff_drip_stream::VestingError;

match client.try_claim_vested(&recipient) {
    Ok(Ok(amount)) => {
        println!("Claimed {} tokens", amount);
    }
    Ok(Err(VestingError::CliffNotReached)) => {
        // Retryable — schedule a retry after the cliff ledger
        eprintln!("Cliff not reached; re-queuing for later");
    }
    Ok(Err(VestingError::NothingToClaim)) => {
        // Benign — nothing to do this tick
    }
    Ok(Err(VestingError::ScheduleNotFound)) => {
        // State inconsistency — trigger reconciliation
        eprintln!("No schedule found; reconciling state");
        reconcile_schedule(&recipient).await?;
    }
    Ok(Err(VestingError::TransferFailed)) => {
        // Retryable — alert and retry up to MAX_RETRIES
        eprintln!("Token transfer failed; retrying");
    }
    Ok(Err(e)) => {
        // Non-retryable contract error
        return Err(anyhow::anyhow!("Contract error {:?} (code {})", e, e as u32));
    }
    Err(invoke_err) => {
        // Network/host error — safe to retry
        return Err(anyhow::anyhow!("Invoke error: {invoke_err:?}"));
    }
}
```

### Parsing raw numeric codes (no generated bindings)

```rust
fn describe_vesting_error(code: u32) -> (&'static str, bool /* retryable */) {
    match code {
        1  => ("No active vesting stream for this recipient", false),
        2  => ("Cliff period has not ended yet", true),
        3  => ("Total duration must exceed cliff duration", false),
        4  => ("Rate must be a positive number", false),
        5  => ("Deposit amount overflows — reduce rate or duration", false),
        6  => ("A stream already exists for this recipient", false),
        7  => ("Nothing to claim at current ledger", true),
        8  => ("Stream has not yet expired", true),
        9  => ("Token transfer failed", true),
        10 => ("Drain delay period has not elapsed", true),
        11 => ("Sponsor and recipient must be different addresses", false),
        12 => ("Total deposit is below the minimum threshold", false),
        13 => ("Token does not support compliance clawback", false),
        14 => ("Contract is already initialized", false),
        15 => ("Unauthorized — admin access required", false),
        _  => ("Unknown contract error", false),
    }
}
```

### Backend worker with retry budget

```rust
use std::time::Duration;
use tokio::time::sleep;

const MAX_RETRIES: u32 = 3;

async fn claim_with_retry(
    client: &VestingDripsClient,
    recipient: &Address,
) -> Result<i128, VestingError> {
    let mut attempts = 0u32;

    loop {
        match client.try_claim_vested(recipient) {
            Ok(Ok(amount)) => return Ok(amount),

            Ok(Err(VestingError::TransferFailed)) if attempts < MAX_RETRIES => {
                attempts += 1;
                let backoff = Duration::from_secs(2u64.pow(attempts));
                eprintln!("TransferFailed — retry {}/{MAX_RETRIES} in {:?}", attempts, backoff);
                sleep(backoff).await;
            }

            Ok(Err(VestingError::NothingToClaim)) => {
                // Not an error — re-schedule for next ledger close (~5 s)
                sleep(Duration::from_secs(6)).await;
            }

            Ok(Err(e)) => return Err(e),

            Err(invoke_err) if attempts < MAX_RETRIES => {
                attempts += 1;
                eprintln!("Network error — retry {attempts}/{MAX_RETRIES}: {invoke_err:?}");
                sleep(Duration::from_secs(2u64.pow(attempts))).await;
            }

            Err(invoke_err) => {
                return Err(VestingError::TransferFailed); // surface as retriable
            }
        }
    }
}
```

---

## Retry logic and polling helpers

### Retry decision tree

```
Received error
│
├─ Is it a network/HTTP error? ──► Retry with exponential back-off (max 3×)
│
└─ Is it a VestingError code?
    │
    ├─ Code 2 (CliffNotReached) ──► Poll is_cliff_passed(); retry when true
    ├─ Code 7 (NothingToClaim)  ──► Wait one ledger (~5 s); retry
    ├─ Code 8 (StreamNotExpired)──► Poll until current_ledger >= end_ledger
    ├─ Code 9 (TransferFailed)  ──► Investigate; retry up to 3×; then alert
    ├─ Code 10 (DrainDelayNotExpired) ──► Poll until current_ledger >= end_ledger + 3_153_600
    │
    └─ All other codes ──► Do NOT retry; fix the input or state first
```

### Polling helpers (TypeScript)

```typescript
// src/lib/polling.ts

const LEDGER_CLOSE_MS = 5_000; // ~5 seconds per ledger

/**
 * Poll is_cliff_passed() until the cliff has been reached.
 * Resolves when it is safe to call claim_vested().
 */
export async function waitForCliff(
  contract: { isCliffPassed: (recipient: string) => Promise<boolean> },
  recipient: string,
  pollIntervalMs = LEDGER_CLOSE_MS,
): Promise<void> {
  while (true) {
    const passed = await contract.isCliffPassed(recipient);
    if (passed) return;
    await sleep(pollIntervalMs);
  }
}

/**
 * Poll until the drain delay has elapsed for an expired stream.
 * drainAvailableLedger = end_ledger + 3_153_600
 */
export async function waitForDrainDelay(
  server: { getLedger: () => Promise<{ sequence: number }> },
  drainAvailableLedger: number,
  pollIntervalMs = 60_000, // poll every minute; drain is ~1 year away
): Promise<void> {
  while (true) {
    const { sequence } = await server.getLedger();
    if (sequence >= drainAvailableLedger) return;
    await sleep(pollIntervalMs);
  }
}

/**
 * Estimate a human-readable time duration from a ledger count.
 * Uses 5 seconds per ledger as the average close time.
 */
export function ledgersToHumanDuration(ledgers: number): string {
  const seconds = ledgers * 5;
  if (seconds < 60)    return `${seconds} seconds`;
  if (seconds < 3_600) return `${Math.round(seconds / 60)} minutes`;
  if (seconds < 86_400) return `${Math.round(seconds / 3_600)} hours`;
  return `${Math.round(seconds / 86_400)} days`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

### Retry with exponential back-off (TypeScript)

```typescript
// src/lib/retry.ts

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: { maxAttempts?: number; baseDelayMs?: number } = {},
): Promise<T> {
  const { maxAttempts = 3, baseDelayMs = 1_000 } = options;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const isRetryable =
        // Network errors are always retryable
        classifyError(err) === "network" ||
        // Code 9 (TransferFailed) is the only contract error that is retryable immediately
        extractContractErrorCode(err) === 9;

      if (!isRetryable || attempt === maxAttempts) throw err;

      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      await sleep(delay);
    }
  }

  throw lastError;
}
```

---

*Last updated: 2026-07-29 — covers VestingError codes 1–15.*

*Codes 16–21 are reserved for future use per ADR-0004. This document will be
updated when new variants are introduced.*
