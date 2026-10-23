# Information Architecture & UX Audit

> Issue #1035 — Conduct UX audit and define information architecture

This document defines the information architecture (IA), user journeys, site map, and identified pain points for the Vesting Cliff Drip Stream application. It covers both sponsor and recipient roles.

---

## 1. User Roles

| Role | Description | Primary goals |
|------|-------------|---------------|
| **Sponsor** | Creates and funds vesting streams for recipients | Set up streams easily, monitor status, cancel if needed |
| **Recipient** | Receives vested tokens over time via cliff + drip | Understand vesting progress, claim available tokens, track timeline |

---

## 2. Site Map

```
┌─────────────────────────────────────────────────────┐
│                    App Shell                          │
│  [Logo]  Dashboard  Streams  Create  Help  [Wallet]   │
├─────────────────────────────────────────────────────┤
│                                                       │
│  / (Dashboard)                                        │
│  ├── Sponsor view: Active streams I created           │
│  ├── Recipient view: Streams vesting toward me        │
│  └── Role toggle (Sponsor / Recipient)                │
│                                                       │
│  /streams/:id                                         │
│  ├── Stream detail (recipient, amount, schedule)      │
│  ├── Cliff timeline visualization                      │
│  ├── Claim history                                    │
│  └── Actions: Claim / Cancel (role-dependent)          │
│                                                       │
│  /create                                              │
│  └── Stream creation wizard (3 steps + advanced)      │
│                                                       │
│  /help                                                │
│  ├── What is a cliff?                                 │
│  ├── What is vesting?                                 │
│  ├── How do claims work?                              │
│  └── Glossary                                         │
│                                                       │
│  /settings                                            │
│  ├── Theme (light/dark)                               │
│  ├── Network (testnet/mainnet)                        │
│  └── Notifications                                    │
│                                                       │
│  /admin (sponsors only)                               │
│  ├── All streams overview                             │
│  ├── Cancelled streams                                │
│  └── Audit log                                        │
└─────────────────────────────────────────────────────┘
```

### Navigation Hierarchy

| Level 1 | Level 2 | Visible to |
|---------|---------|------------|
| Dashboard | — | All users |
| Streams | Stream detail | All users |
| Create | Wizard steps | Sponsors |
| Help | Concept guides, glossary | All users |
| Settings | Theme, network, notifications | All users |
| Admin | Overview, audit log | Sponsors only |

---

## 3. User Journey Maps

### 3.1 Sponsor: Creating a Stream

```
Entry → Dashboard → Click "Create Stream"
  → Step 1: Recipient + Token
    → Enter recipient address
    → Select token (dropdown or paste contract ID)
    → Validate address format + token trustline
  → Step 2: Cliff + Duration
    → Set cliff period (human-friendly: "30 days")
    → Set total vesting duration
    → Visual: mini token flow diagram showing cliff → drip
    → [Advanced] Metadata, allowlist, variable segments
  → Step 3: Review
    → Total deposit calculation
    → Fee estimate
    → Confirm and sign transaction
  → Success: Stream created, redirect to stream detail
```

**Emotions:** Intent → Mild complexity concern → Confidence (visual aids) → Satisfaction

**Pain points:** Understanding cliff concept, uncertainty about total deposit, anxiety about fees.

### 3.2 Recipient: Claiming Tokens

```
Entry → Dashboard (recipient view)
  → See active streams with claimable amounts
  → Click stream card → Stream detail
  → View cliff countdown and vesting progress
  → See "Claimable: X tokens" prominently
  → Click "Claim" button
  → Confirm claim in wallet (Freighter)
  → Success animation (celebration microinteraction)
  → Updated claimable balance
```

**Emotions:** Curiosity → Informed (clear countdown) → Excitement (cliff unlocked) → Confidence (claim) → Satisfaction

**Pain points:** Understanding why tokens are locked, confusion about when cliff ends, anxiety about missing the unlock.

### 3.3 Sponsor: Cancelling a Stream

