# Error Handling Guide

This guide covers every error code the `VestingDrips` contract can return,
the four UI error categories, user-facing message copy, retry logic, and
JavaScript / Rust integration examples.

---

## How errors surface

Soroban contract errors are returned as a `u32` code inside a
`ScError::Contract` variant. In practice:

- **Stellar CLI** — printed as `Error(Contract, #N)`
- **JavaScript SDK** — thrown as a simulation error response with `result.error`
  containing the code
- **Rust client** — returned as `Err(VestingError::Variant)` from a generated
  binding, or as an `InvokeContractError` with the raw `u32`

---

## Error categories

Errors are grouped into four categories. The UI renders a different
illustration and colour scheme for each one.

| Category | Colour | Used for |
|----------|--------|---------|
| `auth` | Violet | Cliff not reached, schedule not found, invalid recipient |
| `contract` | Indigo/blue | Validation failures, duplicate schedules, timing constraints |
| `network` | Amber | Token transfer failures — show a retry button |
| `unexpected` | Red | Unknown error codes — show a docs/support link |

---

## Error code reference

All 11 error codes, their categories, and recommended client-side responses:

| Code | Name | Category | Retryable | Trigger | Recommended action |
|------|------|----------|-----------|---------|-------------------|
| 1 | `ScheduleNotFound` | auth | ✗ | No active stream for recipient | Show "no stream found" UI; don't retry |
| 2 | `CliffNotReached` | auth | ✓ (wait) | Claim before cliff ledger | Show time remaining; retry after cliff |
| 3 | `InvalidDuration` | contract | ✗ | `total_duration ≤ cliff_duration` | Reject in form validation; never submit |
| 4 | `InvalidRate` | contract | ✗ | `rate ≤ 0` | Reject in form validation; never submit |
| 5 | `DepositOverflow` | contract | ✗ | `rate × total_duration` overflows `i128` | Reduce rate or duration; never submit |
| 6 | `ScheduleAlreadyExists` | contract | ✗ | Create called for a recipient who already has a stream | Inform sponsor; offer to view existing stream |
| 7 | `NothingToClaim` | contract | ✓ (wait) | Claimable amount is zero | Suppress or show "up to date"; retry next ledger |
| 8 | `StreamNotExpired` | contract | ✓ (wait) | `emergency_drain` called before `end_ledger` | Show end date; retry after end ledger |
| 9 | `TransferFailed` | network | ✓ | SAC transfer rejected (frozen/insufficient balance) | Show retry button; check token account status |
| 10 | `DrainDelayNotExpired` | contract | ✓ (wait) | Drain called before delay elapsed | Show delay end date; retry after delay passes |
| 11 | `InvalidRecipient` | auth | ✗ | Sponsor and recipient are the same address | Reject in form validation; never submit |

---

## User-facing message copy

These messages are shown directly to end users. No error codes are exposed.
Every message states *what happened* and *what to do next*.

| Code | Title | Explanation | Action |
|------|-------|-------------|--------|
| 1 | No vesting stream found | We couldn't find an active vesting stream for your wallet address. | Make sure you're connected with the right wallet. If you're expecting a stream, ask your sponsor to create one for your address. |
| 2 | Tokens are still locked | Your vesting cliff hasn't been reached yet. Tokens can't be claimed until the cliff date passes. | Check the cliff date on your stream and come back then. No action is needed right now. |
| 3 | Invalid stream duration | The total vesting duration must be longer than the cliff duration. | Increase the total duration or shorten the cliff so there's time left after the cliff to drip tokens. |
| 4 | Invalid token rate | The token rate per ledger must be a positive number greater than zero. | Enter a rate of at least 1 token per ledger. |
| 5 | Deposit amount too large | The combination of rate and duration would result in a deposit that's too large to process. | Reduce the rate, shorten the duration, or both, so the total deposit stays within the allowed limit. |
| 6 | Stream already exists | A vesting stream is already active for this recipient address. | Cancel the existing stream before creating a new one for the same recipient. |
| 7 | Nothing to claim right now | There are no tokens available to claim at this moment. Tokens accrue every ledger. | Wait a moment and try again. Your balance grows automatically with each new ledger. |
| 8 | Stream hasn't ended yet | This action requires the stream to have fully completed, but the end date hasn't passed yet. | Wait until the stream's end date has passed before trying this again. |
| 9 | Token transfer failed | The token transfer couldn't be completed. This can happen if the account is frozen, has insufficient balance, or the token contract rejected the transfer. | Check your account status and token balance, then try again. If the problem persists, contact your token issuer. |
| 10 | Too early to drain | There's a mandatory waiting period after a stream ends before unclaimed tokens can be recovered. | Wait for the full delay period to pass after the stream's end date, then try again. |
| 11 | Invalid recipient address | The sponsor and recipient can't be the same wallet address. | Enter a different recipient address that is not your own wallet. |

