# UI/UX Design Presentation
## Vesting Cliff Drip Stream — Stakeholder Review

**Audience:** Engineering, product, and design stakeholders  
**Purpose:** Document the why behind every major UI decision — from design tokens to component architecture  
**Date:** July 2026  
**Status:** Living document — update alongside each design iteration

---

## Slide 1 — Title

# Designing for Transparency in Decentralised Finance

### Vesting Cliff Drip Stream — UI/UX Design Rationale

> _"Token vesting is invisible money. Our UI job is to make it legible."_

This deck explains the design system choices, user journey, key screen decisions, and accessibility rationale for the Vesting Cliff Drip Stream frontend.

---

## Slide 2 — The Problem We're Solving (UX Lens)

### Users face three failure modes today

**1. Opacity** — Recipients don't know how much they've earned or when the cliff hits.  
**2. Anxiety** — Sponsors can't confirm the stream is active without querying the contract.  
**3. Friction** — Non-technical contributors (writers, designers) can't use a CLI-only tool.

### Design objectives derived from the problem

| Objective | How we address it |
|---|---|
| Make cliff timing instantly legible | Segmented progress bar with labelled phases |
| Reduce sponsor anxiety | Dashboard showing live stream status badges |
| Lower the technical floor | Step-by-step wizard with plain-language copy |
| Build trust in the numbers | Monospace tabular figures, exact ledger counts |

---

## Slide 3 — User Personas

### Persona 1 — The Sponsor (Project Lead)

> **"I need to know the stream is running and that I haven't overpaid."**

- **Name:** Morgan  
- **Role:** Protocol founder / team lead  
- **Technical level:** High (deploys contracts, reviews code)  
- **Primary goal:** Create streams, monitor status, cancel if a contributor leaves  
- **Key pain point:** Wants confirmation that the deposit transferred and the cliff date is correct  
- **Device:** Desktop, Chrome/Firefox  
- **Success metric:** Can create a stream and verify its status in under 2 minutes

---

### Persona 2 — The Recipient (Contributor)

> **"When can I claim? How much? Why is it still locked?"**

- **Name:** Sasha  
- **Role:** Open-source contributor (developer or non-technical)  
- **Technical level:** Low to medium (may not know what a ledger is)  
- **Primary goal:** Claim earned tokens without needing to understand the contract  
- **Key pain point:** Confused by "cliff not reached" errors from CLI; no time estimate  
- **Device:** Mobile-first; also desktop  
- **Success metric:** Can find their claimable amount and submit a claim in under 60 seconds

---

### Persona 3 — The Auditor / Developer

> **"Show me the raw numbers and the contract address."**

- **Name:** Riley  
- **Role:** Security researcher or integration developer  
- **Technical level:** Very high  
- **Primary goal:** Verify contract parameters match what was communicated off-chain  
- **Key pain point:** UI hides ledger numbers behind human-readable labels  
- **Device:** Desktop  
- **Success metric:** Can extract contract address, rate, cliff/end ledger in under 3 minutes

---

## Slide 4 — User Journey: Recipient Claim Flow

```
AWARENESS
    │
    ▼
Recipient receives notification / checks dashboard
    │
    ▼
DASHBOARD — Sees stream card with status badge
    │
    ├─ Status: PRE-CLIFF ──► Badge explains cliff not reached; shows estimated cliff date
    │
    └─ Status: ACTIVE ───────────────────────────────────────────────────────────┐
                                                                                  │
ENGAGEMENT                                                                        │
    │                                                                             │
    ▼                                                                             ▼
Recipient taps "Claim" ◄───────────────────────────────────────────────────────────
    │
    ▼
BOTTOM SHEET opens
    ├── Shows claimable amount (large, prominent)
    ├── Shows token symbol
    └── "Claim" CTA button
    │
    ▼
TRANSACTION SUBMITTED
    ├── Loading spinner while tx confirms
    └── Success state with claimed amount
    │
    ▼
RETURN TO DASHBOARD
    └── Updated stream card; progress bar advances
```

### Key UX decisions in this flow

- **Bottom sheet pattern** (not a modal) — native feel on mobile; gesture-dismissible
- **Amount first, details second** — claimable amount shown in large type immediately
- **No ledger numbers in claim sheet** — only shown on detail expansion
- **Single primary action per screen** — no competing CTAs

---

## Slide 5 — User Journey: Sponsor Create Flow

