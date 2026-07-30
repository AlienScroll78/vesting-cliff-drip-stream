# Usability Study 1 — Vesting Cliff Drip Stream UI

**Date:** 2026-06-26  
**Status:** Planning  
**Owner:** UX Research

---

## Goals

1. Validate that sponsors can create a vesting stream without external help.
2. Validate that recipients understand the cliff mechanic and can claim tokens.
3. Identify the top friction points in the current UI.

---

## Participants

| # | Role | Recruit criteria |
|---|------|-----------------|
| 1 | Sponsor A | Has used a token-vesting tool before |
| 2 | Sponsor B | New to Stellar / crypto vesting |
| 3 | Recipient A | Experienced DeFi user |
| 4 | Recipient B | Non-technical contributor (e.g. designer, writer) |
| 5 | Developer | Familiar with Soroban; evaluating integration |

**Recruitment channel:** Project Discord, referrals from existing contributors.  
**Incentive:** 50 XLM testnet tokens + recognition in release notes.

---

## Session Format

- **Type:** Moderated, remote (video call + screen share)
- **Duration:** 45 minutes
- **Prototype:** Staging environment at `https://staging.example.com`
- **Facilitator:** 1 researcher; 1 silent note-taker
- **Recording:** Screen + audio, with explicit written consent before recording starts

### Consent procedure

1. Send consent form 24 h before the session.
2. Confirm verbal consent at session start before screen recording begins.
3. Store recordings in a private, access-controlled folder; delete after 90 days.

---

## Tasks

### Sponsor tasks

| ID | Task prompt | Success criterion |
|----|-------------|-------------------|
| S1 | "Connect your wallet and create a new vesting stream for recipient `GTEST…` — 10 XLM/ledger, 1-day cliff, 10-day total." | Stream appears in sponsor list with `pre-cliff` badge |
| S2 | "Cancel the stream you just created." | Confirmation modal shown; stream removed from list |
| S3 | "Explain what the progress bar segments mean." | Correctly identifies locked / cliff / drip regions |

### Recipient tasks

| ID | Task prompt | Success criterion |
|----|-------------|-------------------|
| R1 | "You have been told you have a vesting stream. Find out how many tokens you can claim right now." | Claimable amount visible within 60 s |
| R2 | "Claim your available tokens." | Claim bottom-sheet opened; transaction submitted |
| R3 | "You submitted a transaction. Where do you look to know if it succeeded?" | Locates transaction status drawer |

### Developer task

| ID | Task prompt | Success criterion |
|----|-------------|-------------------|
| D1 | "Using only the UI, find the contract address and the error code for 'nothing to claim'." | Finds both within 3 minutes |

---

## Metrics

| Metric | Method |
|--------|--------|
| Task completion rate | Pass / fail per task |
| Time on task | Stopwatch from prompt to completion |
| Error rate | Count of wrong paths per task |
| Subjective difficulty | Post-task Single Ease Question (1–7 scale) |
| Overall satisfaction | Post-session SUS (System Usability Scale, 10 items) |

---

## Discussion guide

### Intro (5 min)

- Welcome and introductions.
- Explain think-aloud protocol: "Please say what you are thinking as you go."
- Confirm recording consent.

### Tasks (30 min)

Run tasks in the order listed above for the participant's role. Do not prompt or assist unless the participant is completely stuck for > 2 min (note the intervention).

### Debrief (10 min)

1. What was the most confusing part?
2. Did the progress bar make sense? What did the colours mean to you?
3. Did you feel informed after submitting a transaction? Why / why not?
4. Is there anything you expected to find that was missing?

---

## Data capture

- Note-taker records: timestamp, task ID, observation, quote, severity (1 = cosmetic … 4 = blocker).
- Facilitator adds observations post-session.
- All notes consolidated in a shared spreadsheet within 24 h of the last session.

---

## Analysis plan

1. Affinity mapping of observations across participants.
2. Rank issues by frequency × severity.
3. File the top 5 issues as individual GitHub issues with `ux` label.
4. Write summary section below once sessions are complete.

---

## Results summary

> _To be completed after sessions._

| # | Issue | Severity | Frequency | Filed issue |
|---|-------|----------|-----------|-------------|
| 1 | — | — | — | — |
| 2 | — | — | — | — |
| 3 | — | — | — | — |
| 4 | — | — | — | — |
| 5 | — | — | — | — |

---

## Sessions log

| Date | Participant | Completed | Recording |
|------|------------|-----------|-----------|
| TBD  | Sponsor A  | ☐ | ☐ |
| TBD  | Sponsor B  | ☐ | ☐ |
| TBD  | Recipient A | ☐ | ☐ |
| TBD  | Recipient B | ☐ | ☐ |
| TBD  | Developer  | ☐ | ☐ |
