# Frequently Asked Questions

---

## Stream Lifecycle

**Q: What happens if the cliff ledger is never reached?**

Nothing is claimable. Tokens stay locked in the contract vault until either the cliff ledger arrives (at which point the recipient can claim all accrued tokens at once) or the sponsor cancels the stream. If the sponsor cancels before the cliff, the **full deposit is refunded to the sponsor** — the recipient receives nothing.

---

**Q: What happens when the stream reaches `end_ledger`?**

Accrual stops at `end_ledger`. The recipient can still call `claim_vested` after that point to collect any unclaimed tokens; the cap logic in the contract uses `min(current_ledger, end_ledger)` so no extra tokens are paid out. Once the final claim is processed the schedule is deleted from storage and a `StreamCompleted` event is emitted.

---

**Q: Can the rate be changed after a stream is created?**

No. `rate_per_ledger` is immutable once the stream is created. There is no `update_stream` entry-point. To change the rate you must cancel the existing stream (subject to the refund rules above) and create a new one.

---

**Q: Can `cliff_duration` or `total_duration` be changed after creation?**

No, for the same reason — the `VestingSchedule` stored on-chain is write-once after `create_vesting_stream`. Cancel and recreate if you need different durations.

---

**Q: Can a recipient have more than one active stream at a time?**

Not from the same contract deployment — the schedule is keyed by recipient address, so a second `create_vesting_stream` call for the same recipient fails with `ScheduleAlreadyExists` (error 6). If you need multiple concurrent streams for one address, deploy a second contract instance.

---

**Q: Who can cancel a stream?**

Only the original **sponsor** (the address that called `create_vesting_stream`). The sponsor address is not stored explicitly; `cancel_stream` accepts a `sponsor` argument and calls `sponsor.require_auth()`, so the transaction must be signed by the sponsor. Recipients cannot cancel their own stream.

---

**Q: What does the recipient keep when a stream is cancelled?**

- **Before the cliff**: the recipient keeps nothing; the full remaining deposit is returned to the sponsor.
- **After the cliff**: the recipient keeps all tokens accrued up to the cancellation ledger (they are transferred immediately by the cancel transaction). The sponsor receives the unaccrued remainder.

---

**Q: Is there a way to pause a stream?**

No pause mechanism exists. The contract has no admin key and no pause entry-point. The only options are cancel-and-recreate or wait.

---

## Claiming

**Q: How often should a recipient call `claim_vested`?**

As often or as rarely as you like — there is no penalty for waiting. Each call collects all accrued tokens since the last claim in a single transfer. Waiting costs nothing beyond the opportunity cost of having tokens sit in the contract.

---

**Q: What happens on the first claim after the cliff?**

All tokens accrued from `start_ledger` through the current ledger are released in a single "catch-up" transfer. This is the intended cliff behaviour — tokens accumulate silently during the cliff period and unlock in one lump sum.

---

**Q: Why does `claim_vested` return `NothingToClaim`?**

Either the cliff has not been reached yet (which returns `CliffNotReached`, error 2), or the stream has ended and all tokens were already claimed in a previous transaction. `claimable_amount` is a free read-only view you can query before attempting a claim to avoid a failed transaction.

---

## Token Support

**Q: Which tokens are supported?**

Any token that implements the Stellar Asset Contract (SAC) interface — i.e. exposes a `transfer(from, to, amount)` function conforming to the SEP-41 token interface. This covers all Stellar classic assets wrapped via SAC and any custom Soroban token that follows the standard. Non-standard tokens missing the `transfer` function will cause the `create_vesting_stream` transaction to fail at the transfer step.

---

**Q: Can native XLM be streamed?**

Yes. The native XLM asset has a SAC contract address on every Stellar network. Pass that address as the `token` argument. You can obtain the native asset contract address with:

```bash
stellar contract id asset --asset native --network testnet
```

---

**Q: Are NFTs or non-fungible assets supported?**

No. The contract works with fungible amounts expressed as `i128`. NFTs do not expose the SAC fungible token interface.

---

## Gas & Fees

**Q: Who pays the transaction fees?**

The transaction submitter pays Stellar network fees (the base fee in stroops). For `create_vesting_stream` the sponsor typically submits and pays. For `claim_vested` the recipient submits and pays. There are no protocol-level fees charged by this contract itself.

---

**Q: How expensive is `create_vesting_stream` in fees?**

The operation performs one token `transfer` (sponsor → contract vault) and one persistent storage write plus a TTL bump. Expect a higher fee than a simple payment due to the storage write, but still well within typical Soroban resource budgets. Run `stellar contract invoke --fee <amount>` with a generous fee on testnet to measure the actual resource consumption for your specific inputs.

---

**Q: Is there a risk of the stream data expiring from storage?**

TTL is extended to ~60 days on every read or write. For streams longer than 60 days without any interaction (no claims, no cancellation), call `get_schedule` periodically to trigger a TTL bump. In practice, any `claim_vested` call resets the TTL. If a stream's storage entry does expire it can no longer be claimed or cancelled — tokens would be locked. Keep streams active by claiming at least once every ~60 days.

---

## Security & Errors

**Q: Can the contract be upgraded or paused by a hidden admin?**

No. The contract has no `upgrade`, `pause`, or admin entry-point. Once deployed, behaviour is fixed by the WASM bytecode. There is no owner key.

**Q: What does error code 5 (`DepositOverflow`) mean?**

The product `rate × total_duration` exceeds `i128::MAX`. Lower the rate or the duration. The safe upper bound for rate given a duration is `i128::MAX / total_duration` (≈ `1.7 × 10^38 / total_duration`).

---

*Last updated: 2026-06-26. Open an issue if your question isn't answered here.*