```
CONNECT WALLET
    └─ WalletButton with clear connect/connected/error states

WIZARD — 5 steps (progress indicator always visible)
    │
    ├─ Step 1: Connect Wallet (pre-check gate)
    ├─ Step 2: Select Token (balance shown inline)
    ├─ Step 3: Set Amounts (rate, cliff duration, total duration)
    │           └─ Live fee estimate shown as user types
    ├─ Step 4: Preview (human-readable summary; shows exact deposit amount)
    └─ Step 5: Confirm (sign & submit)

POST-CREATION
    └── StreamSuccessScreen with:
        ├── Confirmed stream parameters
        ├── Shareable link / copy contract address
        └── "View dashboard" CTA
```

### Key UX decisions

- **Wizard pattern** — reduces cognitive load; one decision per step
- **Live fee estimate** — removes the "surprise deposit" moment (biggest trust killer)
- **Preview step** — forces review before signing; reduces refund requests
- **Success screen** — closes the loop; confirms the stream is live

---

## Slide 6 — Key Screens

### Screen A — Dashboard (Sponsor view)

```
┌────────────────────────────────────────────────────────┐
│  Vesting Cliff Drip Stream          [Network] [Wallet] │
├────────────────────────────────────────────────────────┤
│  My Streams                     [+ Create new stream]  │
│                                                        │
│  ┌─── Stream Card ─────────────────────────────────┐   │
│  │  Sasha / GBTEST…k7     ● ACTIVE                │   │
│  │  ████████░░░░░░░░░░░░░░░░  48%                  │   │
│  │  Rate: 10 XLM/ledger · Cliff: passed            │   │
│  │  Claimable: 1,280 XLM          [Cancel stream]  │   │
│  └─────────────────────────────────────────────────┘   │
│                                                        │
│  ┌─── Stream Card ─────────────────────────────────┐   │
│  │  Riley / GCDEV…m3     🔒 PRE-CLIFF              │   │
│  │  ░░░░░░░░░░░░░░░░░░░░░░░░  0%                   │   │
│  │  Cliff in ~6 days                               │   │
│  └─────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────┘
```

**Design rationale:**
- Status badge at top right of each card — scannable at a glance
- Progress bar shows proportional position in stream lifecycle
- Claimable amount only shown when > 0 (reduces confusion for locked streams)
- Cancel only shown on sponsor's own dashboard

---

### Screen B — Recipient Claim Sheet (mobile)

```
┌──────────────────────────┐
│                          │
│  ─────────               │  ← handle (gesture hint)
│                          │
│  Your vested tokens      │
│                          │
│  ╔══════════════════╗    │
│  ║   1,280.00 XLM   ║    │  ← large, tabular-nums
│  ╚══════════════════╝    │
│                          │
│  Stream from: GBMORG…    │
│  Period: ledger 1.2M–1.4M│
│                          │
│  ┌──────────────────┐    │
│  │   Claim tokens   │    │  ← single full-width CTA
│  └──────────────────┘    │
└──────────────────────────┘
```

**Design rationale:**
- Full-width button — easy to tap with thumb on any phone size (≥ 44px touch target)
- Amount in large monospace — immediately legible, avoids squinting
- Minimal information — recipient doesn't need ledger math to claim

---

### Screen C — Vesting Timeline Component

```
Timeline: start ──────── cliff ─────────────────── end
           │              │                          │
           │  [locked]    │  ←── drip active ──────►│
           │              │                          │
  Segment: ████████████   ░░░░░░░░░░░░░░░░░░░░░░░░░░
             (purple)            (violet gradient)
                ↑
           Current ledger marker
```

**Design rationale:**
- Three-phase segmented bar: locked / drip-eligible / completed
- Colour-coded: amber = pre-cliff, violet = active, green = completed, red = cancelled
- Ledger numbers shown on hover/tap (progressive disclosure)
- WCAG AA contrast for all colour states (audited; see docs/a11y-audit.md)

---

## Slide 7 — Before / After: Stream Status Communication

### Before (contract-only, CLI output)

```
$ stellar contract invoke ... -- claimable_amount --recipient GBTEST
0
```

**Problems:**
- Returns 0 with no explanation
- No indication of *when* the cliff will pass
- No context about rate or total allocation
- Requires technical knowledge to interpret

---

### After (UI with status badge + progress bar)