---

## Tone guidelines

- **Calm**: never use words like "fatal", "crash", or "broken".
- **Actionable**: always tell the user what to do next.
- **Jargon-free**: avoid "ledger", "SAC", "i128" in user-facing copy. Use "tokens", "date", "amount".
- **No codes**: never show raw numeric codes to end users.

---

## JavaScript examples

### Simulate before submitting

Always simulate first. A simulation failure is free; a submitted failure costs a fee.

```js
import { Contract, rpc } from "@stellar/stellar-sdk";

const VESTING_ERRORS = {
  1:  { name: "ScheduleNotFound",      message: "No vesting stream found for this address." },
  2:  { name: "CliffNotReached",       message: "Tokens are still locked. The cliff period has not passed." },
  3:  { name: "InvalidDuration",       message: "Total duration must be greater than the cliff duration." },
  4:  { name: "InvalidRate",           message: "Token rate must be a positive number greater than zero." },
  5:  { name: "DepositOverflow",       message: "Rate or duration is too large. Please reduce them." },
  6:  { name: "ScheduleAlreadyExists", message: "A vesting stream already exists for this recipient." },
  7:  { name: "NothingToClaim",        message: "Nothing to claim right now. Try again in a moment." },
  8:  { name: "StreamNotExpired",      message: "The stream hasn't ended yet. Wait until the end date." },
  9:  { name: "TransferFailed",        message: "Token transfer failed. Check your account and try again." },
  10: { name: "DrainDelayNotExpired",  message: "Too early to drain. Wait for the delay period to pass." },
  11: { name: "InvalidRecipient",      message: "Sponsor and recipient must be different addresses." },
};

function parseContractError(error) {
  const match = String(error).match(/Error\(Contract, #(\d+)\)/);
  if (match) {
    const code = parseInt(match[1], 10);
    return VESTING_ERRORS[code] ?? { name: "UnknownError", message: "An unexpected error occurred." };
  }
  return null;
}

async function claimVested(server, contract, recipientKeypair) {
  try {
    const tx = await contract.call("claim_vested", { recipient: recipientKeypair.publicKey() });
    const sim = await server.simulateTransaction(tx);

    if (rpc.Api.isSimulationError(sim)) {
      const err = parseContractError(sim.error);
      if (err) {
        if (err.name === "CliffNotReached") {
          const ledgersRemaining = await getLedgersUntilCliff(server, contract, recipientKeypair.publicKey());
          return { ok: false, userMessage: `${err.message} (~${ledgersToTime(ledgersRemaining)} remaining)` };
        }
        return { ok: false, userMessage: err.message };
      }
      throw new Error(sim.error);
    }

    const result = await submitTransaction(server, tx, sim, recipientKeypair);
    return { ok: true, amount: result };
  } catch (e) {
    // Code 9 is retryable — surface the retry option in the UI
    return { ok: false, userMessage: "Transaction failed. Please try again.", retryable: true };
  }
}
```

### Creating a stream with pre-flight validation

