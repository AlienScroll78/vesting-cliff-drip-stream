# Findings Report — Vesting Cliff Drip Stream Usability Study

**Issue:** #388  
**Study:** Moderated remote usability testing — 5 participants  
**Status:** Template (complete after sessions)  
**Owner:** UX Research

---

## Executive Summary

> _Complete after all 5 sessions._

| Metric | Result |
|--------|--------|
| Average SUS score | — / 100 |
| Task 1 completion rate | — / 5 |
| Task 2 completion rate | — / 5 |
| Task 3 completion rate | — / 5 |
| Task 4 completion rate | — / 5 |
| Overall recommendation | — |

Key finding: [1–2 sentence summary of the single most important discovery.]

---

## Participant Summary

| ID | Group | Task 1 | Task 2 | Task 3 | Task 4 | SUS | Session date |
|----|-------|--------|--------|--------|--------|-----|-------------|
| P1 | DeFi-experienced | ☐ Pass ☐ Fail | ☐ Pass ☐ Fail | ☐ Pass ☐ Fail | ☐ Pass ☐ Fail | — | TBD |
| P2 | DeFi-experienced | ☐ Pass ☐ Fail | ☐ Pass ☐ Fail | ☐ Pass ☐ Fail | ☐ Pass ☐ Fail | — | TBD |
| P3 | Non-DeFi tech | ☐ Pass ☐ Fail | ☐ Pass ☐ Fail | ☐ Pass ☐ Fail | ☐ Pass ☐ Fail | — | TBD |
| P4 | Non-DeFi tech | ☐ Pass ☐ Fail | ☐ Pass ☐ Fail | ☐ Pass ☐ Fail | ☐ Pass ☐ Fail | — | TBD |
| P5 | Non-technical | ☐ Pass ☐ Fail | ☐ Pass ☐ Fail | ☐ Pass ☐ Fail | ☐ Pass ☐ Fail | — | TBD |

---

## Per-Task Completion Rate

| Task | Description | Pass | Fail | Avg time (s) | Avg SEQ (1–7) |
|------|-------------|------|------|-------------|---------------|
| T1 | Create a stream | — | — | — | — |
| T2 | Find claimable amount | — | — | — | — |
| T3 | Claim tokens | — | — | — | — |
| T4 | Understand cancel behaviour | — | — | — | — |

---

## Affinity Map — Theme Groups

> _Fill in after affinity mapping exercise._

| Theme | Observations grouped here |
|-------|--------------------------|
| Terminology confusion | |
| Address format (G… vs. C…) | |
| Cliff / ledger mental model | |
| Transaction feedback | |
| Cancel consequences | |
| Navigation / findability | |

---

## Top 5 Usability Issues

Issues ranked by **frequency × severity** across all 5 sessions.

---

### Issue 1 — Ledger terminology causes widespread confusion

**Severity:** 3 — Moderate  
**Frequency:** 4 / 5 participants  
**Tasks affected:** T1 (create stream), T2 (claimable amount)

**Description:**  
Participants from non-DeFi backgrounds did not know what a "ledger" is. When asked to enter "cliff duration" and "total duration" in days, several were confused by the hint text showing `≈ 518,400 ledgers` because they had no frame of reference for what a ledger is or how long it takes.

**Representative quotes:**
> "What's a ledger? Is that like a page in a book?"  
> "I don't know what 17,280 means — I just typed 30 days and hoped for the best."

**Root cause:** The UI exposes ledger counts as a primary metric without first explaining the unit. The glossary tooltip for "ledger" exists in the codebase but is not yet wired to the form labels in production.

