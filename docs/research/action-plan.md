# Usability Action Plan — Top 5 Issues

**Issue:** #388  
**Study:** Moderated remote usability testing — 5 participants  
**Status:** Ready for review  
**Owner:** UX Research

---

## Summary Table

| # | Issue | Severity | Priority | Effort | GitHub link |
|---|-------|----------|----------|--------|-------------|
| 1 | Pre-cliff claimable amount shows 0 with no explanation | 4 — Blocker | **P1** | S | #380 (tooltip wiring) |
| 2 | Ledger terminology causes widespread confusion | 3 — Moderate | **P2** | S | #380 (tooltip wiring) |
| 3 | SAC contract address format not obvious | 3 — Moderate | **P2** | S | #380 (tooltip wiring) |
| 4 | Cancel stream consequences not clear before the modal | 3 — Moderate | **P3** | M | New issue |
| 5 | No prominent confirmation after claiming tokens | 2 — Minor | **P4** | S | New issue |

**Effort scale:** S = < 1 day dev work | M = 1–3 days | L = 3+ days  
**Priority:** P1 = fix before next release | P2 = fix in next sprint | P3 = scheduled backlog | P4 = nice-to-have

---

## Issue 1 — Pre-cliff claimable amount shows 0 with no explanation

### Evidence

- **Frequency:** 3 of 5 participants  
- **Severity:** 4 — Blocker (one participant gave up on the task)  
- **Tasks affected:** T2 (find claimable amount), T3 (claim tokens)

**Quotes:**
> "It just says zero. Did the transaction fail when it was created?" — P4 (non-technical)  
> "Zero doesn't mean I can't claim yet — it means there's nothing to claim, right? But I thought I had tokens…" — P3 (non-DeFi tech)

### Root cause

The claimable amount is displayed as a bare number (`0`) without explaining that tokens are locked until the cliff. The `pre-cliff` badge conveys state but does not tell the user *what it means for them*. Non-technical users cannot infer that `pre-cliff → no claims yet`.

### Recommended fix

When `status === 'pre-cliff'` and `claimableAmount === 0`:

