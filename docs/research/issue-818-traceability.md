# Issue #818 Traceability — What Exists, What Is Claimed, What Is Missing

**Issue:** [#818 — Conduct user research sessions and document findings](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/818)
**Branch:** `feat/818-research-plan`
**Purpose:** let a maintainer audit, line by line, which #818 deliverables exist in this repository, which depend on real sessions and recordings, and which cannot be completed in a pull request at all.

## 1. Evidence classes used throughout

| Class | Meaning |
|-------|---------|
| **R** | A document already in this repository |
| **C** | Current code, verifiable with a `file:line` citation |
| **S** | Session evidence: a real participant, a consented recording, a note or survey export in private storage. **Count in this repository: 0.** |

## 2. #818 deliverables versus repository state

| #818 deliverable | State | Repository evidence | Still required |
|------------------|-------|---------------------|-----------------|
| Research plan document | Provided | [`issue-818-research-plan.md`](./issue-818-research-plan.md) (new), reusing [`usability-test-protocol.md`](./usability-test-protocol.md) and [`participant-screener.md`](./participant-screener.md) | Maintainer confirmation of incentive and staging environment before recruiting |
| Session recordings with participant consent | **Not possible in this PR** | [`issue-818-registers.md`](./issue-818-registers.md) is an empty register with placeholders only | 5–8 consented sessions; media stays in access-controlled private storage, never in GitHub |
| Affinity diagram of findings | Template only | [`issue-818-affinity-template.md`](./issue-818-affinity-template.md) (new): hypotheses, empty observation table, promotion log | Observations from the sessions, then promotion of hypotheses to findings with evidence IDs |
| Top-5 usability issues ranked by severity | Expert ranking only | [`issue-818-severity-ranking.md`](./issue-818-severity-ranking.md) §2, grounded in [`heuristic-evaluation.md`](./heuristic-evaluation.md) and current code | A participant-evidence ranking once the gate in §4 of that file is passed |
| Design recommendations tied to findings | Partially | Recommendations in [`issue-818-severity-ranking.md`](./issue-818-severity-ranking.md) §3 are tied to heuristic and code evidence, not to session findings; prior recommendations in [`action-plan.md`](./action-plan.md) | Recommendations tied to #818 evidence IDs after the study |
| 4 technical + 4 non-technical participants (plan) | Specified | [`issue-818-research-plan.md`](./issue-818-research-plan.md) §2 | Recruitment and screening of 8 slots |
| Exactly three tasks (plan) | Specified | [`issue-818-research-plan.md`](./issue-818-research-plan.md) §3, wording quoted from #818 | Nothing further; execution needs sessions |
| Methods: think-aloud, screen recording, post-session survey | Specified | [`issue-818-research-plan.md`](./issue-818-research-plan.md) §4, aligned with [`usability-test-protocol.md`](./usability-test-protocol.md) | Execution |
| Synthesis in Dovetail or Notion | Specified | [`issue-818-research-plan.md`](./issue-818-research-plan.md) §8 | Access to the tool and a redacted export |

## 3. Prior research artifacts in this repository, and what can be verified from here

`docs/research/` already contained eight documents before this change, from issues #388 (protocol, screener, note template, action plan), #377 (heuristic evaluation) and #604 (findings report). They are preserved exactly as their authors wrote them; nothing was rewritten or removed.

What the repository contains today:

- `usability-study-1.md` states five sessions on 2026-07-14 to 2026-07-18 with completion marks and recording ticks (lines 141–149), and a results table with severities, frequencies, and a mean SUS of 60 (lines 124–135).
- `findings-report.md` states per-participant results, SUS scores, frequencies such as "4 / 5 participants", and verbatim quotes (lines 28–58, 62–72, 202–217).
- `usability-study-1.md` (line 44) and `usability-test-protocol.md` (lines 84–90) state the recording policy: a private access-controlled folder, deleted 90 days after the final session, with written consent 24 h in advance and verbal confirmation before recording starts.

What is **not** in the repository, and therefore cannot be audited from it:

- No per-session notes. The note template instructs the author to create `session-P[N]-[YYYY-MM-DD].md` files (`observation-notes-template.md` line 3); `docs/research/` contains no such file.
- No recording reference of any kind: no file, filename, hash, or link, for any session, in any document.
- No consent record: no consent form, consent ID, or consent register.
- No synthesis export from Dovetail or Notion.

This is a statement about repository contents, not about whether those sessions took place. The claims stay in their documents as written; what is missing is the evidence a maintainer would need to re-verify them. For that reason none of those numbers is used as #818 evidence, and #818's own findings must not inherit them. Two of that report's recommendations do appear implemented in the current code, which is consistent with it having been acted on: the cancel modal now shows recipient and sponsor amounts separately (`frontend/src/components/CancelConfirmModal.tsx:141-182`) and the claim sheet explains the pre-cliff locked state with a countdown (`frontend/src/components/ClaimBottomSheet.tsx:252-281`). Those two rows are recorded in [`issue-818-severity-ranking.md`](./issue-818-severity-ranking.md) §5.

## 4. Acceptance items that cannot be completed in this repository or pull request

1. Recruiting and moderating 5–8 real sessions.
2. Producing session recordings, and any consent record for them.
3. Reporting frequencies, quotes, completion rates, SEQ, or SUS for #818.
4. Building an affinity diagram of real observations, and promoting any hypothesis to a finding.
5. Claiming a user-validated top-5 severity ranking and design recommendations tied to session findings.
6. Provisioning or exporting from Dovetail or Notion.
7. UX-writer approval of copy for #819. The checklist in [`copy-review-checklist.md`](./copy-review-checklist.md) is unsigned and marks approval as pending; no reviewer record exists in the repository.
8. Anything in #819 that is design or frontend work: Figma designs, Storybook visibility, illustrations. Out of scope for this PR.
9. Verifying the #388 and #604 claims above, which needs the original contributor's private research storage, not repository access.

## 5. Evidence required before #818 can truthfully close

1. Consent register with 8 slots, at least 5 rows complete, including the verbal-confirmation timestamps (`issue-818-registers.md` §4).
2. Evidence register with one row per observation, each resolving to a recording or note in access-controlled private storage, with a deletion date inside the 90-day window (§3).
3. Per-session notes committed as redacted `docs/research/sessions/session-P[N]-YYYY-MM-DD.md` files.
4. Completed affinity diagram with hypotheses separated from findings, and a promotion log naming the two coders.
5. Top-5 ranking recomputed from those sessions using the gate in `issue-818-severity-ranking.md` §4, each row citing evidence IDs.
6. A maintainer statement of where the private research storage lives and who can grant access, so the next contributor can audit without guessing.

## 6. Files added by this change

| File | Purpose |
|------|---------|
| [`issue-818-research-plan.md`](./issue-818-research-plan.md) | The study plan #818 asks for |
| [`issue-818-registers.md`](./issue-818-registers.md) | Evidence, recording, and consent registers, with placeholders and storage rules |
| [`issue-818-affinity-template.md`](./issue-818-affinity-template.md) | Affinity diagram template; candidate themes labelled as hypotheses |
| [`issue-818-severity-ranking.md`](./issue-818-severity-ranking.md) | Expert-review top 5 with citations, design recommendations, and the session evidence gate |
| [`copy-review-checklist.md`](./copy-review-checklist.md) | Copy review checklist supporting #819, approval pending |
| `issue-818-traceability.md` | This audit map |

No existing document was modified, and no frontend, Terraform, workflow, or infrastructure file was touched.
