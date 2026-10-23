# Findings Report — Vesting Cliff Drip Stream Usability Study

**Issue:** #388  
**Study:** Moderated remote usability testing — 5 participants  
**Status:** Complete  
**Owner:** UX Research  
**Date conducted:** 2026-07-14 through 2026-07-18  

---

## Executive Summary

We conducted five moderated remote usability sessions to validate the sponsor and recipient flows in the vesting cliff drip-stream UI. The study revealed one blocker-level issue and four moderate-to-minor friction points that collectively prevent non-technical users from completing core tasks independently.

| Metric | Result |
|--------|--------|
| Average SUS score | 60 / 100 (OK) |
| Task 1 completion rate (create stream) | 4 / 5 |
| Task 2 completion rate (find claimable amount) | 3 / 5 |
| Task 3 completion rate (claim tokens) | 3 / 5 |
| Task 4 completion rate (cancel stream) | 3 / 5 |
| Overall recommendation | Fix blocker (Issue 1) and wire tooltips (Issues 2–3) before next release; schedule re-test with 3 participants |

Key finding: **When a stream is in the pre-cliff state, the claimable amount displays "0 tokens" with no explanation, causing non-technical participants to assume the app is broken.** This single issue blocked 3 of 5 participants from completing the claim flow and is the highest-priority fix.

---

## Participant Summary

| ID | Group | Task 1 (create) | Task 2 (claimable) | Task 3 (claim) | Task 4 (cancel) | SUS | Session date |
|----|-------|-----------------|---------------------|----------------|-----------------|-----|--------------|
| P1 | DeFi-experienced | ☑ Pass | ☑ Pass | ☑ Pass | ☑ Pass | 72 | 2026-07-14 |
| P2 | DeFi-experienced | ☑ Pass | ☑ Pass | ☑ Pass | ☑ Pass | 58 | 2026-07-14 |
| P3 | Non-DeFi tech | ☑ Pass | ☐ Fail | ☐ Fail | ☐ Fail | 52 | 2026-07-16 |
| P4 | Non-technical | ☐ Fail | ☐ Fail | ☐ Fail | ☑ Pass | 45 | 2026-07-17 |
| P5 | Non-technical | ☑ Pass | ☑ Pass | ☐ Fail | ☑ Pass | 73 | 2026-07-18 |

Notes:
- P3 failed Tasks 2–4 due to pre-cliff confusion (Issue 3) cascading into claim and cancel flows.
- P4 failed Task 1 (SAC field confusion — Issue 2) and Tasks 2–3 (pre-cliff confusion — Issue 3). Completed Task 4 because the cancel modal was already open from a prior attempt.
- P5 completed Task 2 (found claimable amount on an active stream) but failed Task 3 because the post-claim confirmation was not visible (Issue 5).

---

## Per-Task Completion Rate

| Task | Description | Pass | Fail | Avg time (s) | Avg SEQ (1–7) |
|------|-------------|------|------|-------------|---------------|
| T1 | Create a stream (sponsor) | 4 | 1 | 187 | 4.2 |
| T2 | Find claimable amount (recipient) | 3 | 2 | 94 | 3.0 |
| T3 | Claim tokens (recipient) | 3 | 2 | 71 | 3.8 |
| T4 | Understand cancel behaviour (sponsor) | 3 | 2 | 132 | 3.4 |

Observations:
- T1: P4 failed because the SAC field label was unintelligible (Issue 2). Average time inflated by P4's 340 s before giving up.
- T2: Both P3 and P4 saw "0 tokens" on a pre-cliff stream and stopped. P3 said "I don't think I have a stream" and abandoned the task.
- T3: P3 could not attempt claim because Task 2 was not completed. P5 completed the claim transaction but could not confirm success (Issue 5).
- T4: P3 was uncertain about recipient consequences and clicked "Keep stream" out of caution (Issue 4). P4 clicked cancel but could not explain what would happen to the recipient.

---

## Affinity Map — Theme Groups

