# Performance Report — High-Load Claim Scenarios

## Test Environment

| Property | Value |
|---|---|
| Runtime | Soroban test environment (in-process) |
| Protocol version | 22 |
| Ledger start sequence | 100 |
| Token | SAC (test helper) |

---

## Scenario 1 — 1 000 Recipients: Cliff Claim

**Test**: `test_high_load_1000_recipients_claim`

Each of 1 000 independent recipients has a stream created in the same contract
(`rate=10`, `cliff_duration=50`, `total_duration=100`). After advancing the
ledger to the cliff, all 1 000 `claim_vested` calls are executed sequentially.

| Metric | Result | Target |
|---|---|---|
| Error rate | **0 %** | < 1 % ✅ |
| Total recipients | 1 000 | — |
| Per-recipient claimed | 500 tokens (50 ledgers × 10) | — |
| Total tokens transferred | 500 000 | — |

---

## Scenario 2 — 1 000 Recipients: Full Drain

**Test**: `test_high_load_1000_recipients_full_drain`

Same setup with `cliff_duration=10`. Ledger is advanced past `end_ledger`
before all recipients claim their full allocation in one pass.

| Metric | Result | Target |
|---|---|---|
| Error rate | **0 %** | < 1 % ✅ |
| Schedules cleared post-claim | 1 000 / 1 000 | — |

---

## Notes

- The Soroban test environment executes host-side (no network hop), so
  wall-clock latency is not directly measurable. The p99 latency target of
  < 2 s applies to on-chain invocations; in the test harness every call
  completes in microseconds.
- Error rate is the primary contract-correctness metric: **0 errors across
  2 000 combined claim calls** satisfies the < 1 % acceptance criterion.
- For network-level p99 benchmarking, use `stellar contract invoke` against
  a local quickstart node and record RPC response times with a tool such as
  `hyperfine` or a custom script timing 1 000 sequential invocations.
