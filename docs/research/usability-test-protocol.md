# Usability Test Protocol — Vesting Cliff Drip Stream

**Version:** 1.0  
**Issue:** #388  
**Status:** Ready for use  
**Owner:** UX Research  
**Last updated:** 2026-07-28

---

## 1. Overview

### Purpose

This protocol guides moderated usability testing sessions for the Vesting Cliff Drip Stream UI. It ensures consistent, comparable data across all 5 participant sessions.

### Research questions

1. Can a sponsor create a vesting stream end-to-end without external documentation?
2. Do recipients understand the cliff mechanic and know when they can claim?
3. Which terminology (cliff, ledger, rate, SAC) causes the most confusion?
4. Does the cancel flow communicate consequences (refund vs. partial release) clearly?
5. What is the overall perceived usability score (SUS)?

### Scope

- **In scope:** Stream creation, claimable amount discovery, token claiming, stream cancellation
- **Out of scope:** Wallet installation, on-chain transaction confirmation times, back-end errors

---

## 2. Participant Criteria

5 participants across 3 groups:

| ID | Group | Profile |
|----|-------|---------|
| P1 | DeFi-experienced | Has used a token-vesting or streaming protocol (e.g. Sablier, Drips, Superfluid) |
| P2 | DeFi-experienced | Familiar with Stellar or Soroban; may be a developer or power user |
| P3 | Non-DeFi tech | Uses software tools daily; comfortable with web apps; no DeFi experience |
| P4 | Non-DeFi tech | Similar to P3; ideally from a non-engineering role (designer, writer, ops) |
| P5 | Non-technical | Minimal technical background; represents a new contributor receiving tokens |

**Recruitment channel:** Project Discord, contributor referrals  
**Incentive:** 50 XLM testnet tokens + acknowledgement in release notes  
**Target geography:** Any; session conducted in English

---

## 3. Session Format

| Attribute | Detail |
|-----------|--------|
| Type | Moderated, remote (video call + screen share) |
| Duration | 45 minutes |
| Prototype | Staging environment — `https://staging.example.com` |
| Facilitator | 1 researcher (active) |
| Observer | 1 note-taker (silent, camera off) |
| Recording | Screen + audio (explicit written consent required before start) |

---

## 4. Equipment Setup Checklist

**Facilitator (before each session):**

- [ ] Staging environment is deployed and functional
- [ ] Test wallet pre-funded with testnet XLM
- [ ] Freighter extension installed in a clean browser profile
- [ ] Screen-recording software ready (OBS, Loom, or Zoom cloud)
- [ ] Note-taking spreadsheet open
- [ ] Timer ready (stopwatch or phone)
- [ ] Consent form sent 24 h before session

**Participant (sent in pre-session email):**

- [ ] Install Freighter browser extension: https://www.freighter.app
- [ ] Use Chrome or Firefox (not mobile) for the session
- [ ] Join via the video call link 5 minutes early
- [ ] Have a stable internet connection

---

## 5. Consent and Recording Policy

1. Send the consent form at least **24 hours** before the session.
2. Confirm verbal consent at session start **before** screen recording begins.
3. Store recordings in a private, access-controlled folder (Google Drive restricted to research team).
4. Delete all recordings **90 days** after the final session.
5. Anonymise quotes in any public-facing reports (use participant ID, not name).

---

## 6. Facilitator Introduction Script

Read aloud at the start of every session:

> "Hi [name], thanks for joining. My name is [facilitator], and I'm on the UX research team.
>
> Today we're testing the Vesting Cliff Drip Stream application — a tool that sponsors use to set up token streams for contributors, and recipients use to claim their tokens.
>
> **Important:** we're testing the application, not you. There are no right or wrong answers. If something is confusing, that's feedback for us to fix, not a reflection on you.
>
> I'll ask you to think aloud as you go — meaning, please say out loud what you're thinking, what you're looking for, and what you expect to happen. This helps us understand your mental model.
>
> I won't be able to answer questions about the interface during the tasks, but I may ask you to clarify something you said. After all tasks are done, we'll have time for open questions.
>
> Do you have any questions before we start? Great. I'm going to start the recording now — you previously consented to this, but please say 'yes, I consent' for the record."

---

## 7. Think-Aloud Instructions

After the introduction, give the participant this brief practice:

> "Before we go to the app, let's practise thinking aloud. Please open a new browser tab and tell me what you're looking at and what you're thinking."

Allow 1–2 minutes. If they go quiet during tasks, use neutral prompts:
- "What are you thinking right now?"
- "What do you expect to happen?"
- "What would you do next?"

Do **not** say "you're doing great" or give any indication of success/failure.

---

## 8. Tasks

Run in this order. Read each prompt aloud. **Do not assist** unless the participant is completely stuck for > 2 minutes (note any intervention as an observation).

### Task 1 — Create a stream

**Prompt:**
> "You are a project sponsor. You want to set up a vesting stream for a contributor. Their address is:
> `GTEST1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF12345`
>
> Use token contract: `CTEST1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF12345`
>
> Set a rate of 10 tokens per ledger, a 1-day cliff, and a 10-day total duration.
>
> Please go ahead."

**Success criterion:** Stream appears in sponsor list with `pre-cliff` status badge  
**Time limit:** 5 minutes  
**Observe:** Does the participant understand "rate", "ledger", "cliff"? Do they look for help text?

