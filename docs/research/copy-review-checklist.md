# Copy Review Checklist — Empty States and Transaction Feedback

**Supports:** [#819 — Design empty states for all major UI views](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/819) (design requirement 3, "Copy reviewed by UX writer") and the copy items in [#818](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/818) findings.
**UX-writer approval:** **PENDING.** No reviewer record for this copy exists in the repository: `docs/` contains no "UX writer" or "copy review" sign-off, `git log --grep` finds no such commit, and `.github/CODEOWNERS` lists placeholder teams only (`@your-org/frontend-reviewers`, `@your-org/maintainers`). This checklist therefore does **not** satisfy #819's approval requirement; it is the form a reviewer would sign.
**Related:** [`issue-818-severity-ranking.md`](./issue-818-severity-ranking.md) items 1–3 · [`../glossary.md`](../glossary.md)

## 1. Reviewer sign-off

| Field | Value |
|-------|-------|
| UX writer | — |
| Date reviewed | — |
| Build / commit reviewed | — |
| Decision (approved / changes requested) | — |
| Open items | — |

## 2. Per-surface review

The empty-state components already exist in code; the point of this table is to review the words, not to redesign them. Issue #819 also specifies that new states be designed in Figma and implemented in Storybook, which this PR does not do.

| Surface | Current copy source | Checked by / date |
|---------|--------------------|--------------------|
| New user, no streams | [`EmptyStates.tsx:155-172`](../../frontend/src/components/EmptyStates.tsx) and [`EmptyStates.tsx:261-274`](../../frontend/src/components/EmptyStates.tsx) | — |
| Sponsor, no streams created | [`EmptyStates.tsx:261-274`](../../frontend/src/components/EmptyStates.tsx), [`EmptyStates.tsx:278-291`](../../frontend/src/components/EmptyStates.tsx) | — |
| No notifications | [`EmptyStates.tsx:176-195`](../../frontend/src/components/EmptyStates.tsx) (history variant); notification copy at [`app/notifications/page.tsx:14`](../../frontend/src/app/notifications/page.tsx) | — |
| No search results | [`EmptyStates.tsx:203-220`](../../frontend/src/components/EmptyStates.tsx) | — |
| No schedule for wallet | [`EmptyStates.tsx:228-257`](../../frontend/src/components/EmptyStates.tsx) | — |
| Claim submitted vs confirmed | [`ClaimBottomSheet.tsx:396-403`](../../frontend/src/components/ClaimBottomSheet.tsx) | — |
| Claim button states | [`ClaimButton.tsx:165-183`](../../frontend/src/components/ClaimButton.tsx) | — |
| Pre-cliff locked state | [`ClaimBottomSheet.tsx:252-281`](../../frontend/src/components/ClaimBottomSheet.tsx) | — |
| Create form labels and errors | [`StreamCreateForm.tsx:186-197`](../../frontend/src/components/StreamCreateForm.tsx), [`StreamCreateForm.tsx:38-67`](../../frontend/src/components/StreamCreateForm.tsx) | — |
| Contract error messages | [`errorMessages.ts`](../../frontend/src/errorMessages.ts) | — |

## 3. Per-string checklist

- [ ] Names the user's situation, not the system's state (for example "no streams yet", not "empty array").
- [ ] Says what happens next, and the CTA matches that next step in wording and case.
- [ ] No unexplained protocol jargon. Terms such as ledger, cliff, rate, SAC, and catch-up claim match [`../glossary.md`](../glossary.md) and the tooltips in [`glossary-tooltips.ts`](../../frontend/src/glossary-tooltips.ts).
- [ ] Time and amounts are human-first: days or dates first, ledger counts secondary, with the approximation rule stated once.
- [ ] Confirms the distinction that matters to the reader (submitted vs confirmed, locked vs zero, refunded vs kept).
- [ ] Sentence case, present tense, second person, no exclamation marks in error or warning copy.
- [ ] One idea per string; the subtext does not repeat the heading.
- [ ] No colour-only or emoji-only meaning; every emoji in copy has a text equivalent for screen readers.
- [ ] Reads correctly when truncated on a 360 px viewport, and when read by a screen reader in isolation.
- [ ] Singular/plural and number formatting follow one convention across surfaces.
- [ ] Terminology is consistent with the rest of the app: "claim" is used everywhere, never "withdraw".
- [ ] No copy implies a token amount that the interface cannot actually display or guarantee.

## 4. Known items for the reviewer

Facts found while auditing, for triage by the copy owner. Nothing here is changed in this PR.

1. Two exported components share the name `SponsorStreamListEmpty` with different headings, subtext, and CTAs ([`EmptyStates.tsx:155`](../../frontend/src/components/EmptyStates.tsx) and [`EmptyStates.tsx:278`](../../frontend/src/components/EmptyStates.tsx)). One of the two sponsor strings will be unreachable; the reviewer should choose which is canonical.
2. Two sponsor empty states exist with different headings ("Create your first stream" and "You haven't created any streams"), so #819's requested sponsor copy needs one canonical string.
3. The claim sheet's success string says "submitted" while the button says "claimed" ([`ClaimBottomSheet.tsx:402`](../../frontend/src/components/ClaimBottomSheet.tsx), [`ClaimBottomSheet.tsx:428-429`](../../frontend/src/components/ClaimBottomSheet.tsx)); the wording should match the confirmed state it actually represents.
4. #819's new-user copy specifies a "Share your address" action; no such CTA exists in the current empty states, so the copy cannot be reviewed against an implementation until #819 lands.
