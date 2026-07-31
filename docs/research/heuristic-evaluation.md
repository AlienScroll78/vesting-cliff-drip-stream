# Heuristic Evaluation — Vesting Cliff Drip Stream UI

**Date:** 2026-07-27  
**Status:** Complete  
**Method:** Nielsen's 10 Usability Heuristics  
**Evaluators:** UX Research Team (2 evaluators, independent review + reconciliation session)  
**Scope:** Web interface — sponsor stream-creation flow, recipient claim flow, stream-management dashboard

---

## Severity Rating Scale

| Rating | Label | Description |
|--------|-------|-------------|
| 0 | Cosmetic | Does not impact usability; fix if time allows |
| 1 | Minor | Slight friction; low-priority |
| 2 | Medium | Noticeable friction; causes errors or confusion; fix next sprint |
| 3 | High | Seriously impairs completion; fix within current milestone |
| 4 | Critical | Prevents task completion; fix immediately |

---

## Heuristic Findings

### H1 — Visibility of System Status

> The system should always keep users informed about what is going on through appropriate feedback within a reasonable time.

| ID | Issue | Severity | Screen / Flow |
|----|-------|----------|---------------|
| H1-1 | After submitting `create_vesting_stream`, the UI shows a generic "Transaction submitted" toast but does not surface the stream-creation confirmation (stream ID, cliff date) until the user manually refreshes the dashboard. The system status is invisible for up to 30 seconds while waiting for ledger confirmation. | **3 – High** | Sponsor → Create Stream |
| H1-2 | The progress bar on the stream card does not animate or update in real time; it only refreshes on page load. Users have no indication that time is passing or that the stream is active. | **2 – Medium** | Dashboard → Stream Card |
| H1-3 | There is no loading skeleton or spinner when the dashboard is fetching schedules from Horizon. The page appears blank for 1–3 seconds, which users interpret as an error. | **2 – Medium** | Dashboard (initial load) |
| H1-4 | Transaction failure (e.g. insufficient balance) produces a raw Soroban error code (`5`) rather than a human-readable status. | **3 – High** | All transaction flows |

**Recommendations:**  
- Poll the stream schedule after submission and replace the toast with an inline success state on the card (H1-1, H1-2).  
- Add a loading skeleton on the dashboard (H1-3).  
- Map contract error codes to plain-language messages (H1-4). ⚡ **Quick win (< 1 day):** Add an `errorCodeToMessage` lookup table in the error-handling utility.

---

### H2 — Match Between System and the Real World

> The system should speak the users' language, using words, phrases, and concepts familiar to the user, rather than system-oriented terms.

| ID | Issue | Severity | Screen / Flow |
|----|-------|----------|---------------|
| H2-1 | The label "rate_per_ledger" is exposed directly from the contract schema in the create-stream form. Most users (especially non-Stellar contributors) do not know what a "ledger" is. | **3 – High** | Sponsor → Create Stream |
| H2-2 | The term "cliff_duration" is shown as a numeric input labelled "Cliff Duration (ledgers)". A more accessible label would be "Lock period" with a human-readable hint (e.g. "~1 day at 5 s/ledger"). | **2 – Medium** | Sponsor → Create Stream |
| H2-3 | Error code `InvalidDuration` surfaces as "InvalidDuration" in the UI. It should read "The total period must be longer than the lock period." | **2 – Medium** | Sponsor → Create Stream |

**Recommendations:**  
- Replace technical field names with user-friendly labels; add explanatory hints below each field. ⚡ **Quick win:** Update form labels and add `aria-describedby` hint spans.  
- Maintain a central copy dictionary (`/src/i18n/errors.ts`) for all contract error translations.

---

### H3 — User Control and Freedom

> Users often choose system functions by mistake and need emergency exits.

