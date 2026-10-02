# Top-5 Severity Ranking and Design Recommendations — Issue #818

**Issue:** [#818](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/818)
**Status:** Expert-review ranking only. Grounded in the repository's existing heuristic report and in the current code, both cited inline. It is **not** a participant-evidence ranking: no #818 session has been run, so no frequency count, quote, or observation supports it.
**Related:** [`issue-818-research-plan.md`](./issue-818-research-plan.md) §7 · [`issue-818-registers.md`](./issue-818-registers.md) · [`issue-818-affinity-template.md`](./issue-818-affinity-template.md)

## 1. How this ranking was produced, and what it is not

- **Evidence used:** `docs/research/heuristic-evaluation.md` (existing repository report, issue #377) and a read-only inspection of the current frontend. Every item below carries a `file:line` citation a maintainer can check.
- **Evidence not used for ranking:** frequencies, quotes, and SUS scores in [`findings-report.md`](./findings-report.md) and [`usability-study-1.md`](./usability-study-1.md). Those documents are prior contributor evidence; the repository holds no per-session notes, recording references, or consent records for them, so their numbers cannot be re-verified here and are not used to rank anything (see [`issue-818-traceability.md`](./issue-818-traceability.md) §3).
- **Severity scale:** the heuristic report's 0–4 scale. **Confidence:** `code` = directly verifiable in the current code; `report` = asserted by the heuristic report only.
- **Affected task** refers to the three #818 tasks in [`issue-818-research-plan.md`](./issue-818-research-plan.md) §3.
- A participant-evidence ranking of the top 5 cannot be claimed until §4's evidence gate is passed.

## 2. Ranking

| Rank | Issue | Severity | Affected task | Confidence | Primary citations |
|------|-------|----------|---------------|-----------|-------------------|
| 1 | Claim confirmation conflates "submitted" with "succeeded"; no pending state and no transaction link in the claim sheet | 3 — High | T1, T2 | code | [`ClaimBottomSheet.tsx:163-164`](../../frontend/src/components/ClaimBottomSheet.tsx), [`ClaimBottomSheet.tsx:396-403`](../../frontend/src/components/ClaimBottomSheet.tsx), [`ClaimBottomSheet.tsx:424-432`](../../frontend/src/components/ClaimBottomSheet.tsx), [`heuristic-evaluation.md:31`](./heuristic-evaluation.md) (H1-1) |
| 2 | Pre-cliff "nothing claimable" is explained in the claim sheet but not on the detail or list surfaces | 3 — High | T1 | code | [`ClaimBottomSheet.tsx:252-281`](../../frontend/src/components/ClaimBottomSheet.tsx), [`ViewPageClient.tsx:100-103`](../../frontend/src/app/view/%5Brecipient%5D/ViewPageClient.tsx), [`app/streams/page.tsx:292-299`](../../frontend/src/app/streams/page.tsx), [`heuristic-evaluation.md:111-113`](./heuristic-evaluation.md) (H6-3) |
| 3 | Create flow labels expose SAC, ledger, and raw ledger counts without inline explanation, and differ from the wizard's wording | 3 — High | T2 | code | [`StreamCreateForm.tsx:186-197`](../../frontend/src/components/StreamCreateForm.tsx), [`StreamCreateForm.tsx:220`](../../frontend/src/components/StreamCreateForm.tsx), [`StreamCreateForm.tsx:235`](../../frontend/src/components/StreamCreateForm.tsx), [`StepSelectToken.tsx:87`](../../frontend/src/wizard/StepSelectToken.tsx), [`glossary-tooltips.ts:26-43`](../../frontend/src/glossary-tooltips.ts) |
| 4 | Timeline meaning depends on a legend plus hover tooltips, and the chart is behind a per-card expand | 2 — Medium | T3 | code | [`SegmentedProgressBar.tsx:119-145`](../../frontend/src/components/SegmentedProgressBar.tsx), [`app/page.tsx:311-325`](../../frontend/src/app/page.tsx), [`VestingTimeline.tsx:219-229`](../../frontend/src/components/VestingTimeline.tsx), [`Tooltip.tsx:61-74`](../../frontend/src/Tooltip.tsx) |
| 5 | The token field returns one generic error for any invalid `C…` value, with no specific message for a pasted `G…` wallet address | 2 — Medium | T2 | report + code | [`StreamCreateForm.tsx:38-42`](../../frontend/src/components/StreamCreateForm.tsx), [`StreamCreateForm.tsx:187`](../../frontend/src/components/StreamCreateForm.tsx), [`findings-report.md:130-150`](./findings-report.md) §Issue 3 |

## 3. Items

### 1 — Claim confirmation conflates "submitted" with "succeeded"

Observation: the claim sheet zeroes the displayed amount and sets its `claimed` flag when the wallet promise is called, then renders "✓ Claim submitted!" as the success state; the CTA reads "Claimed! ✓". The sheet has no "pending confirmation" state, no ledger confirmation result, and no transaction or explorer link, while the create form does show a transaction link on success ([`StreamCreateForm.tsx:297-318`](../../frontend/src/components/StreamCreateForm.tsx)).

Impact: a user cannot tell whether tokens moved. This is the failure mode the prior report described as "no prominent confirmation" ([`findings-report.md:177-198`](./findings-report.md)); the current code shows the specific defect is now the missing confirmed/pending distinction, not the size of the banner.

Recommendation: split the state into `submitted → confirmed`; show the transaction hash as a "View transaction" link on confirmation; keep the amount visible until confirmation, and label the interim state "Waiting for confirmation". Reuse the explorer link pattern already used by the create form.

Verification hook: component test asserting that the sheet shows a pending state between submit and resolution, and an explorer link on success. Feed the wording into the copy review for #819 ([`copy-review-checklist.md`](./copy-review-checklist.md)).

### 2 — Pre-cliff explanation missing outside the claim sheet

Observation: the claim sheet already explains a locked state ("Tokens locked until cliff" plus a ledger countdown), and the claim button carries the same explanation as a disabled reason ([`ClaimButton.tsx:165-172`](../../frontend/src/components/ClaimButton.tsx)). The recipient detail view renders the claimable amount with the label "claimable" and no locked-state context, and the sponsor list prints "Cliff: 51,200,000"-style raw ledger numbers with no date or unit conversion.

Impact: the same stream reads as "claimable 0, cliff 518,400" on a list surface and as "locked" inside the sheet. Users who never open the sheet get no explanation, and the raw ledger count has no time anchor.

Recommendation: propagate the locked-state explanation to card and list rows (badge plus one line of context), and convert ledger values to an approximate date or duration using the existing ledger-to-human helper.

Verification hook: a UI test per surface asserting that a pre-cliff row states the locked state without opening a sheet.

### 3 — Create-flow labels differ from the wizard and skip existing glossary text

Observation: the standalone create form labels the token field "Token contract (SAC)" with placeholder "C…", labels rate "Rate (tokens per ledger)", and shows hints such as "≈ 518,400 ledgers" with no seconds-per-ledger conversion. The wizard's token step already explains SAC inline, and the glossary module already contains definitions for `ledger`, `rate`, and `sac`, but the standalone form wires none of them. Two entry points therefore teach the same concept differently.

Impact: terminology that #818's T2 asks participants to interpret is presented inconsistently across the two create paths.

Recommendation: make the two create paths share one label set; attach the existing glossary entries to the token, rate, cliff, and total labels; show a human-first duration ("≈ 30 days") with the ledger count as secondary.

Verification hook: a snapshot or DOM test asserting the same label and help text on both create paths, plus a glossary-entry existence check for each term.

### 4 — Timeline meaning depends on hover tooltips and an expand control

Observation: the segmented bar exposes its three regions through a legend whose extra detail lives in hover/tap tooltips, and the chart visualisation is rendered only for the card the user has expanded. A screen-reader summary exists for the bar, but sighted users get no persistent text for what each region means or when it applies.

Impact: #818's T3 measures exactly this. Nothing in the repository measures whether users can explain the timeline, so the risk is currently unquantified.

Recommendation: keep the legend, and add a persistent one-line caption (for example, "Nothing claimable until the cliff; the whole first chunk unlocks at once, then drips") with day-based estimates; keep the chart available without an expand where space allows.

Verification hook: an e2e assertion that the caption is present on the collapsed card; T3 pass rate in the study is the real measure.

### 5 — Generic token-address validation message

Observation: the token field has one error message for every value that fails the `C…` pattern, so a pasted `G…` wallet address produces "Must be a valid SAC contract address (C…, 56 chars)." rather than a message naming the actual mistake. The prior report recommended a specific message for this case.

Impact: recovery guidance without diagnosis; a known paste error is described in the wrong vocabulary.

Recommendation: branch on the `G…` case first and name the mismatch, then fall back to the generic message. Keep the wording in the same copy dictionary as the error layer.

Verification hook: unit test per branch, and confirmation in the copy review that the message names the field and the fix.

## 4. Evidence gate for a participant-evidence ranking

The table below is the only path to claiming a top-5 severity ranking from user sessions. Every row is `PENDING`; a row may only be filled from rows in [`issue-818-registers.md`](./issue-818-registers.md) §3 whose consent ID in §4 is complete.

| Rank | Issue | Frequency (distinct participants / completed) | Max severity (1–4) | Evidence IDs | Two coders agreed | Ranked |
|------|-------|--------------------------------------------|------------------|--------------|------------------|--------|
| 1 | PENDING | PENDING | PENDING | PENDING | PENDING | no |
| 2 | PENDING | PENDING | PENDING | PENDING | PENDING | no |
| 3 | PENDING | PENDING | PENDING | PENDING | PENDING | no |
| 4 | PENDING | PENDING | PENDING | PENDING | PENDING | no |
| 5 | PENDING | PENDING | PENDING | PENDING | PENDING | no |

Gate conditions, all required:

1. At least 5 of the 8 planned sessions completed with consent on record, including at least 2 per cohort.
2. Every observation behind a ranked row cites at least one evidence ID, and that evidence ID resolves to a recording or note in private storage.
3. Frequencies count distinct participants, not observations; severity is the highest severity observed for that theme.
4. Priority = frequency × max severity, ties broken by lower effort, computed by two coders and recorded in the promotion log of [`issue-818-affinity-template.md`](./issue-818-affinity-template.md) §5.
5. Each recommendation states the evidence IDs it rests on; a recommendation with no evidence ID is labelled a proposal, not a finding.

Until the gate is passed, this repository can claim only the expert ranking in §2. It cannot claim user-validated severity, frequency, quotes, or satisfaction scores for #818.

## 5. Prior findings that appear addressed in the current code

Recorded so that earlier work keeps its credit, and so nobody re-files them without checking:

| Prior claim | Where | Current code state |
|-------------|--------|--------------------|
| Cancel modal does not show what the recipient keeps | [`findings-report.md:154-173`](./findings-report.md) §Issue 4 | The modal shows recipient and sponsor amounts as separate rows and a pre-cliff warning: [`CancelConfirmModal.tsx:141-182`](../../frontend/src/components/CancelConfirmModal.tsx) |
| Pre-cliff zero has no explanation | [`findings-report.md:81-103`](./findings-report.md) §Issue 1 | Explained in the claim sheet with a countdown: [`ClaimBottomSheet.tsx:252-281`](../../frontend/src/components/ClaimBottomSheet.tsx); still open on the list and detail surfaces, see item 2 |

## 6. What this document does not establish

- No user-validated severity, frequency, quote, or satisfaction score exists for #818.
- No session has been recorded, and no recording reference exists in the repository.
- Nothing here verifies or refutes the numbers in [`findings-report.md`](./findings-report.md) or [`usability-study-1.md`](./usability-study-1.md); those remain as their authors wrote them.
- No design recommendation here is a substitute for the study's own recommendation round, which may reorder or drop these items.
