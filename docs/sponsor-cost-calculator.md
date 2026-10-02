# Sponsor Cost Calculator

Understand the financial implications of different `rate`, `cliff_duration`, and `total_duration` combinations before creating a vesting stream.

---

## How the Deposit Is Calculated

The full deposit is transferred upfront when calling `create_vesting_stream`:

```
total_deposit = rate × total_duration
```

The cliff does **not** reduce the deposit — tokens accrue from `start_ledger` and are simply locked until `cliff_ledger`.

---

## Ledger-to-Time Conversion

Stellar averages ~5 seconds per ledger:

| Period | Ledgers |
|---|---|
| 1 day | 17,280 |
| 1 week | 120,960 |
| 1 month (~30 d) | 518,400 |
| 1 year (~365 d) | 6,307,200 |

---

## Examples

### Example 1 — Short cliff, long stream

| Parameter | Value |
|---|---|
| `rate` | 10 tokens/ledger |
| `cliff_duration` | 17,280 ledgers (1 day) |
| `total_duration` | 518,400 ledgers (30 days) |
| **Total deposit** | **5,184,000 tokens** |
| Cliff catch-up (day 1) | 172,800 tokens |
| Daily drip after cliff | 172,800 tokens/day |

### Example 2 — Long cliff, moderate stream

| Parameter | Value |
|---|---|
| `rate` | 5 tokens/ledger |
| `cliff_duration` | 518,400 ledgers (30 days) |
| `total_duration` | 2,592,000 ledgers (150 days) |
| **Total deposit** | **12,960,000 tokens** |
| Cliff catch-up (day 30) | 2,592,000 tokens |
| Daily drip after cliff | 86,400 tokens/day |

### Example 3 — Minimal stream

| Parameter | Value |
|---|---|
| `rate` | 1 token/ledger |
| `cliff_duration` | 17,280 ledgers (1 day) |
| `total_duration` | 34,560 ledgers (2 days) |
| **Total deposit** | **34,560 tokens** |
| Cliff catch-up (day 1) | 17,280 tokens |
| Remaining after cliff | 17,280 tokens |

---

## JavaScript Calculator

Use this snippet to compute costs before submitting a transaction:

```js
const LEDGERS_PER_DAY = 17_280;

function calcVestingCost({ ratePerLedger, cliffDays, totalDays }) {
  const cliffDuration = cliffDays * LEDGERS_PER_DAY;
  const totalDuration = totalDays * LEDGERS_PER_DAY;

  if (totalDuration <= cliffDuration) {
    throw new Error("total_duration must be greater than cliff_duration");
  }
  if (ratePerLedger <= 0) {
    throw new Error("rate must be greater than 0");
  }

  const totalDeposit = BigInt(ratePerLedger) * BigInt(totalDuration);
  const cliffCatchUp = BigInt(ratePerLedger) * BigInt(cliffDuration);
  const remainingAfterCliff = totalDeposit - cliffCatchUp;
  const dailyDripAfterCliff = BigInt(ratePerLedger) * BigInt(LEDGERS_PER_DAY);

  return { totalDeposit, cliffCatchUp, remainingAfterCliff, dailyDripAfterCliff };
}

// Example
console.log(calcVestingCost({ ratePerLedger: 10, cliffDays: 1, totalDays: 30 }));
// {
//   totalDeposit: 5184000n,
//   cliffCatchUp: 172800n,
//   remainingAfterCliff: 5011200n,
//   dailyDripAfterCliff: 172800n
// }
```

---

## Cancellation Refund Scenarios

| Cancelled at | Cliff passed? | Sponsor refund | Recipient receives |
|---|---|---|---|
| Before cliff | No | Full deposit | 0 |
| At cliff | Yes | Tokens from cliff → end | Tokens from start → cliff |
| Midstream | Yes | Unclaimed tokens from cancel → end | Accrued since last claim |
| After end | Yes | 0 | All remaining unclaimed |

---

## Constraints

- `rate` must be `> 0`
- `total_duration` must be `> cliff_duration`
- `total_deposit` must not overflow `i128` (max ~170 × 10¹⁸)
- The full deposit is locked in the contract vault immediately on stream creation