| ID | Issue | Severity | Screen / Flow |
|----|-------|----------|---------------|
| H3-1 | There is no confirmation dialog before submitting `create_vesting_stream`. The full deposit is transferred immediately on submission; there is no "undo". A review step showing the deposit amount would prevent accidental large transfers. | **3 – High** | Sponsor → Create Stream |
| H3-2 | The cancel-stream action (`cancel_stream`) does not have a confirmation modal. Sponsors can accidentally cancel a live stream with a single click. | **4 – Critical** | Dashboard → Stream Card → Cancel |
| H3-3 | The "claim all" button on the recipient dashboard has no undo or confirmation. While claiming is not destructive, the lack of confirmation breaks the pattern set by other actions and surprises users. | **1 – Minor** | Recipient → Dashboard |

**Recommendations:**  
- Add a two-step confirmation (review + confirm) to both create and cancel flows (H3-1, H3-2). ⚡ **Quick win:** A simple "Are you sure?" modal for cancel (H3-2) can be shipped in < 1 day.

---

### H4 — Consistency and Standards

> Users should not have to wonder whether different words, situations, or actions mean the same thing.

| ID | Issue | Severity | Screen / Flow |
|----|-------|----------|---------------|
| H4-1 | "Claim" and "Withdraw" are used interchangeably across the UI, documentation, and error messages. Only `claim_vested` is the correct contract function name. | **2 – Medium** | All screens |
| H4-2 | The sponsor dashboard uses card-based layout; the recipient dashboard uses a table layout. There is no design rationale for this discrepancy and it creates cognitive overhead when switching roles. | **2 – Medium** | Sponsor & Recipient Dashboards |
| H4-3 | Primary action buttons use three different visual styles (filled blue, outlined blue, text blue) with no documented hierarchy. | **1 – Minor** | All screens |

**Recommendations:**  
- Standardise terminology: use "Claim" everywhere; remove "Withdraw". ⚡ **Quick win:** Global find-and-replace in copy strings.  
- Align dashboard layouts to a single card-based pattern.

---

### H5 — Error Prevention

> Even better than good error messages is a careful design which prevents a problem from occurring in the first place.

| ID | Issue | Severity | Screen / Flow |
|----|-------|----------|---------------|
| H5-1 | The rate input field accepts any number, including values that would produce `DepositOverflow`. The valid maximum (`i128::MAX / total_duration`) is not validated client-side, so users only learn of the error after signing and submitting the transaction. | **3 – High** | Sponsor → Create Stream |
| H5-2 | `cliff_duration` and `total_duration` inputs are independent fields with no cross-field validation. A user can enter a cliff longer than the total duration and the error only surfaces on submission. | **3 – High** | Sponsor → Create Stream |
| H5-3 | The recipient address input does not warn when `sponsor === recipient` before submission (`InvalidRecipient` error, code 10). | **2 – Medium** | Sponsor → Create Stream |

**Recommendations:**  
- Add real-time client-side validation for all boundary conditions (H5-1, H5-2, H5-3). ⚡ **Quick win:** Add a `cliff_duration < total_duration` validator on the `cliff_duration` blur event (H5-2, < 1 day).

---

### H6 — Recognition Rather Than Recall

> Minimize the user's memory load by making objects, actions, and options visible.

| ID | Issue | Severity | Screen / Flow |
|----|-------|----------|---------------|
| H6-1 | After a stream is created, there is no persistent record of the input parameters (rate, cliff, total) visible on the stream card. Users must re-derive this information from the contract or Horizon explorer. | **2 – Medium** | Dashboard → Stream Card |
| H6-2 | The create-stream form does not show a live deposit preview ("You will deposit X tokens") while the user types rate and total_duration. Users must mentally compute the deposit before signing. | **3 – High** | Sponsor → Create Stream |
| H6-3 | There is no tooltip explaining what each badge status (`Pre-Cliff`, `Active`, `Completed`) means inline; users must consult the documentation. | **1 – Minor** | Dashboard → Stream Card |

**Recommendations:**  
- Add a live deposit preview beneath the rate and total_duration fields (H6-2). ⚡ **Quick win:** A simple `rate × total_duration` computed field, < 1 day.  
- Surface key stream parameters on the expanded card view (H6-1).  
- Add tooltip definitions to status badges (H6-3).

---