```
┌──────────────────────────────────────────────────────┐
│  🔒 PRE-CLIFF                                        │
│  Cliff unlocks in approximately 6 days               │
│                                                      │
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 0 / 172,800 ld  │
│                                                      │
│  Rate:           10 XLM per ledger                   │
│  Total deposit:  1,728,000 XLM                       │
│  Your share:     1,728,000 XLM                       │
└──────────────────────────────────────────────────────┘
```

**Improvements:**
- Plain-language status with emoji anchor for visual scanning
- Human-readable cliff countdown (approximate days)
- Progress bar shows 0% during lock-up — viscerally communicates "nothing yet"
- Full allocation visible — sets recipient expectations correctly

---

### Before / After: Claim Error

| Before | After |
|---|---|
| `Error: VestingError(2) CliffNotReached` | Inline amber banner: "Your cliff hasn't passed yet. Claiming opens in ~6 days." |
| Red browser console error | No error shown — claim button hidden or disabled until cliff passes |
| User has to look up error code 2 | Status badge explains state proactively |

---

## Slide 8 — Accessibility Rationale

### Why accessibility is a first-class concern

Vesting contracts serve global contributors spanning every technical background, device type, and physical ability. Accessibility is not polish — it is parity.

### WCAG 2.1 AA compliance (verified — see docs/a11y-audit.md)

| Criterion | Our approach |
|---|---|
| **1.4.3 Contrast (minimum)** | All text/background pairs ≥ 4.5:1. Dark mode audited separately. |
| **1.4.4 Resize text** | Fluid type scale; no text in images. Zoom to 200% without horizontal scroll. |
| **2.1.1 Keyboard** | All interactive elements reachable by Tab; no keyboard traps. |
| **2.4.3 Focus order** | Logical DOM order; focus moves to modal/sheet on open. |
| **4.1.2 Name, role, value** | ARIA labels on icon buttons, role=dialog on modals, aria-live for transaction status. |
| **2.4.11 Focus appearance** | 2px solid outline with 2px offset on all focus-visible targets. |

### Specific decisions

**Status badges** use both colour and text label — colour is never the sole indicator (addresses 1.4.1).

**Transaction spinner** announces state change via aria-live region — screen reader users know when a tx confirms without watching the screen.

**Bottom sheet** traps focus inside when open via focusTrap utility (see `frontend/src/utils/focusTrap.ts`).

**Skip navigation link** at page top — keyboard users can jump past repeated nav elements.

**Touch targets** — all interactive elements ≥ 44×44px (WCAG 2.5.5 AAA target; we meet it at AA level).

---

## Slide 9 — Mobile-First Rationale

### Why mobile-first?

1. **Recipient persona is mobile-dominant** — Sasha (recipient) checks their allocation during commutes, on mobile. Sponsors (Morgan) are more likely on desktop, but still use mobile to check status.

2. **DeFi is mobile** — Freighter and other Stellar wallets have strong mobile app usage. Meeting recipients where they are reduces friction.

3. **Progressive enhancement is safer** — designing for the smallest viewport first prevents accidental desktop-only assumptions (e.g. hover states as the only affordance).

### How mobile-first shapes the design

| Pattern | Mobile implementation | Desktop extension |
|---|---|---|
| Stream list | Single column, full width | Two-column grid at ≥ 768px |
| Claim interaction | Full-screen bottom sheet | Inline panel / modal |
| Wallet connect | Full-width button | Corner button in header |
| Navigation | No top nav; action is on-screen | Persistent header with links |
| Forms | Single input per viewport height | Multi-column form layout |

### Viewport targets

| Breakpoint | Target devices |
|---|---|
| 320px | Smallest supported phone (iPhone SE 1st gen) |
| 375px | iPhone 12 mini / most Android base models |
| 430px | iPhone 14 Pro Max |
| 768px | Tablet portrait / large phone landscape |
| 1280px | Desktop |

The `max-width: 720px` page container ensures readable line lengths on all widths above tablet — body text never exceeds 72ch.

---

## Slide 10 — Design Token System

### Architecture

All visual values are CSS custom properties defined in `design-system/tokens/tokens.css`. Components never use hard-coded values.

```
design-system/
├── tokens/
│   ├── tokens.css       ← global tokens (colour, spacing, radius, shadow, transition)
│   └── typography.css   ← fluid type scale (clamp-based)
└── components/
    └── components.css   ← component styles consuming tokens only
```

### Why tokens (not inline styles or Tailwind utilities)?

