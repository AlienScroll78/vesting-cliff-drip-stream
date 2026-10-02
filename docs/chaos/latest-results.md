# Chaos Test Results – Initial Commit

**Status:** ⏳ Pending first nightly run
**Scenarios:** 6
**Next run:** Nightly at 03:00 UTC

## Scenarios

| # | Scenario | Result |
|---|---|---|
| 1 | Horizon 429 → backoff and resume | ⏳ Pending |
| 2 | Malformed JSON → log and skip | ⏳ Pending |
| 3 | Horizon 503 → retry and resume | ⏳ Pending |
| 4 | Network timeout → retry | ⏳ Pending |
| 5 | DB lost → rollback and retry | ⏳ Pending |
| 6 | Cursor corrupt → reset to checkpoint | ⏳ Pending |

---

*This file is updated automatically by the nightly chaos test run.*
*See `.github/workflows/chaos.yml` — issue #787*