```
Entry → Dashboard (sponsor view)
  → Find stream in "Active streams" list
  → Click stream → Stream detail
  → Click "Cancel stream" (with warning icon)
  → Confirmation dialog: "Unvested tokens will return to you"
  → Sign cancellation transaction
  → Stream status: Cancelled
  → Remaining tokens refunded to sponsor
```

**Emotions:** Decision → Caution → Confirmation → Relief

**Pain points:** Uncertainty about how much is refunded, fear of losing already-vested tokens.

---

## 4. Pain Points Identified

### 4.1 Ledger Number Exposure

**Problem:** Stellar uses ledger sequences (~5s apart) for timing. Users unfamiliar with Stellar cannot interpret "ledger 1,234,567" as a date.

**Solution:**
- Always display human-friendly dates and countdowns ("Cliff ends in 12 days")
- Show ledger number in a collapsible "Technical details" section for power users
- Use relative time for near-term events ("in 3 hours"), absolute dates for far-term ("Jan 15, 2027")
- Never require the user to input ledger numbers — use date pickers and duration fields

### 4.2 Cliff Concept Confusion

**Problem:** "Cliff" is a financial term most users don't understand. The idea that tokens are completely locked until a cliff date, then start dripping, is counterintuitive.

**Solution:**
- Use visual diagrams in the creation wizard (mini token flow: locked → cliff → drip)
- On the recipient dashboard, show a timeline with "locked" and "unlocking" phases clearly labeled
- Include a "What is a cliff?" tooltip/help link near every cliff-related UI element
- Use positive language for unlock: "Cliff unlocks in X days" not "Cliff ends in X ledgers"

### 4.3 Multiple Streams Overwhelm

**Problem:** Recipients with multiple streams may feel overwhelmed trying to track vesting progress across different tokens and schedules.

**Solution:**
- Card-based layout with key info at a glance (token symbol, claimable amount, cliff status)
- Sort by claimable amount or cliff urgency by default
- Summary widget at top of dashboard: total claimable across all streams

### 4.4 Transaction Anxiety

**Problem:** Users may hesitate to click "Claim" or "Create" because they fear irreversible mistakes.

**Solution:**
- Clear confirmation dialogs with amount and recipient shown
- Fee estimates shown before signing
- Success states with clear confirmation of what happened
- "Learn more" links for each action

---

## 5. Information Architecture Principles

1. **Human-first, technical-second:** Always show dates and durations. Ledger numbers and contract IDs go in expandable "details" sections.
2. **Progressive disclosure:** Simple users see only what they need. Advanced options are behind expanders.
3. **Role-aware navigation:** Sponsors see creation and management tools. Recipients see claiming and tracking tools.
4. **Celebration moments:** Cliff unlock and successful claims are positive events. The UI should celebrate them.
5. **Transparency without overwhelm:** Show what matters (claimable amount, cliff status) prominently. Hide what doesn't (ledger numbers, contract internals) by default.

---

## 6. Page Responsibilities

### Dashboard (`/`)
- **Sponsor view:** Active streams (created by me), total deposited, total claimed
- **Recipient view:** Incoming streams, total claimable, cliff countdown badges
- **Role toggle:** Switch between sponsor and recipient perspectives

### Stream Detail (`/streams/:id`)
- Stream status badge (active, cliff, vesting, completed, cancelled)
- Cliff timeline with countdown
- Claimable amount with Claim CTA (recipients)
- Cancel button (sponsors)
- Claim history table
- Technical details (collapsible): contract ID, ledger numbers, raw schedule

### Create Wizard (`/create`)
- 3-step progressive disclosure (see issue #1037 for full spec)
- Advanced options expander for metadata, allowlist, variable segments

### Help (`/help`)
- Plain-language guides for cliff, vesting, claiming
- Glossary of terms (ledger, trustline, cliff, drip, vesting)
- FAQ

---

## 7. Approval

This IA document should be reviewed and approved by at least one stakeholder before frontend implementation begins. Key decisions to confirm:

- [ ] Default landing page (Dashboard with role toggle vs. separate sponsor/recipient routes)
- [ ] Help content location (dedicated page vs. contextual tooltips)
- [ ] Admin section visibility (separate route vs. dashboard filter)
- [ ] Dark mode as default or light mode as default