| Consideration | Token approach | Utility class approach |
|---|---|---|
| Theme-ability (dark/light) | One `:root` swap | Rebuild all utility combinations |
| Design tool sync | Single source of truth for Figma | Tokens must be mapped manually |
| Runtime theming | `document.documentElement.style.setProperty` | No runtime override |
| Specificity conflicts | No conflicts (custom props cascade naturally) | Potential `!important` battles |

### Token naming convention

```
--{category}-{variant}-{modifier}

Examples:
  --color-brand-primary
  --color-bg-surface
  --font-size-fluid-body
  --space-4
  --radius-base
  --transition-fast
```

### Design token categories

| Category | Prefix | Example |
|---|---|---|
| Colour | `--color-` | `--color-brand-primary: #7C3AED` |
| Typography | `--font-` | `--font-size-fluid-h1` |
| Spacing | `--space-` | `--space-4: 1rem` |
| Border radius | `--radius-` | `--radius-base: 0.5rem` |
| Shadow | `--shadow-` | `--shadow-md` |
| Transition | `--transition-` | `--transition-fast: 150ms ease` |

---

## Slide 11 — Component Library Overview

All components are built on top of the token system. No component hardcodes a colour, size, or spacing value.

### Component inventory

| Component | File | Purpose |
|---|---|---|
| Button | `components.css` · `.btn` | Primary, secondary, danger; sm/default/lg sizes |
| Input | `components.css` · `.input` | Text, number, address entry; error state |
| Card | `components.css` · `.card` | Stream card, info panels |
| StatusBadge | `StatusBadge.tsx` | Active / pre-cliff / completed / cancelled |
| VestingTimeline | `VestingTimeline.tsx` | Segmented progress bar with phase labels |
| ClaimBottomSheet | `ClaimBottomSheet.tsx` | Mobile claim sheet; full-width CTA |
| StreamCreateForm | `StreamCreateForm.tsx` | Sponsor create flow (non-wizard fallback) |
| CreateStreamWizard | `CreateStreamWizard.tsx` | 5-step wizard with progress indicator |
| WalletButton | `WalletButton.tsx` | Connect/connected/connecting/error states |
| TxDrawer | `TxDrawer.tsx` | Transaction history side-drawer |
| CancelConfirmModal | `CancelConfirmModal.tsx` | Destructive action with confirmation gate |
| Skeletons | `Skeletons.tsx` | Loading placeholders (pulse animation) |
| EmptyStates | `EmptyStates.tsx` | Zero-state for stream list and history |
| ErrorBoundary | `ErrorBoundary.tsx` | Catch-all fallback for JS errors |

### Component API principles

1. **Accept token variable names, not raw values** — e.g. `color` prop accepts `--color-danger`, not `#EF4444`
2. **Minimal required props** — defaults cover 90% of use cases
3. **ARIA-first** — every interactive component ships with correct roles and labels baked in
4. **Composable, not monolithic** — Card + CardHeader + CardBody rather than a single prop-heavy Card

### Before / after: Button

**Before (bespoke per-page):**
```html
<button style="background:#7C3AED;color:#fff;padding:8px 16px;border-radius:8px">
  Claim
</button>
```

**After (token-driven component):**
```html
<button class="btn btn--primary">Claim</button>
```

One class change from `btn--primary` to `btn--danger` updates colour, and a future token update (e.g. rebranding) changes every button simultaneously.

---

## Slide 12 — Dark Mode Design Rationale

### Why dark mode is default

1. **Web3 conventions** — wallets, block explorers, and trading interfaces are predominantly dark. A light default creates jarring context switching.
2. **Reduces eye strain for night-time claiming** — recipients in different time zones often check balances after hours.
3. **Background colours** — dark surfaces (`--color-bg-base: #0F172A`) provide higher contrast for the violet brand colour than white backgrounds.

### Light mode is available

Toggled via the `useDarkMode` hook and a `.dark` class on `<html>`. All semantic colour tokens flip cleanly:

```css
.dark {
  --color-bg-base:    #0F172A;
  --color-text-primary: #F8FAFC;  /* 15.8:1 contrast */
}

/* light mode (default) */
:root {
  --color-bg-base:    #F9FAFB;
  --color-text-primary: #111827;  /* 16.1:1 contrast */
}
```

Both modes are WCAG AA audited. Contrast ratios documented in `docs/a11y-audit.md`.

---

## Slide 13 — Typography Rationale

*(Expanded in the full typography system — see design-system/tokens/typography.css)*