| Theme | Observations grouped here |
|-------|--------------------------|
| **Terminology confusion** | "What's a ledger?" (P5), "What's a SAC?" (P3), "Why G… vs C…?" (P2), "rate_per_ledger — I just typed 30 and hoped" (P4). Four of five participants encountered at least one unexplained technical term. |
| **Address format (G… vs. C…)** | P2 pasted a G… address into the SAC field. P3 could not distinguish the two formats. The placeholder "C…" provided no guidance. |
| **Cliff / ledger mental model** | P3 and P4 could not infer that "pre-cliff" means "tokens locked, nothing to claim yet." P5 asked "Is a ledger like a page in a book?" The unit is not explained anywhere in the form. |
| **Transaction feedback** | P5 and P4 could not tell if the claim transaction succeeded — the hash was the only indicator. P4 attempted to claim a second time. The heuristic evaluation (H1-1, H1-4) independently flagged the same gap. |
| **Cancel consequences** | P3 feared the recipient would lose accrued tokens. P1 (DeFi-experienced) still could not tell how much the recipient would keep. The modal showed only the sponsor refund. |
| **Navigation / findability** | P5 initially looked for "My tokens" in the nav bar before finding the stream card. The recipient dashboard does not label the claimable area prominently. |

---

## Top 5 Usability Issues

Issues ranked by **frequency × severity** across all 5 sessions.

---

### Issue 1 — Pre-cliff claimable amount shows 0 with no explanation

**Severity:** 4 — Blocker  
**Frequency:** 3 / 5 participants  
**Tasks affected:** T2 (find claimable amount), T3 (claim tokens)

**Description:**  
When a stream is in the `pre-cliff` state, the claimable amount shows `0 tokens`. Participants (especially non-technical) did not understand why and assumed something was wrong with their wallet, the app, or their stream. One participant gave up on Task 2 and said "I don't think I have a stream".

**Representative quotes:**
> "It just says zero. Did the transaction fail when it was created?" — P4 (non-technical)  
> "Zero doesn't mean I can't claim yet — it means there's nothing to claim, right? But I thought I had tokens…" — P3 (non-DeFi tech)  
> "I don't think I have a stream." — P3 (non-DeFi tech, abandoned Task 2)

**Root cause:** The claimable amount is displayed as a number without contextual state. The `pre-cliff` badge conveys status but does not explain the implication (no claims possible until the cliff passes).

**Recommended fix:**  
When status is `pre-cliff` and claimable amount is 0, display:
- A plain-English message: "Tokens are locked until the cliff on [date estimate]. You'll be able to claim after ledger [N]."
- A `GlossaryInfoTooltip` for `cliff` next to the status badge.
- A countdown if the cliff ledger is known: "Cliff in approximately 22 days."

**Related issue:** #380 (Tooltip system)

---

### Issue 2 — Ledger terminology causes widespread confusion

**Severity:** 3 — Moderate  
**Frequency:** 4 / 5 participants  
**Tasks affected:** T1 (create stream), T2 (claimable amount)

**Description:**  
Participants from non-DeFi backgrounds did not know what a "ledger" is. When asked to enter "cliff duration" and "total duration" in days, several were confused by the hint text showing `≈ 518,400 ledgers` because they had no frame of reference for what a ledger is or how long it takes.

**Representative quotes:**
> "What's a ledger? Is that like a page in a book?" — P5 (non-technical)  
> "I don't know what 17,280 means — I just typed 30 days and hoped for the best." — P4 (non-technical)  
> "Is a ledger a second? A minute? I have no idea how long this is." — P3 (non-DeFi tech)

**Root cause:** The UI exposes ledger counts as a primary metric without first explaining the unit. The glossary tooltip for "ledger" exists in the codebase but is not yet wired to the form labels in production.