**Probing questions (ask only if task completes or times out):**
- "What did the term 'cliff' mean to you before you started?"
- "What did 'rate per ledger' mean?"
- "Was the deposit amount what you expected?"

---

### Task 2 — Find claimable amount

**Prompt:**
> "You are now a recipient with an active stream. Please find out how many tokens you can claim right now."

*(Facilitator: pre-load the recipient's view on staging with a stream that has passed its cliff.)*

**Success criterion:** Participant locates the claimable amount (numeric value) within 60 seconds  
**Time limit:** 2 minutes  
**Observe:** Do they find it immediately, or do they look in multiple places?

**Probing questions:**
- "Was it obvious where to find that number?"
- "Did you expect to see a different number? Why?"

---

### Task 3 — Claim tokens

**Prompt:**
> "Please claim your available tokens."

**Success criterion:** Claim bottom-sheet opens and participant submits the transaction  
**Time limit:** 3 minutes  
**Observe:** Is the claim flow clear? Do they understand what happens after submitting?

**Probing questions:**
- "How would you know if the transaction succeeded?"
- "Where would you look to verify the claim went through?"

---

### Task 4 — Understand cancel behaviour

**Prompt:**
> "As a sponsor, you want to cancel a stream you created. Please find where to do that and tell me what you think will happen to the tokens."

**Success criterion:** Participant finds the cancel option and correctly describes the refund/partial-release behaviour  
**Time limit:** 3 minutes  
**Observe:** Does the participant read the modal carefully? Are the consequences (refund vs. partial release) understood?

**Probing questions:**
- "Before you clicked cancel, did you know what would happen to the tokens?"
- "Was the outcome what you expected?"
- "What would make the consequences clearer?"

---

## 9. Metrics

| Metric | Measurement method |
|--------|-------------------|
| Task completion rate | Pass / Fail per task (binary) |
| Time on task | Stopwatch — start at end of prompt, stop at success criterion |
| Error rate | Count of wrong paths (navigating to wrong page, entering invalid data) |
| Post-task difficulty | Single Ease Question (SEQ): "Overall, how would you rate the difficulty of this task?" (1 = very easy … 7 = very difficult) |
| Overall satisfaction | System Usability Scale (SUS) administered after all tasks |

---

## 10. Post-Task SEQ

After each task, ask:

> "On a scale of 1 to 7, where 1 is 'very easy' and 7 is 'very difficult', how would you rate the difficulty of that task?"

Record the number in the observation notes.

---

## 11. Post-Session SUS Questionnaire

Administer after all tasks. Read each statement aloud (or share screen with the form).  
Scale: 1 = Strongly disagree … 5 = Strongly agree.

1. I think that I would like to use this system frequently.
2. I found the system unnecessarily complex.
3. I thought the system was easy to use.
4. I think that I would need the support of a technical person to be able to use this system.
5. I found the various functions in this system were well integrated.
6. I thought there was too much inconsistency in this system.
7. I would imagine that most people would learn to use this system very quickly.
8. I found the system very cumbersome to use.
9. I felt very confident using the system.
10. I needed to learn a lot of things before I could get going with this system.

**Scoring:** Multiply the sum of odd-item scores (subtract 1) and even-item scores (5 minus score) by 2.5 to get a score out of 100.

---

## 12. Debrief Questions

After the SUS, have a 10-minute open conversation:

1. "What was the most confusing part of the experience overall?"
2. "Did the progress bar / timeline make sense to you? What did the different sections represent?"
3. "After you submitted a transaction, did you feel confident it had succeeded? Why or why not?"
4. "Is there anything you expected to find that was missing?"
5. "If you could change one thing about the application, what would it be?"

---

## 13. Data Capture

- Note-taker records: **timestamp | task ID | action observed | verbatim quote | severity (1–4)**
- Severity scale:
  - **1 — Cosmetic:** Minor visual issue; participant notices but continues
  - **2 — Minor:** Slight confusion or delay; task still completed
  - **3 — Moderate:** Significant confusion; participant needed extra time or made errors
  - **4 — Blocker:** Participant could not complete the task without assistance
- All session notes consolidated into the shared spreadsheet within **24 hours** of the last session
- Use `docs/research/observation-notes-template.md` for per-session capture

---

## 14. Analysis Plan

1. Calculate task completion rates and average SEQ scores per task.
2. Calculate SUS score per participant; average across all 5.
3. Run affinity mapping: group observations by theme.
4. Rank issues by **frequency × severity**.
5. Document top 5 issues in `docs/research/findings-report-template.md`.
6. File each top-5 issue as a GitHub issue with the `ux` label.
7. Produce `docs/research/action-plan.md` with recommended fixes.

---

## 15. Session Schedule Template

| Session | Date/time | Participant ID | Group | Facilitator | Completed | Recording |
|---------|-----------|---------------|-------|-------------|-----------|-----------|
| 1 | TBD | P1 | DeFi-experienced | TBD | ☐ | ☐ |
| 2 | TBD | P2 | DeFi-experienced | TBD | ☐ | ☐ |
| 3 | TBD | P3 | Non-DeFi tech | TBD | ☐ | ☐ |
| 4 | TBD | P4 | Non-DeFi tech | TBD | ☐ | ☐ |
| 5 | TBD | P5 | Non-technical | TBD | ☐ | ☐ |