### H7 — Flexibility and Efficiency of Use

> Accelerators — unseen by the novice user — may speed up the interaction for the expert user.

| ID | Issue | Severity | Screen / Flow |
|----|-------|----------|---------------|
| H7-1 | There is no keyboard shortcut or quick-action to claim all claimable streams in a single transaction. Power users managing many streams must click through each card individually. | **2 – Medium** | Recipient → Dashboard |
| H7-2 | Address fields do not support address-book lookup or recent addresses. Every form entry requires full manual address input. | **1 – Minor** | Sponsor → Create Stream |
| H7-3 | There is no bulk-create capability for sponsors who need to set up streams for multiple recipients simultaneously. | **2 – Medium** | Sponsor → Create Stream |

**Recommendations:**  
- Implement a "Claim all eligible" batch action for recipients (H7-1, Milestone 2).  
- Add a simple recent-addresses dropdown to the recipient field (H7-2, Milestone 3).

---

### H8 — Aesthetic and Minimalist Design

> Dialogues should not contain irrelevant or rarely-needed information.

| ID | Issue | Severity | Screen / Flow |
|----|-------|----------|---------------|
| H8-1 | The stream card exposes 11 data fields by default (including raw ledger numbers, version field, and last_claimed_ledger). Most users only care about 3–4 fields. | **2 – Medium** | Dashboard → Stream Card |
| H8-2 | The create-stream form shows the raw contract field `version` as a read-only input. This is an internal schema field and should be hidden from the UI entirely. | **1 – Minor** | Sponsor → Create Stream |
| H8-3 | Transaction history items show the full XDR envelope hash by default. This is noise for most users; it should be collapsed behind a "Details" expander. | **1 – Minor** | Transaction History |

**Recommendations:**  
- Redesign the stream card to surface claimable amount, cliff countdown, and stream status prominently; collapse raw ledger data behind a "Details" toggle. ⚡ **Quick win:** Hide the `version` field (H8-2, < 1 hour).

---

### H9 — Help Users Recognize, Diagnose, and Recover From Errors

> Error messages should be expressed in plain language, precisely indicate the problem, and constructively suggest a solution.

| ID | Issue | Severity | Screen / Flow |
|----|-------|----------|---------------|
| H9-1 | `DepositOverflow` (code 5) is shown verbatim. No explanation of what overflowed or how to fix it (lower the rate or reduce the duration). | **3 – High** | Sponsor → Create Stream |
| H9-2 | `CliffNotReached` (code 2) shows a raw error code rather than "Your cliff date is X. You can claim on [date]." | **3 – High** | Recipient → Claim |
| H9-3 | When a wallet connection fails, the error toast disappears after 3 seconds with no persistent state or retry affordance. | **2 – Medium** | Wallet Connection |
| H9-4 | `ScheduleAlreadyExists` (code 6) does not link to the existing stream or explain how to cancel it before creating a new one. | **2 – Medium** | Sponsor → Create Stream |

**Recommendations:**  
- Implement a complete error-code dictionary mapping all 10 VestingError variants to user-facing messages with recovery guidance (H9-1 through H9-4). ⚡ **Quick win:** Write the dictionary and wire it into the toast system (< 1 day).  
- For `CliffNotReached`, display the human-readable cliff date derived from `cliff_ledger` and the average ledger close time (H9-2).

---

### H10 — Help and Documentation

> Even though it is better if the system can be used without documentation, it may be necessary to provide help.

| ID | Issue | Severity | Screen / Flow |
|----|-------|----------|---------------|
| H10-1 | There is no contextual help (tooltips, inline explanations) on the create-stream form. New users unfamiliar with Soroban or vesting mechanics have no guidance without leaving the app. | **3 – High** | Sponsor → Create Stream |
| H10-2 | The FAQ link in the README does not surface from within the web UI. Users must find it externally. | **1 – Minor** | All screens |
| H10-3 | There is no onboarding tour or first-time user experience. Users who open the app for the first time with no prior context have no guided path. | **3 – High** | First Visit / Onboarding |

