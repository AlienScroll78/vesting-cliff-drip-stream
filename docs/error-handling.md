# Error Handling Guide for Integrators

This guide covers every error code the `VestingDrips` contract can return,
recommended client-side responses, retry logic, and user-facing message copy.

---

## How errors surface

Soroban contract errors are returned as a `u32` code inside a
`ScError::Contract` variant. In practice:

- **Stellar CLI** — printed as `Error(Contract, #N)`
- **JavaScript SDK** — thrown as `SorobanRpc.Api.SorobanRpc.SimulateTransactionErrorResponse`
  with `result.error` containing the code
- **Rust client** — returned as `Err(VestingError::Variant)` from a generated
  binding, or as an `InvokeContractError` with the raw `u32`

---

## Error code reference

| Code | Name | Trigger | Recommended action | Retryable |
|------|------|---------|-------------------|-----------|
| 1 | `ScheduleNotFound` | No active stream for recipient | Show "no stream found" UI; don't retry | ✗ |
| 2 | `CliffNotReached` | Claim before cliff ledger | Show time remaining; retry after cliff | ✓ (wait) |
| 3 | `InvalidDuration` | `total_duration ≤ cliff_duration` | Reject in form validation; never submit | ✗ |
| 4 | `InvalidRate` | `rate ≤ 0` | Reject in form validation; never submit | ✗ |
| 5 | `DepositOverflow` | `rate × total_duration` overflows `i128` | Reduce rate or duration; never submit | ✗ |
| 6 | `ScheduleAlreadyExists` | Create called for a recipient who already has a stream | Inform sponsor; offer to view existing stream | ✗ |
| 7 | `NothingToClaim` | Claimable amount is zero | Suppress or show "up to date"; retry next ledger | ✓ (wait) |

---

## JavaScript examples

### Simulate before submitting

Always simulate first. A simulation failure is free; a submitted failure costs a fee.

```js
import { Contract, rpc } from "@stellar/stellar-sdk";

const VESTING_ERRORS = {
  1: { name: "ScheduleNotFound",    message: "No active vesting stream found for this address." },
  2: { name: "CliffNotReached",     message: "The cliff period has not ended yet. Check back later." },
  3: { name: "InvalidDuration",     message: "Total duration must be greater than cliff duration." },
  4: { name: "InvalidRate",         message: "Rate must be a positive number." },
  5: { name: "DepositOverflow",     message: "Rate or duration is too large. Please reduce them." },
  6: { name: "ScheduleAlreadyExists", message: "A vesting stream already exists for this recipient." },
  7: { name: "NothingToClaim",      message: "Nothing to claim right now. Try again after the next ledger." },
};

function parseContractError(error) {
  // Stellar SDK surfaces contract errors in the simulation result
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
        // Code 2: tell the user when to come back
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
    return { ok: false, userMessage: "Transaction failed. Please try again." };
  }
}
```

### Creating a stream with pre-flight validation

```js
function validateCreateParams({ rate, cliffDuration, totalDuration }) {
  if (rate <= 0)                    throw new Error(VESTING_ERRORS[4].message);
  if (totalDuration <= cliffDuration) throw new Error(VESTING_ERRORS[3].message);
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
        // schedule a retry after the cliff ledger
        eprintln!("Cliff not reached; retrying later");
    }
    Err(VestingError::NothingToClaim) => {
        // benign; nothing to do
    }
    Err(VestingError::ScheduleNotFound) => {
        eprintln!("No stream for this recipient");
    }
    Err(e) => return Err(e.into()),
}
```

### Parsing raw error codes without bindings

```rust
fn parse_vesting_error(code: u32) -> &'static str {
    match code {
        1 => "No active vesting stream for this recipient",
        2 => "Cliff period has not ended yet",
        3 => "Total duration must exceed cliff duration",
        4 => "Rate must be positive",
        5 => "Deposit amount overflows — reduce rate or duration",
        6 => "A stream already exists for this recipient",
        7 => "Nothing to claim at current ledger",
        _ => "Unknown contract error",
    }
}
```

---

## Retry logic

| Error | Strategy |
|---|---|
| `CliffNotReached` (2) | Poll `is_cliff_passed(recipient)` every N ledgers; claim once it returns `true` |
| `NothingToClaim` (7) | Wait at least one ledger; the claimable amount grows by `rate_per_ledger` per ledger |
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

## User-facing message copy

| Code | Suggested UI message |
|------|---------------------|
| 1 | "No vesting stream found for this address." |
| 2 | "Your tokens are still locked. The cliff ends at ledger {cliff_ledger}." |
| 3 | "Invalid schedule: total duration must be longer than the cliff." |
| 4 | "Invalid rate: must be greater than zero." |
| 5 | "The deposit amount is too large. Please reduce the rate or duration." |
| 6 | "A vesting stream already exists for this recipient." |
| 7 | "Nothing to claim yet. Tokens accrue every ledger — check back shortly." |