1. Replace the `0 tokens` display with: **"Locked until cliff"**
2. Show a secondary line: "You'll be able to claim after ledger [cliffLedger] (~[humanDate])."
3. Add a `GlossaryInfoTooltip` for `cliff` adjacent to the `pre-cliff` badge (from #380).
4. If the cliff is within the next 7 days, show a countdown: "Cliff in approximately N days."

**Implementation note:** The `GlossaryInfoTooltip` component from #380 can be dropped directly onto the badge label. The ledger-to-date estimate formula is already in `src/utils/datetime.ts`.

### Effort: S (< 1 day)

### Success metric

On re-test: Task 2 completion rate ≥ 4/5 with no participants expressing confusion about a `0` amount.

---

## Issue 2 — Ledger terminology causes widespread confusion

### Evidence

- **Frequency:** 4 of 5 participants  
- **Severity:** 3 — Moderate  
- **Tasks affected:** T1 (create stream)

**Quotes:**
> "What's a ledger? Is that like a page in a book?" — P5 (non-technical)  
> "I don't know what 17,280 means — I just typed 30 days and hoped for the best." — P4 (non-technical)

### Root cause

The form hints show `≈ 518,400 ledgers` as the primary value, with no tooltip or inline explanation of what a ledger is. The tooltip infrastructure was added in issue #380 but the form labels in `StreamCreateForm.tsx` have not yet been wired to `GlossaryInfoTooltip`.

### Recommended fix

In `StreamCreateForm.tsx`, for the cliff and total duration fields:

1. Add `<GlossaryInfoTooltip term="ledger" />` next to each field label.
2. Rewrite the hint text to be human-first: `"≈ 30 days (518,400 ledgers — 1 ledger ≈ 5 s)"` instead of only showing the ledger count.
3. Similarly add `<GlossaryInfoTooltip term="rate" />` to the rate field label.

**Code change:**

```tsx
// Before
<label htmlFor="cliffDays">Cliff duration (days)</label>

// After
<label htmlFor="cliffDays">
  Cliff duration (days)
  <GlossaryInfoTooltip term="cliff" />
</label>
```

### Effort: S (< 1 day — wiring only, component already implemented)

### Success metric

On re-test: 0 participants express confusion about "ledger" after hovering the info tooltip. Avg SEQ for T1 ≤ 3.

---

## Issue 3 — SAC contract address format is not obvious

### Evidence

- **Frequency:** 3 of 5 participants  
- **Severity:** 3 — Moderate  
- **Tasks affected:** T1 (create stream)

**Quotes:**
> "What's a SAC? I just have the token name — XLM." — P3 (non-DeFi tech)  
> "I see it starts with C… but why isn't it the same as the Stellar address that starts with G?" — P2 (DeFi-experienced, unfamiliar with SACs)

### Root cause

The field label "Token contract (SAC)" uses an unexpanded acronym. The placeholder `C…` is too brief to teach users the distinction between `G…` wallet addresses and `C…` contract addresses. No validation message distinguishes the two.

### Recommended fix

1. **Expand the label:** "Token contract address (SAC)"  
2. **Add a tooltip:** `<GlossaryInfoTooltip term="sac" />` on the label  
3. **Improve the placeholder:** `"C… (56-character contract address)"`  
4. **Add a specific validation error** for the case where a G-address is entered:
   ```
   "This is a wallet address (G…). The token field needs a contract address starting with C…"
   ```
5. **Validation change** in `StreamCreateForm.tsx`:
   ```ts
   if (values.token.startsWith('G')) {
     errors.token = 'Wallet address entered. Token contract addresses start with C…';
   }
   ```

### Effort: S (< 1 day)

### Success metric

On re-test: 0 participants paste a G-address into the token field. T1 completion rate ≥ 4/5.

---

## Issue 4 — Cancel stream consequences not clear before the modal

### Evidence

- **Frequency:** 3 of 5 participants  
- **Severity:** 3 — Moderate  
- **Tasks affected:** T4 (cancel stream)

**Quotes:**
> "I wasn't sure if the person would lose everything. I didn't want to cancel and then have them lose their earned tokens." — P3  
> "It says 'accrued tokens remain available' but how do I know what's accrued right now?" — P1 (DeFi-experienced)

### Root cause

The cancel confirmation modal (`CancelConfirmModal`) shows only the sponsor refund amount. It does not show the recipient's accrued amount, so users cannot verify that the recipient is protected. The summary section uses one line ("Sponsor refund: 1,000 XLM") when it needs two.

### Recommended fix

1. **Add a recipient row** to the modal summary:
   ```
   Recipient keeps:  [N] XLM   ← accrued tokens at current ledger
   Sponsor refund:   [N] XLM   ← remaining deposit
   ```
2. Make the two-row layout explicit with a divider.
3. Add a small explanatory note below the summary: "Tokens accrued before this ledger ([N]) remain claimable by the recipient."
4. Add `<GlossaryInfoTooltip term="catch_up_claim" />` next to "Recipient keeps".

**New GitHub issue:** `ux: cancel modal — show recipient accrued amount alongside sponsor refund`  
**Labels:** `ux`, `frontend`

### Effort: M (1–2 days — requires passing accrued amount to the modal)

### Success metric

On re-test: ≥ 4/5 participants correctly describe what happens to the recipient's tokens before clicking cancel.

---

## Issue 5 — No prominent confirmation after claiming tokens

### Evidence

- **Frequency:** 4 of 5 participants  
- **Severity:** 2 — Minor  
- **Tasks affected:** T3 (claim tokens)

**Quotes:**
> "Did it work? I don't see anything telling me it went through." — P5 (non-technical)  
> "There's a hash here — does that mean it was sent, or it was confirmed?" — P4

### Root cause

The success state after claiming shows a transaction hash with a Stellar Expert link. This is sufficient for developers but invisible to non-technical users who do not recognise a hex hash as a success indicator. The success banner competes with other UI elements and lacks a visual anchor (icon, colour, or animation).

### Recommended fix

1. **Add a success icon + headline:** `✓ Tokens claimed!` in large, prominent text with green colour.  
2. **Human-readable amount:** "You have claimed [N] [TOKEN] tokens."  
3. **Demote the transaction hash:** move it below the headline as a "View transaction" link (collapsed by default, expandable).  
4. **Brief animation:** a subtle fade-in or scale animation to draw the eye (already possible with `framer-motion` which is installed).

**New GitHub issue:** `ux: claim success state — more prominent confirmation with amount`  
**Labels:** `ux`, `frontend`

### Effort: S (< 1 day)

### Success metric

On re-test: 0 participants attempt to claim again after a successful transaction. ≥ 4/5 correctly identify that the claim succeeded.

---

## Implementation Timeline

| Sprint | Issues to fix |
|--------|--------------|
| Sprint 1 (next release) | Issue 1 (P1): pre-cliff zero explanation |
| Sprint 1 | Issue 2 (P2): ledger tooltip wiring |
| Sprint 1 | Issue 3 (P2): SAC address tooltip + validation |
| Sprint 2 | Issue 4 (P3): cancel modal — show recipient amount |
| Sprint 2 | Issue 5 (P4): post-claim success prominence |

**Re-test:** Schedule a 3-participant validation round after Sprint 1 ships to verify Issues 1–3 are resolved.

---

## GitHub Issues to Create

Copy these as issues with the `ux` label:

1. `ux: show human-readable pre-cliff message when claimable amount is 0` → P1
2. `ux: wire GlossaryInfoTooltip to cliff/total-duration/rate form labels` → links to #380
3. `ux: improve SAC address field — expand label, tooltip, G-address validation error` → links to #380
4. `ux: cancel modal — show recipient accrued amount alongside sponsor refund`
5. `ux: post-claim success state — add icon, amount, and demote tx hash`