```js
function validateCreateParams({ rate, cliffDuration, totalDuration, sponsor, recipient }) {
  if (sponsor === recipient)            throw new Error(VESTING_ERRORS[11].message);
  if (rate <= 0)                        throw new Error(VESTING_ERRORS[4].message);
  if (totalDuration <= cliffDuration)   throw new Error(VESTING_ERRORS[3].message);
  // Guard against overflow: rate * totalDuration must fit i128
  const MAX_I128 = BigInt("170141183460469231731687303715884105727");
  if (BigInt(rate) * BigInt(totalDuration) > MAX_I128) throw new Error(VESTING_ERRORS[5].message);
}
```

---

## Rust examples

### With generated bindings

```rust
use vesting_cliff_drip_stream::VestingError;

match client.claim_vested(&recipient) {
    Ok(amount) => println!("Claimed {amount} tokens"),
    Err(VestingError::CliffNotReached) => {
        eprintln!("Cliff not reached; retrying later");
    }
    Err(VestingError::NothingToClaim) => {
        // benign; nothing to do
    }
    Err(VestingError::ScheduleNotFound) => {
        eprintln!("No stream for this recipient");
    }
    Err(VestingError::TransferFailed) => {
        eprintln!("Token transfer failed; check account status");
    }
    Err(e) => return Err(e.into()),
}
```

### Parsing raw error codes without bindings

```rust
fn parse_vesting_error(code: u32) -> &'static str {
    match code {
        1  => "No active vesting stream for this recipient",
        2  => "Cliff period has not ended yet",
        3  => "Total duration must exceed cliff duration",
        4  => "Rate must be positive",
        5  => "Deposit amount overflows — reduce rate or duration",
        6  => "A stream already exists for this recipient",
        7  => "Nothing to claim at current ledger",
        8  => "Stream has not yet expired",
        9  => "Token transfer failed",
        10 => "Drain delay period has not elapsed",
        11 => "Sponsor and recipient must be different addresses",
        _  => "Unknown contract error",
    }
}
```

---

## Retry logic

| Error | Strategy |
|---|---|
| `CliffNotReached` (2) | Poll `is_cliff_passed(recipient)` every N ledgers; claim once it returns `true` |
| `NothingToClaim` (7) | Wait at least one ledger; the claimable amount grows by `rate_per_ledger` per ledger |
| `StreamNotExpired` (8) | Poll until current ledger ≥ `end_ledger` |
| `TransferFailed` (9) | Show retry button; investigate account freeze or balance before retrying |
| `DrainDelayNotExpired` (10) | Poll until current ledger ≥ `end_ledger + DRAIN_DELAY_LEDGERS` |
| All others | Do not retry without fixing the input or condition — they will not resolve on their own |

### Polling helper (JavaScript)

```js
async function waitForCliff(server, contract, recipient, pollIntervalMs = 10_000) {
  while (true) {
    const passed = await contract.call("is_cliff_passed", { recipient });
    if (passed) return;
    await new Promise(r => setTimeout(r, pollIntervalMs));
  }
}
```

---

## UI components

The frontend ships two ready-to-use components:

### `ContractErrorState`

Renders a full error state with illustration, title, explanation, and action
buttons. Import from `@/components/ContractErrorState`.

```tsx
import { ContractErrorState } from "@/components/ContractErrorState";

// Render error for code 9 (TransferFailed) with a retry button
<ContractErrorState code={9} onRetry={() => submitTx()} />

// Render error for code 2 (CliffNotReached) — no retry button shown
<ContractErrorState code={2} />
```

### `ErrorStateIllustration`

Renders only the SVG illustration for a given category. Import from
`@/components/ErrorStateIllustration`.

```tsx
import { ErrorStateIllustration } from "@/components/ErrorStateIllustration";

<ErrorStateIllustration category="network" size={64} />
```

---

*Last updated: 2026-07-29 — covers VestingError codes 1–11.*