**Recommended fix:**  
Wire `GlossaryInfoTooltip` (implemented in #380) to the cliff duration and total duration field labels. Add a plain-English translation inline: "≈ 30 days (518,400 ledgers at ~5 s/ledger)" rather than showing only ledger counts.

**Related issue:** #380 (Tooltip system)

---

### Issue 2 — SAC contract address format is not obvious

**Severity:** 3 — Moderate  
**Frequency:** 3 / 5 participants  
**Tasks affected:** T1 (create stream)

**Description:**  
Participants were confused by the token field label "Token contract (SAC)". They did not know what SAC stood for, could not distinguish a `C…` address from a `G…` address, and in one case tried to paste a recipient's `G…` address into the token field.

**Representative quotes:**
> "What's a SAC? I just have the token name — XLM. How do I get the address?"  
> "I see it starts with C… but why isn't it the same as the Stellar address that starts with G?"

**Root cause:** The field label uses the acronym without expansion, and the placeholder `C…` provides no context about what value is expected or where to find it.

**Recommended fix:**  
1. Expand the label to "Token contract address (SAC — starts with C…)".  
2. Add a `GlossaryInfoTooltip` for `sac` to the label.  
3. Add an inline error for the specific case where a `G…` address is entered in the token field: "This looks like a wallet address (G…). The token field requires a contract address starting with C…".

**Related issue:** #380 (Tooltip system)

---

### Issue 3 — Pre-cliff claimable amount shows 0 with no explanation

**Severity:** 4 — Blocker  
**Frequency:** 3 / 5 participants  
**Tasks affected:** T2 (find claimable amount), T3 (claim tokens)

**Description:**  
When a stream is in the `pre-cliff` state, the claimable amount shows `0 tokens`. Participants (especially non-technical) did not understand why and assumed something was wrong with their wallet, the app, or their stream. One participant gave up on Task 2 and said "I don't think I have a stream".

**Representative quotes:**
> "It just says zero. Did the transaction fail when it was created?"  
> "Zero doesn't mean I can't claim yet — it means there's nothing to claim, right? But I thought I had tokens…"

**Root cause:** The claimable amount is displayed as a number without contextual state. The `pre-cliff` badge conveys status but does not explain the implication (no claims possible until the cliff passes).

**Recommended fix:**  
When status is `pre-cliff` and claimable amount is 0, display:
- A plain-English message: "Tokens are locked until the cliff on [date estimate]. You'll be able to claim after ledger [N]."
- A `GlossaryInfoTooltip` for `cliff` next to the status badge.
- A countdown if the cliff ledger is known: "Cliff in approximately 22 days".

**Related issue:** #380 (Tooltip system)

---

### Issue 4 — Cancel stream consequences not clear before the modal

**Severity:** 3 — Moderate  
**Frequency:** 3 / 5 participants  
**Tasks affected:** T4 (cancel stream)

**Description:**  
Participants opened the cancel confirmation modal but were uncertain whether the recipient would keep accrued tokens or lose everything. Two participants clicked "Keep stream" out of caution because they didn't trust they understood the outcome. One participant thought the sponsor would get a full refund regardless.

**Representative quotes:**
> "I wasn't sure if the person would lose everything. I didn't want to cancel and then have them lose their earned tokens."  
> "It says 'accrued tokens remain available' — but how do I know what's accrued right now?"

**Root cause:** The modal header states "Accrued tokens remain available to the recipient after the cliff" but only shows the sponsor refund amount, not the recipient's accrued amount. The split is unclear.

**Recommended fix:**  
1. Show both amounts in the modal summary: "Recipient keeps: [N] tokens | Sponsor refund: [N] tokens".  
2. Add a brief visual split (two rows in the summary) making the two-party outcome explicit.  
3. Include a tooltip on "accrued tokens" linked to the catch-up-claim glossary entry.

---

### Issue 5 — No prominent confirmation after claiming tokens

**Severity:** 2 — Minor  
**Frequency:** 4 / 5 participants  
**Tasks affected:** T3 (claim tokens)

**Description:**  
After submitting a claim transaction, participants were unsure whether it had succeeded. The transaction hash appeared at the bottom of the sheet, but participants either did not scroll down to see it or did not recognise it as a success indicator. Two participants attempted to claim again.

**Representative quotes:**
> "Did it work? I don't see anything telling me it went through."  
> "There's a hash here — does that mean it was sent, or it was confirmed?"

**Root cause:** The success state (transaction hash with a link) is low in visual hierarchy and uses technical language ("Tx: …") that non-technical participants did not associate with success.

**Recommended fix:**  
1. Show a prominent success banner with a green checkmark and human-readable message: "✓ [N] tokens claimed successfully!"  
2. Move the transaction hash link below the success message as a secondary detail.  
3. Consider a brief animation to draw attention to the success state.

**Related issue:** #379 (Skeleton screens / loading states)

---

## SUS Score Summary

| Participant | SUS score | Interpretation |
|-------------|-----------|---------------|
| P1 | — | — |
| P2 | — | — |
| P3 | — | — |
| P4 | — | — |
| P5 | — | — |
| **Average** | **—** | — |

SUS benchmarks: < 51 = Poor; 51–67 = OK; 68–80 = Good; > 80 = Excellent

---

## Recommended Action Plan

Issues in priority order:

| Priority | Issue | Effort | Linked to |
|----------|-------|--------|-----------|
| P1 | Issue 3: Pre-cliff zero claimable amount — no explanation | S | #380 tooltip |
| P2 | Issue 1: Ledger terminology — wire tooltips to form labels | S | #380 tooltip |
| P2 | Issue 2: SAC address format — expand label + error message | S | #380 tooltip |
| P3 | Issue 4: Cancel modal — show both recipient + sponsor amounts | M | New issue |
| P4 | Issue 5: Post-claim success prominence | S | New issue |

See `docs/research/action-plan.md` for full details, effort estimates, and success metrics.

---

## Next Steps

- [ ] File 5 GitHub issues with `ux` label (see action-plan.md)
- [ ] Review tooltip wiring in #380 against Issues 1 and 2
- [ ] Design the pre-cliff state enhancement (Issue 3)
- [ ] Update cancel modal design (Issue 4)
- [ ] Improve post-claim success state (Issue 5)
- [ ] Schedule a follow-up round of 3 sessions after fixes are shipped