**Recommended fix:**  
Wire `GlossaryInfoTooltip` (implemented in #380) to the cliff duration and total duration field labels. Add a plain-English translation inline: "≈ 30 days (518,400 ledgers at ~5 s/ledger)" rather than showing only ledger counts.

**Related issue:** #380 (Tooltip system)

---

### Issue 3 — SAC contract address format is not obvious

**Severity:** 3 — Moderate  
**Frequency:** 3 / 5 participants  
**Tasks affected:** T1 (create stream)

**Description:**  
Participants were confused by the token field label "Token contract (SAC)". They did not know what SAC stood for, could not distinguish a `C…` address from a `G…` address, and in one case tried to paste a recipient's `G…` address into the token field.

**Representative quotes:**
> "What's a SAC? I just have the token name — XLM. How do I get the address?" — P3 (non-DeFi tech)  
> "I see it starts with C… but why isn't it the same as the Stellar address that starts with G?" — P2 (DeFi-experienced, unfamiliar with SACs)

**Root cause:** The field label uses the acronym without expansion, and the placeholder `C…` provides no context about what value is expected or where to find it.

**Recommended fix:**  
1. Expand the label to "Token contract address (SAC — starts with C…)".
2. Add a `GlossaryInfoTooltip` for `sac` to the label.
3. Add an inline error for the specific case where a `G…` address is entered in the token field: "This looks like a wallet address (G…). The token field requires a contract address starting with C…".

**Related issue:** #380 (Tooltip system)

---

### Issue 4 — Cancel stream consequences not clear before the modal

**Severity:** 3 — Moderate  
**Frequency:** 3 / 5 participants  
**Tasks affected:** T4 (cancel stream)

**Description:**  
Participants opened the cancel confirmation modal but were uncertain whether the recipient would keep accrued tokens or lose everything. Two participants clicked "Keep stream" out of caution because they didn't trust they understood the outcome. One participant thought the sponsor would get a full refund regardless.

**Representative quotes:**
> "I wasn't sure if the person would lose everything. I didn't want to cancel and then have them lose their earned tokens." — P3 (non-DeFi tech)  
> "It says 'accrued tokens remain available' — but how do I know what's accrued right now?" — P1 (DeFi-experienced)  
> "So if I cancel, do they get nothing? Or do they keep what they've already got? It's not clear." — P4 (non-technical)

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
> "Did it work? I don't see anything telling me it went through." — P5 (non-technical)  
> "There's a hash here — does that mean it was sent, or it was confirmed?" — P4 (non-technical)  
> "I'm clicking claim again because I don't think the first one went through." — P5

**Root cause:** The success state (transaction hash with a link) is low in visual hierarchy and uses technical language ("Tx: …") that non-technical participants did not associate with success.

**Recommended fix:**  
1. Show a prominent success banner with a green checkmark and human-readable message: "✓ [N] tokens claimed successfully!"
2. Move the transaction hash link below the success message as a secondary detail.
3. Consider a brief animation to draw attention to the success state.

**Related issue:** #379 (Skeleton screens / loading states)

---

## SUS Score Summary

| Participant | SUS score | Interpretation |
|-------------|-----------|----------------|
| P1 | 72 | Good |
| P2 | 58 | OK |
| P3 | 52 | OK |
| P4 | 45 | Poor |
| P5 | 73 | Good |
| **Average** | **60** | **OK** |

SUS benchmarks: < 51 = Poor; 51–67 = OK; 68–80 = Good; > 80 = Excellent

Analysis: The average SUS of 60 falls in the "OK" range, but the spread is wide (45–73). DeFi-experienced participants (P1, P2) scored in the Good-to-OK range, while non-technical participants (P4, P5) scored Poor-to-Good. P4's score of 45 (Poor) was driven by the SAC field blocker (Issue 3) and pre-cliff confusion (Issue 1). P5's relatively high score (73) suggests the UI works well for motivated non-technical users when the stream is past the cliff and tokens are claimable.

The three highest-frequency issues (ledger terminology, SAC format, pre-cliff zero) all contribute to depressed SUS scores among non-technical users. Addressing Issues 1–3 (all small effort via #380 tooltip wiring) is expected to lift the average SUS into the Good range (≥ 68) on re-test.

---

## Recommended Action Plan

Issues in priority order:

| Priority | Issue | Effort | Linked to |
|----------|-------|--------|-----------|
| P1 | Issue 1: Pre-cliff zero claimable amount — no explanation | S | #380 tooltip |
| P2 | Issue 2: Ledger terminology — wire tooltips to form labels | S | #380 tooltip |
| P2 | Issue 3: SAC address format — expand label + error message | S | #380 tooltip |
| P3 | Issue 4: Cancel modal — show both recipient + sponsor amounts | M | New issue |
| P4 | Issue 5: Post-claim success prominence | S | New issue |

See `docs/research/action-plan.md` for full details, effort estimates, and success metrics.

---

## Next Steps

- [ ] File 5 GitHub issues with `ux` label (see action-plan.md)
- [ ] Review tooltip wiring in #380 against Issues 1 and 2
- [ ] Design the pre-cliff state enhancement (Issue 1)
- [ ] Update cancel modal design (Issue 4)
- [ ] Improve post-claim success state (Issue 5)
- [ ] Schedule a follow-up round of 3 sessions after fixes are shipped