**Recommendations:**  
- Add an onboarding tour for first-time visitors (H10-3, Milestone 1 — see Issue #372).  
- Add contextual `?` tooltips to all technical fields on the create-stream form (H10-1). ⚡ **Quick win:** Add a single tooltip to the rate field explaining "tokens released per ledger (~5 s each)".  
- Surface the FAQ link in the app footer and the help menu (H10-2).

---

## Consolidated Issue Backlog

All 30 findings from the heuristic evaluation are prioritised below.

### Critical (severity 4)

| ID | Issue | Heuristic | Effort |
|----|-------|-----------|--------|
| H3-2 | No confirmation modal before cancel-stream | H3 | Small |

### High (severity 3)

| ID | Issue | Heuristic | Effort |
|----|-------|-----------|--------|
| H1-1 | No post-transaction stream confirmation on dashboard | H1 | Medium |
| H1-4 | Raw error codes in transaction failure messages | H1 | Small ⚡ |
| H2-1 | "rate_per_ledger" label exposed to non-technical users | H2 | Small ⚡ |
| H3-1 | No review step before creating stream / transferring deposit | H3 | Medium |
| H5-1 | No client-side overflow validation on rate input | H5 | Medium |
| H5-2 | No cross-field validation (cliff < total) | H5 | Small ⚡ |
| H6-2 | No live deposit preview while filling form | H6 | Small ⚡ |
| H9-1 | DepositOverflow shown verbatim, no recovery guidance | H9 | Small ⚡ |
| H9-2 | CliffNotReached not translated to human-readable cliff date | H9 | Small ⚡ |
| H10-1 | No contextual help on create-stream form | H10 | Medium |
| H10-3 | No onboarding tour for first-time users | H10 | Large |

### Medium (severity 2)

| ID | Issue | Heuristic | Effort |
|----|-------|-----------|--------|
| H1-2 | Progress bar does not update in real time | H1 | Medium |
| H1-3 | Blank dashboard on load (no skeleton) | H1 | Small ⚡ |
| H2-2 | "cliff_duration" label not user-friendly | H2 | Small ⚡ |
| H2-3 | "InvalidDuration" error not translated | H2 | Small ⚡ |
| H4-1 | "Claim" / "Withdraw" terminology inconsistency | H4 | Small ⚡ |
| H4-2 | Inconsistent dashboard layouts (cards vs table) | H4 | Medium |
| H5-3 | No warning when sponsor === recipient | H5 | Small ⚡ |
| H6-1 | Stream parameters not persisted on card | H6 | Medium |
| H7-1 | No "Claim all" bulk action | H7 | Medium |
| H7-3 | No bulk stream-creation capability | H7 | Large |
| H8-1 | Stream card exposes too many raw fields | H8 | Medium |
| H9-3 | Wallet error toast disappears with no retry affordance | H9 | Small |
| H9-4 | ScheduleAlreadyExists doesn't link to existing stream | H9 | Small |

### Low / Cosmetic (severity 0–1)

| ID | Issue | Heuristic | Effort |
|----|-------|-----------|--------|
| H3-3 | Claim button has no confirmation | H3 | Small |
| H4-3 | Inconsistent button visual styles | H4 | Small |
| H6-3 | Status badge tooltips missing | H6 | Small ⚡ |
| H7-2 | No address-book / recent addresses | H7 | Medium |
| H8-2 | `version` field exposed on create form | H8 | Trivial ⚡ |
| H8-3 | Full XDR hash shown in transaction history | H8 | Small |
| H10-2 | FAQ not linked from within the app | H10 | Trivial ⚡ |

---

## Quick Wins (< 1 Day Each)

The following items are labelled ⚡ in the backlog above and can be shipped in under one day each:

1. **H1-4 / H9-1 / H9-2 / H2-3** — Error-code dictionary: map all 10 `VestingError` variants to plain-language messages in `/src/i18n/errors.ts`.
2. **H2-1 / H2-2** — Replace technical form labels with user-friendly text; add `aria-describedby` hints.
3. **H3-2** — Add a confirmation modal for `cancel_stream`.
4. **H4-1** — Global find-and-replace: standardise on "Claim" everywhere.
5. **H5-2** — Add `cliff_duration < total_duration` blur-event validator.
6. **H5-3** — Warn when sponsor address equals recipient address.
7. **H6-2** — Live deposit preview: `rate × total_duration` computed field below the form.
8. **H8-2 / H10-2** — Hide `version` field; add FAQ link to footer.
9. **H1-3** — Loading skeleton for dashboard fetch.
10. **H6-3** — Inline tooltip definitions for `Pre-Cliff`, `Active`, `Completed` badges.

---

## Prioritised Roadmap

### Milestone 1 — Foundation (Sprint 1)

Focus: critical blockers and highest-severity friction points.

| Priority | Item | Issues |
|----------|------|--------|
| P0 | Confirmation modal for cancel-stream (H3-2) | #372 (onboarding) |
| P0 | Error-code dictionary (H1-4, H9-1, H9-2) | closes #377 |
| P1 | Onboarding tour for first-time users (H10-3) | closes #372 |
| P1 | Live deposit preview and cliff/total cross-validation (H5-2, H6-2) | — |
| P1 | User-friendly form labels (H2-1, H2-2) | — |

**Deliverables:** Confirmed cancel flow, full error translation layer, onboarding tour v1.

### Milestone 2 — Information Hierarchy (Sprint 2)

Focus: stream card redesign and dashboard improvements.

| Priority | Item | Issues |
|----------|------|--------|
| P1 | Stream card redesign — claimable amount prominent, status badge, progress bar (H8-1, H6-1) | closes #371 |
| P1 | Post-transaction stream confirmation on dashboard (H1-1) | — |
| P2 | Loading skeleton and real-time progress bar (H1-2, H1-3) | — |
| P2 | "Claim all" batch action (H7-1) | — |
| P2 | Align sponsor/recipient dashboard layouts (H4-2) | — |

**Deliverables:** Redesigned stream card, improved data visibility, batch claim.

### Milestone 3 — Polish and Power-User Features (Sprint 3)

Focus: efficiency, accessibility, and advanced features.

| Priority | Item | Issues |
|----------|------|--------|
| P2 | Recent-addresses dropdown (H7-2) | — |
| P2 | Wallet connection retry affordance (H9-3) | — |
| P2 | Collapse raw ledger data behind Details toggle (H8-1, H8-3) | — |
| P3 | Bulk stream-creation UI (H7-3) | — |
| P3 | Standardise button hierarchy (H4-3) | — |
| P3 | Remaining cosmetic issues (H3-3, H6-3, H8-2, H10-2) | — |

**Deliverables:** Polished experience with no cosmetic debt; power-user efficiency features.

---

## Recommendations Summary

1. **Immediate** — Ship the 10 quick-win items (all < 1 day each). They collectively resolve 12 issues across 9 heuristics.
2. **Milestone 1** — Prioritise the onboarding tour (Issue #372) and cancel-stream confirmation modal (H3-2, critical severity). These have the highest user-impact-to-effort ratio.
3. **Milestone 2** — Invest in the stream card redesign (Issue #371) to surface the three most important data points: claimable amount, cliff countdown, and stream status.
4. **Milestone 3** — Address power-user efficiency (bulk actions, address book) and close remaining cosmetic issues.

A second heuristic evaluation pass is recommended after Milestone 2 ships to measure resolution of the severity-3+ findings.

---

## References

- [Nielsen, J. (1994). Heuristic Evaluation. In Nielsen, J., and Mack, R.L. (Eds.), *Usability Inspection Methods*. John Wiley & Sons.](https://www.nngroup.com/articles/how-to-conduct-a-heuristic-evaluation/)
- [Existing usability study](./usability-study-1.md)
- [Stream status badges](../stream-status-badges.md)
- [Error handling reference](../error-handling.md)
- [Mobile claim bottom sheet](../mobile-claim-bottom-sheet.md)
- [Walkthrough guide](../walkthrough-guide.md)
