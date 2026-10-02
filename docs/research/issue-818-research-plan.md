# Research Plan — Issue #818 (Moderated User Research)

**Issue:** [#818 — Conduct user research sessions and document findings](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/818)
**Status:** Plan only. No #818 sessions have been run. No participants, recordings, consent records, or #818 observations exist yet.
**Owner:** UX Research (unassigned)
**Traceability:** [issue-818-traceability.md](./issue-818-traceability.md)

Existing repository material is reused by link rather than restated: the moderated-session format, screener questions, note capture, and consent policy already exist in [`usability-test-protocol.md`](./usability-test-protocol.md), [`participant-screener.md`](./participant-screener.md), and [`observation-notes-template.md`](./observation-notes-template.md). This plan changes only what #818 specifies: 4 technical + 4 non-technical participants, and exactly three tasks.

---

## 1. Questions

1. Can a recipient state how many tokens are claimable today, and where that number comes from?
2. Can a sponsor create a vesting stream for a new team member without documentation help?
3. Can a user explain what the timeline visualization shows?

## 2. Participants — 8 slots (4 technical, 4 non-technical)

Slots to be recruited and screened. A row is a recruitment slot, not a recruited person; identifiers are assigned in recruitment order and never carry a real name.

| Slot | Cohort | Screening profile | Screener signal |
|------|--------|--------------------|-----------------|
| P1 | Technical | Stellar/Soroban developer who has deployed a contract | Q2 = yes, Q3 = yes |
| P2 | Technical | Protocol contributor with vesting/token experience, not Stellar-specific | Q2 = yes, Q3 = no or heard-of |
| P3 | Technical | Full-stack developer who has never used Stellar | Q2 = no, Q1 = A |
| P4 | Technical | Technical contributor or ops engineer who has never held tokens | Q2 = no, Q1 = A or D |
| P5 | Non-technical | Community manager for a Stellar-adjacent project | Q1 = B/C, Q2 = no |
| P6 | Non-technical | Advisor or mentor on a grants/fellowship programme | Q1 = C, Q2 = no |
| P7 | Non-technical | Designer, writer, or ops contributor who receives tokens as compensation | Q1 = B, Q2 = no |
| P8 | Non-technical | Fellowship or grant recipient new to crypto | Q1 = C, Q2 = no |

Screener questions Q1–Q10 in [`participant-screener.md`](./participant-screener.md) are used unchanged. That document's slot table targets the 2/2/1 mix of #388; for #818 the table above replaces the slot allocation only. Disqualifiers, incentive language, and scheduling email remain as written there. The incentive (50 XLM testnet + release-notes acknowledgement) is carried over from [`usability-study-1.md`](./usability-study-1.md) and must be confirmed by a maintainer before recruitment starts.

## 3. Tasks (exactly three, wording from #818)

Each task is run in order, read verbatim, with no assistance unless the participant is stuck for more than 2 minutes. Any assistance is logged as an observation.

### T1 — "Find out how many tokens you can claim today."

- Setup: recipient view pre-loaded with a stream that has passed its cliff, plus one pre-cliff stream.
- Pass: participant states a numeric amount and identifies where it came from within 60 s.
- Time limit: 2 min. Observe: which surface is checked first, whether the pre-cliff stream is misread, whether "claimable" is understood.
- Probe: "Was it obvious where that number came from?" / "What would you expect to be different right now?"

### T2 — "Create a vesting stream for a new team member."

- Setup: sponsor wallet connected, testnet tokens available, recipient and token contract addresses supplied by the facilitator.
- Pass: stream created with the specified rate, cliff, and total duration, and visible in the sponsor's list with a pre-cliff status, within 5 min.
- Time limit: 5 min. Observe: use of help text and tooltips, which terms are re-read, validation errors triggered, whether the deposit total is checked before signing.
- Probe: "What did each field mean to you?" / "What would you want to confirm before signing?"

### T3 — "Explain what the timeline visualization means."

- Setup: recipient or stream card view with the timeline expanded.
- Pass: participant names all three regions (locked, cliff catch-up, drip) and states which one is claimable now, within 3 min.
- Time limit: 3 min. Observe: whether the legend is found unaided, whether hover-only information is discovered, whether ledgers are converted to days anywhere.
- Probe: "What do the three regions mean?" / "Where would you look to see why a region is empty?"

## 4. Methods

- Moderated, remote, 45 min per session: 5 min intro and consent, 30 min tasks, 10 min survey and debrief.
- Roles: 1 facilitator (active) and 1 note-taker (silent), per [`usability-test-protocol.md`](./usability-test-protocol.md).
- Think-aloud with a 1–2 min practice round; neutral prompts only.
- Screen and audio recording, started only after verbal consent is confirmed on the record.
- Post-session survey: Single Ease Question (1–7) per task, SUS (10 items), and the open questions in [`usability-test-protocol.md`](./usability-test-protocol.md) §12.
- Per-session notes captured with [`observation-notes-template.md`](./observation-notes-template.md) and stored as `docs/research/sessions/session-P[N]-YYYY-MM-DD.md`, redacted to pseudonymous IDs before being committed.

## 5. Consent and privacy

Full policy: [`usability-test-protocol.md`](./usability-test-protocol.md) §5. Non-negotiable rules for #818:

1. Written consent form sent at least 24 h before the session; verbal confirmation captured at session start before recording begins.
2. Recordings and raw transcripts stay in access-controlled private storage, deleted 90 days after the final session. They are never committed to GitHub, attached to issues or pull requests, or linked from a public document.
3. The repository holds only the register metadata in [`issue-818-registers.md`](./issue-818-registers.md): pseudonymous slot ID, evidence ID, task, and the private storage reference.
4. Quotes are anonymised to slot IDs. No names, emails, wallet addresses, or screen content containing them are published in the repository.
5. Participants are told they may withdraw at any time; on withdrawal the media is deleted and the session is excluded from analysis (procedure in [`issue-818-registers.md`](./issue-818-registers.md) §5).
6. Transcription or AI summarisation of recordings requires its own explicit consent line, separate from recording consent.

## 6. Environment and data capture

- Staging deployment of the build under test, plus a pre-funded testnet wallet per session and a clean browser profile.
- Note-taker records timestamp, task ID, action, verbatim quote, and severity (1 cosmetic, 2 minor, 3 moderate, 4 blocker) per the note template.
- Facilitator adds observations and any intervention immediately after each task.

## 7. Success criteria (set before data collection)

Per-task pass/fail, time on task, error count, and SEQ are recorded for every session. Study-level criteria:

| Criterion | Threshold | Consequence if missed |
|-----------|-----------|----------------------|
| Sessions completed with consent on record | ≥ 5 of 8, with at least 2 per cohort | Publish partial results labelled as partial; do not publish a top-5 ranking |
| T1 completion | ≥ 4 of 8 unaided | Escalate claim-amount discoverability to a finding if blocked in ≥ 2 sessions |
| T2 completion | ≥ 4 of 8 unaided | Escalate create-flow guidance if blocked in ≥ 2 sessions |
| T3 completion | ≥ 3 of 8 unaided | Escalate timeline comprehension if misread in ≥ 2 sessions |
| Cohort gap | Any task where the non-technical cohort trails the technical cohort by ≥ 2 participants | Report as a cohort gap even if absolute counts are small |
| Evidence completeness | Every reported observation has an evidence-register ID and a matching consent ID | Observation is excluded from synthesis |

## 8. Synthesis method

1. Transcribe and redact notes; assign an evidence ID to every observation in [`issue-818-registers.md`](./issue-818-registers.md).
2. Affinity mapping in Dovetail or Notion (as #818 specifies), using [`issue-818-affinity-template.md`](./issue-818-affinity-template.md). Only a redacted export or a link plus a written summary is committed.
3. Two coders independently name themes for the first four sessions, then reconcile and log disagreements in the template's promotion log.
4. Frequency = number of distinct participants. Severity = highest severity observed for that theme. Priority = frequency × max severity; ties broken by lower implementation effort.
5. A candidate theme is promoted to a finding only with at least two evidence IDs from different sessions. Everything else stays labelled a hypothesis.
6. Design recommendations cite the evidence IDs they rest on and are recorded in [`issue-818-severity-ranking.md`](./issue-818-severity-ranking.md) and the existing [`action-plan.md`](./action-plan.md) format.

## 9. Out of scope

Wallet installation, on-chain confirmation latency, back-end error handling, and any A/B or quantitative experiment. Accessibility conformance beyond what the three tasks surface is covered by [`../a11y-audit.md`](../a11y-audit.md).

## 10. Deliverables produced by this plan

| Deliverable | Where it lands | Depends on real sessions |
|-------------|----------------|-------------------------|
| Research plan | this document | no |
| Evidence and consent registers | [`issue-818-registers.md`](./issue-818-registers.md) | yes, to be filled |
| Affinity diagram | [`issue-818-affinity-template.md`](./issue-818-affinity-template.md) | yes, to be filled |
| Top-5 severity ranking and recommendations | [`issue-818-severity-ranking.md`](./issue-818-severity-ranking.md) | yes for a participant-evidence ranking |
