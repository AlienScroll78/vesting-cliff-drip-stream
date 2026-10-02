# Video Walkthrough Script
## Vesting Cliff Drip Stream — Soroban Smart Contract

**Format:** Screen-recorded tutorial (target: ~15 minutes)
**Audience:** Soroban developers new to vesting contracts
**Repo:** https://github.com/AlienScroll78/vesting-cliff-drip-stream

---

## [INTRO — 0:00–1:00]

> _Screen: Title slide_

"Hey everyone, welcome. In this video we're going to walk through a production-ready
Soroban smart contract that handles token vesting with a cliff and linear streaming —
two patterns you'll need for any serious contributor retention program on Stellar.

By the end you'll understand: what the contract does, how each of the three main flows
works under the hood, and how to deploy and call it on testnet yourself.

Let's start with the problem."

---

## [SECTION 1: THE PROBLEM — 1:00–2:30]

> _Screen: Slide 2 — The Problem_

"When you want to reward a contributor with tokens, you have two naive options.

Option one: hand them everything up front. The contributor can leave on day one,
sell the tokens, and you've lost your retention tool entirely.

Option two: one big cliff — they wait six months and then get everything at once.
That's better, but the moment the cliff hits they have zero incentive to keep going.

What we actually want is a combination: a lock-up period where they earn nothing,
followed by a continuous drip of tokens over time.

That's exactly what this contract implements."

---

## [SECTION 2: THE CONCEPT — 2:30–4:00]

> _Screen: Slide 3 — Token Flow Diagram_

"Here's the timeline.

`start_ledger` is when the sponsor creates the stream and deposits the full allocation
into the contract vault.

`cliff_ledger` is the first moment any tokens can be claimed. Before this, every call
to claim_vested will fail with error code 2: CliffNotReached.

`end_ledger` is when streaming stops.

The interesting part happens at the cliff. Even though tokens were accruing since
`start_ledger`, the recipient couldn't touch them. At `cliff_ledger`, all of those
accrued tokens release in one burst — a catch-up payment — and then the remaining
tokens continue to drip linearly, per ledger, until the stream ends.

This aligns incentives perfectly. Stick around for the cliff, get rewarded, and then
keep getting rewarded the longer you stay."

---

## [SECTION 3: CODE TOUR — 4:00–7:00]

> _Screen: VS Code, src/ directory_

"Let's look at the code. The project is a single Rust crate. Here's the structure:

- `contract.rs` — all five public entry-points
- `types.rs` — the `VestingSchedule` struct
- `error.rs` — seven error variants
- `events.rs` — on-chain event helpers
- `storage.rs` — persistent storage read/write

The `VestingSchedule` struct is the core data type.

```rust
pub struct VestingSchedule {
    token:               Address,
    rate_per_ledger:     i128,
    start_ledger:        u32,
    cliff_ledger:        u32,
    end_ledger:          u32,
    last_claimed_ledger: u32,
}
```

Notice `last_claimed_ledger`. This is the claim cursor — it starts at `start_ledger`
and advances each time the recipient claims. The claimable amount is always:

  `(current_ledger.min(end_ledger) - last_claimed_ledger) × rate_per_ledger`

Simple arithmetic, but the cliff check gates it entirely until `cliff_ledger` is
reached."

---

## [SECTION 4: FLOW 1 — CREATE STREAM — 7:00–9:00]

> _Screen: contract.rs, `create_vesting_stream` function_

"Flow one: creating a stream. This is what the sponsor calls.

```rust
pub fn create_vesting_stream(
    env: Env,
    sponsor: Address,
    recipient: Address,
    token: Address,
    rate: i128,
    cliff_duration: u32,
    total_duration: u32,
) -> Result<(), VestingError>
```

Walk through validation first: rate must be positive, total_duration must exceed
cliff_duration, and no existing stream for this recipient.

Then `sponsor.require_auth()` — the sponsor must sign this transaction.

The total deposit is `rate × total_duration`. We use `checked_mul` here so any
overflow returns error code 5 rather than panicking.

The token transfer moves the full allocation from the sponsor's account into the
contract's own address — the contract acts as the vault.

Finally we persist the schedule and emit the `vc_create` event.

Key point: the deposit is collected up front, in full. There's no drip from the
sponsor; the contract holds the entire budget from day one."

---

## [SECTION 5: FLOW 2 — CLAIM — 9:00–11:00]

