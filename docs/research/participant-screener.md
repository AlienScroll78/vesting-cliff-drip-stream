# Participant Screener — Vesting Cliff Drip Stream Usability Study

**Issue:** #388  
**Version:** 1.0  
**Status:** Ready for use

---

## Recruiter Script

Use this script when contacting potential participants via Discord or email.

---

> "Hi [name], we're running a 45-minute usability research session for the Vesting Cliff Drip Stream project and are looking for people who'd like to help us improve the interface.
>
> No prior experience with this project is needed — in fact, new users give us the most valuable feedback. You'll complete a few tasks in our staging app while sharing your screen and thinking aloud.
>
> As a thank-you, we'll send you **50 testnet XLM** and acknowledge you in the next release notes.
>
> Would you be willing to answer 10 quick questions so we can confirm you're a good fit?"

---

## Qualification Criteria

| Group target | Required | Disqualifying |
|---|---|---|
| DeFi-experienced (2 slots) | Used a vesting/streaming tool OR familiar with Stellar/Soroban | Works on this project as a core contributor |
| Non-DeFi tech (2 slots) | Uses web apps daily; no DeFi experience | Has used DeFi protocols before |
| Non-technical (1 slot) | Comfortable browsing the web; no software background | Is a developer or has used crypto wallets |

**Hard disqualifiers for all groups:**
- Core contributor to the vesting-cliff-drip-stream repository
- Unable to use Chrome or Firefox on a desktop/laptop during the session
- Unable to share their screen
- Has participated in a usability study for this project in the past 6 months

---

## Screening Questions

Read or send these questions. Record answers and qualifying status.

---

**Q1.** Which of the following best describes your technical background?
- A. Software developer / engineer → qualifies for DeFi-experienced or non-DeFi tech
- B. Designer, writer, or other non-engineering professional → qualifies for non-DeFi tech or non-technical
- C. Non-technical (business, creative, student, other) → qualifies for non-technical slot
- D. Student studying computer science → qualifies for non-DeFi tech

---

**Q2.** Have you ever used a DeFi protocol, token-vesting tool, or crypto streaming service? (e.g. Sablier, Drips, Superfluid, Uniswap, Aave)
- Yes, I use them regularly → **DeFi-experienced slot**
- Yes, I've tried one → **DeFi-experienced slot** (if also answers Q3 well)
- No, never → **Non-DeFi tech or non-technical slot**

---

**Q3.** Are you familiar with the Stellar network or Soroban smart contracts?
- Yes, I've built on Stellar or Soroban → **DeFi-experienced slot** (ideal P2)
- I've heard of them but haven't used them → neutral
- No → neutral

---

**Q4.** Do you currently contribute to the vesting-cliff-drip-stream GitHub repository?
- Yes → **Disqualify** (conflict of interest)
- No → Continue

---

**Q5.** Can you join via a desktop or laptop computer (not a phone or tablet) and share your screen during the session?
- Yes → Continue
- No → **Disqualify**

---

**Q6.** Do you have Chrome or Firefox installed on that computer?
- Yes → Continue
- No → Ask them to install before the session; continue if they agree

---

**Q7.** Have you participated in a usability study for this project in the past 6 months?
- Yes → **Disqualify**
- No → Continue

---

**Q8.** On a scale of 1–5, how comfortable are you using new web applications you've never seen before? (1 = very uncomfortable, 5 = very comfortable)
- 1–2 → Good fit for non-technical slot
- 3–5 → Good fit for non-DeFi tech or DeFi-experienced slot

---

**Q9.** Roughly how many hours per week do you use a web browser for work or personal tasks?
- < 1 hour → **Non-technical slot** (if other answers align)
- 1–5 hours → Any slot depending on other answers
- > 5 hours → Non-DeFi tech or DeFi-experienced slot

---

**Q10.** Are you available for a 45-minute video call between [date range]? (Sessions are remote via Google Meet / Zoom.)
- Yes, on [date/time] → Schedule
- No availability in range → **Defer** to next round

---

## Slot Allocation Summary

| Slot | Qualifying profile |
|------|-------------------|
| P1 — DeFi-experienced | Q2 = Yes + Q3 = Yes/maybe |
| P2 — DeFi-experienced (Stellar) | Q2 = Yes + Q3 = Yes (Stellar/Soroban) |
| P3 — Non-DeFi tech | Q1 = A or B + Q2 = No |
| P4 — Non-DeFi tech (non-eng) | Q1 = B + Q2 = No |
| P5 — Non-technical | Q1 = B or C + Q2 = No + Q8 ≤ 2 |

---

## Scheduling Email Template

Send after confirming qualification:

---

> Subject: Usability study confirmed — [date/time]
>
> Hi [name],
>
> Thank you for agreeing to participate in our usability study! Here are the details:
>
> **Date:** [Day, Month Date, Year]  
> **Time:** [HH:MM timezone]  
> **Duration:** ~45 minutes  
> **Link:** [video call URL]
>
> **Before the session, please:**
> - Install the Freighter browser extension: https://www.freighter.app
> - Use Chrome or Firefox on a desktop or laptop (not a phone)
> - Test that you can share your screen in the video call
> - Review the consent form attached to this email and sign it
>
> **What to expect:**  
> You'll be asked to complete a few tasks in our staging app while sharing your screen and thinking aloud. There are no right or wrong answers — we're testing the app, not you.
>
> If you have any questions before the session, reply to this email.
>
> See you on [date]!
>
> [Facilitator name]  
> [Project / organisation]

---

## Pre-Session Checklist (for participant)

Send as a reminder 1 hour before the session:

- [ ] Freighter extension installed in Chrome or Firefox
- [ ] Camera and microphone working
- [ ] Screen sharing tested (join the call early if unsure)
- [ ] Consent form signed and returned
- [ ] Staged environment accessible: https://staging.example.com
- [ ] Quiet environment with minimal interruptions