### Core decisions

**System font stack for body text** — `-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`
- Zero loading latency
- Native rendering on every OS (hinting, subpixel anti-aliasing)
- Reduces bundle size (no web font request)

**JetBrains Mono for addresses and ledger numbers**
- Tabular figures — columns align without `font-variant-numeric` workarounds
- Every Stellar address (G…, C…) renders at equal character width — easy to visually diff
- Familiar to developer persona

**Fluid type scale with `clamp()`**
- No media query breakpoints for typography
- Smooth interpolation between mobile minimum and desktop maximum
- Body text: `clamp(1rem, 0.93rem + 0.35vw, 1.125rem)` → 16px–18px

**Line length capped at 72ch**
- Optimal readability: 45–85 characters per line; 72 is comfortable for dense financial data
- Implemented via `max-width: 72ch` on body text containers

**Line height 1.6 for body text**
- Generous leading improves readability for non-native English speakers
- Accessible line spacing (WCAG 1.4.12 Text Spacing)

---

## Slide 14 — Interaction Principles

### The three rules that govern every interaction

**1. Optimistic UI with graceful rollback**  
Show the expected result immediately; roll back to the previous state if the transaction fails. Reduces perceived latency on Stellar (5-second block times).

**2. Progressive disclosure**  
Show the minimum information needed to take action. Reveal detail on demand (expandable sections, drawer, tap to expand). Prevents information overload for the recipient persona.

**3. Irreversible actions require friction**  
Cancel stream → confirmation modal with explicit "Yes, cancel stream" button (not just "OK"). This is the pattern from `CancelConfirmModal.tsx`. Destructive actions use `--color-danger` throughout the confirmation flow.

---

## Slide 15 — Design Decisions Summary

| Area | Decision | Rationale |
|---|---|---|
| Default theme | Dark | Web3 convention; brand colour pops |
| Type scale | Fluid clamp() | No breakpoint maintenance; smooth scaling |
| Claim interaction | Bottom sheet | Mobile-native; gesture-dismissible |
| Create flow | Wizard | One decision per step; reduces errors |
| Status communication | Badge + progress bar | Two independent channels (colour + text) |
| Font for numbers | JetBrains Mono | Tabular; easy to diff Stellar addresses |
| Layout width | max 720px | Optimal line length; never exceeds 72ch |
| Token architecture | CSS custom props | Runtime-themeable; single source of truth |
| Accessibility | WCAG AA baseline | Audited via Axe + manual keyboard + VoiceOver |
| Mobile-first | Yes | Recipient persona is mobile-dominant |

---

## Slide 16 — Next Steps and Open Questions

### Short-term (next sprint)

- [ ] Commission Figma component library from design tokens
- [ ] Record Loom walkthrough of recipient claim flow for async onboarding
- [ ] Run formal usability study with 5 participants (plan in `docs/research/usability-study-1.md`)
- [ ] Add `@axe-core/playwright` to CI to catch regressions automatically

### Medium-term

- [ ] RTL layout support (Arabic/Hebrew — stub already in globals.css)
- [ ] Onboarding tour (hook scaffolded in `useOnboardingTour.ts`)
- [ ] Animated cliff countdown (replaces static "~6 days" label)
- [ ] Sponsor bulk-create UI (multiple streams, CSV upload)

### Open questions for stakeholders

1. **Should recipients see the sponsor's identity** — full address or an alias they set at creation?
2. **Notification strategy** — email, push, or in-app only for cliff unlock events?
3. **Brand typeface** — continue with system font stack or invest in a custom web font?
4. **Error copy** — current copy is developer-facing; should we A/B test plain-language alternatives?

---

## Appendix — Related Documents

| Document | Path | Content |
|---|---|---|
| Accessibility audit | `docs/a11y-audit.md` | WCAG 2.1 AA results, contrast ratios |
| Usability study plan | `docs/research/usability-study-1.md` | Session format, tasks, metrics |
| Mobile claim sheet spec | `docs/mobile-claim-bottom-sheet.md` | Detailed interaction spec |
| Design tokens | `design-system/tokens/tokens.css` | All CSS custom properties |
| Typography system | `design-system/tokens/typography.css` | Fluid type scale |
| Component styles | `design-system/components/components.css` | Button, input, card |
| A11y audit | `docs/a11y-audit.md` | Zero critical violations |
| Glossary | `docs/glossary.md` | cliff, ledger, sponsor, recipient definitions |