> _Screen: contract.rs, `claim_vested` function_

"Flow two: the recipient claiming their vested tokens.

```rust
pub fn claim_vested(env: Env, recipient: Address) -> Result<i128, VestingError>
```

`recipient.require_auth()` — only the recipient can trigger their own claim.

If the current ledger is before `cliff_ledger`, we return `CliffNotReached`.
No tokens, no partial claim, no workaround.

Otherwise we compute:

```
active_end      = current_ledger.min(end_ledger)
claimable       = (active_end - last_claimed_ledger) × rate
```

We advance `last_claimed_ledger` to `active_end`. If the stream just finished —
`active_end == end_ledger` — the schedule is deleted from storage entirely.

The transfer goes from the contract to the recipient, and we emit `vc_claim`.

Notice that on the first claim ever — right at the cliff — `last_claimed_ledger`
is still `start_ledger`. So `active_end - last_claimed_ledger` covers the entire
cliff duration. That's your catch-up burst. All the tokens that accrued during the
lock-up period arrive in a single transfer."

---

## [SECTION 6: FLOW 3 — CANCEL — 11:00–12:30]

> _Screen: contract.rs, `cancel_stream` function_

"Flow three: cancellation. Only the original sponsor can cancel.

```rust
pub fn cancel_stream(env: Env, sponsor: Address, recipient: Address)
    -> Result<(), VestingError>
```

Two scenarios:

**Before the cliff:** The recipient hasn't earned anything yet. The full deposit goes
back to the sponsor. The recipient gets nothing.

**After the cliff:** We compute how much the recipient has accrued since their last
claim. They receive that. The sponsor receives everything that hasn't accrued yet —
the portion covering the unstreamed period.

This is a clean pro-rata split. Neither party can get more than they're owed, and
the contract never retains any residual balance after cancellation.

After the transfers, the schedule is deleted from storage, freeing up the entry."

---

## [SECTION 7: LIVE DEMO — 12:30–14:30]

> _Screen: Terminal_

"Now let's see this running on testnet.

Step one: generate a funded testnet key."

```bash
stellar keys generate default --network testnet --fund
```

"Step two: build and deploy. The deploy script handles building to WASM, optimising
with wasm-opt, and uploading to testnet."

```bash
./scripts/deploy.sh default
```

"Copy the contract ID from the output and export it."

```bash
export VESTING_CONTRACT=<contract-id>
```

"Step three: create a stream. We'll use a rate of 10 tokens per ledger, a cliff of
17280 ledgers (roughly one day at 5 seconds per ledger), and a total duration of
172800 ledgers (roughly ten days)."

```bash
export RATE=10
export CLIFF_DURATION=17280
export TOTAL_DURATION=172800
./scripts/invoke_create.sh
```

"The sponsor's balance drops by `rate × total_duration` immediately.

Step four: check `claimable_amount` before the cliff."

```bash
stellar contract invoke \
  --id $VESTING_CONTRACT --network testnet \
  -- claimable_amount --recipient $RECIPIENT
```

"Returns 0 — cliff hasn't passed.

Step five: after the cliff, claim."

```bash
./scripts/invoke_claim.sh
```

"The returned value is the full catch-up amount. On subsequent claims it's just the
per-ledger drip since the last claim."

---

## [OUTRO — 14:30–15:00]

> _Screen: Slide 15 — Recap_

"So to recap: the contract enforces a cliff on-chain, releases a catch-up burst at
the cliff, then streams linearly to the end. The sponsor deposits up front, only
they can cancel, and the split on cancel is always fair.

The full source is MIT-licensed at the link in the description. Clone it, run
`make test` to see all 30-plus test cases pass, and deploy it.

If you have questions, open an issue on GitHub. Thanks for watching."

---

## Production Notes

- **Total target runtime:** ~15 minutes
- **Screen setup:** 80-column terminal, 14pt font; VS Code with Rust Analyzer
- **Chapters** (add to YouTube description):
  - 0:00 Intro
  - 1:00 The Problem
  - 2:30 Concept & Timeline
  - 4:00 Code Tour
  - 7:00 Flow 1 — Create Stream
  - 9:00 Flow 2 — Claim Vested
  - 11:00 Flow 3 — Cancel Stream
  - 12:30 Live Demo on Testnet
  - 14:30 Recap & Outro
