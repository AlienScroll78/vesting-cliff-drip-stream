# Recipient Dashboard Design — Cliff Urgency States

> Issue #1038 — Design recipient dashboard with cliff urgency states

This spec defines the recipient dashboard UI with emphasis on communicating cliff state, claimable amounts, and vesting progress. The design celebrates cliff unlock as a positive milestone.

---

## 1. Stream Card States

Each stream is displayed as a card. The card's visual state communicates the stream's lifecycle phase at a glance.

### State Summary

| State | Visual | Icon | Color | Badge Text |
|-------|--------|------|-------|------------|
| Pre-cliff | Lock icon (closed padlock) | 🔒 | `--color-neutral-400` | "Locked" |
| Just-unlocked | Unlock animation | 🔓 | `--color-accent-unlock` (amber) | "Cliff Unlocked!" |
| Mid-vesting | Drip animation | 💧 | `--color-primary-500` | "Vesting" |
| Fully vested | Checkmark | ✓ | `--color-success-500` | "Fully Vested" |
| Cancelled | X icon | ✕ | `--color-error-400` | "Cancelled" |

---

## 2. Card Layout (Mobile-First)

```
┌──────────────────────────────────────────┐
│  ┌──────┐  USDC                         │  ← Token symbol (2xl, bold) + icon
│  │ icon │  $1,250.00 total              │  ← Total vesting amount (base, secondary)
│  └──────┘                                │
│                                          │
│  ╔════════════════════════════════════╗  │
│  ║  Claimable: $420.00               ║  │  ← Prominent claimable amount (xl, bold, primary)
│  ║  [    Claim Tokens    ]            ║  │  ← Claim CTA button (primary, full width)
│  ╚════════════════════════════════════╝  │
│                                          │
│  ┌────────────────────────────────────┐ │
│  │ ████████████░░░░░░░░░░░░░░░  48%   │ │  ← Progress bar (primary fill, neutral track)
│  │ 48% vested · 52% remaining         │ │  ← Progress labels (sm, secondary)
│  └────────────────────────────────────┘ │
│                                          │
│  🔒 Cliff unlocks in 12 days            │  ← Cliff countdown (sm, warning when <7 days)
│  From: Jan 1 → To: Mar 15, 2027         │  ← Vesting period dates (sm, secondary)
│                                          │
│  [▾ Technical details]                  │  ← Collapsible expander
└──────────────────────────────────────────┘
```

### Desktop Layout

On desktop (≥768px), cards arrange in a responsive grid (2-3 columns). Each card retains the same vertical layout but may use wider progress bars and inline date ranges.

---

## 3. Cliff Countdown — Urgency Progression

The cliff countdown changes visual style as the cliff approaches to create a sense of urgency without anxiety.

### Urgency Phases

| Time remaining | Style | Color | Tone |
|----------------|-------|-------|------|
| > 30 days | Normal | `--color-text-secondary` | "Cliff unlocks in 45 days" |
| 7–30 days | Mild awareness | `--color-primary-500` | "Cliff unlocks in 18 days" |
| 1–7 days | Warning | `--color-warning-500` | "Cliff unlocks in 5 days" |
| < 24 hours | Urgent | `--color-warning-600` + pulse animation | "Cliff unlocks in 8 hours" |
| Just unlocked | Celebration | `--color-accent-unlock` + confetti burst | "🎉 Cliff Unlocked!" |

### Countdown Format

| Range | Display format |
|-------|---------------|
| > 30 days | "X days" |
| 1–30 days | "X days Y hours" |
| < 24 hours | "X hours Y minutes" |
| < 1 hour | "X minutes Y seconds" |

### Countdown Animation

- **Normal (>7 days):** Static text, updates every minute
- **Warning (1–7 days):** Static text, subtle left border accent in warning color
- **Urgent (<24 hours):** Pulse animation on the badge background (opacity 0.8 ↔ 1.0, 2s cycle)
- **Just unlocked (<5 seconds after):** Confetti burst animation, then settles to static "Cliff Unlocked!" badge

---

## 4. Lock/Unlock Visual Language

### Pre-Cliff (Locked)

- **Icon:** Closed padlock (SVG, `--color-neutral-400`)
- **Progress bar:** Filled portion uses a striped/hatched pattern to indicate "locked" tokens
- **Claim button:** Disabled state with tooltip "Tokens unlock after cliff period"
- **Background:** Card uses `--color-bg-surface` (slightly muted)

### Cliff Unlock Transition

1. **Trigger:** Countdown reaches zero, contract confirms cliff passed
2. **Animation sequence (3 seconds total):**
   - 0.0s: Padlock icon shakes (250ms)
   - 0.25s: Padlock opens with spring animation (500ms)
   - 0.75s: Confetti particles burst from the icon (1s, 12 particles)
   - 0.75s: Card border flashes `--color-accent-unlock` then settles to normal
   - 1.0s: Progress bar transitions from hatched to solid primary fill (500ms)
   - 1.5s: "Cliff Unlocked!" badge appears with fade-in (500ms)
   - 2.0s: Claim button becomes enabled with emphasis animation (scale 1.0 → 1.05 → 1.0)
3. **After animation:** Badge remains, celebration styling fades. Card returns to normal with unlocked state.

### Mid-Vesting (Dripping)

- **Icon:** Droplet with subtle bounce animation (3s cycle, 2px translateY)
- **Progress bar:** Solid primary fill, smooth width transition
- **Claim button:** Enabled if claimable amount > 0

### Fully Vested

- **Icon:** Checkmark in circle (`--color-success-500`)
- **Progress bar:** 100% filled with success color
- **Claim button:** Enabled for any remaining claimable amount, or shows "All claimed" if balance is zero
- **Badge:** "Fully Vested" in success color

### Cancelled

- **Icon:** X in circle (`--color-error-400`)
- **Progress bar:** Frozen at cancellation point, muted color
- **Claim button:** Hidden or disabled
- **Badge:** "Cancelled" in error color
- **Note:** Shows "Cancelled on [date]. Unvested tokens returned to sponsor."

---

## 5. Claimable Amount Display

The claimable amount is the most prominent element on the card:

- **Size:** `--font-size-fluid-xl` (20-24px), `--font-weight-bold`
- **Color:** `--color-primary-600` (light) / `--color-primary-400` (dark)
- **Label:** "Claimable:" prefix in `--font-size-fluid-sm`, `--color-text-secondary`
- **Amount:** Token amount with token symbol (e.g., "$420.00 USDC")
- **Position:** Center of card, in a highlighted box with `--color-bg-elevated` background and `--radius-lg` border radius

### Zero Claimable State

When claimable is 0 (pre-cliff or all claimed):
- Amount shows "$0.00" in `--color-text-disabled`
- Claim button is disabled with explanatory tooltip

---

## 6. Claim CTA Button

| State | Style | Action |
|-------|-------|--------|
| Enabled (claimable > 0) | Primary button, full width, `--color-primary-600` | Opens wallet for signing |
| Disabled (claimable = 0) | Muted, `--color-neutral-300` bg | Tooltip: "No tokens to claim yet" |
| Loading (signing) | Spinner replaces text, disabled | Awaits wallet confirmation |
| Success | Brief checkmark flash, then card updates | Claimable amount decreases |

---

## 7. Claim Success Microinteraction

When a claim transaction is confirmed:

1. **Button state:** Shows spinner during signing (1-3s typical)
2. **On success:**
   - Button text → green checkmark (500ms)
   - Claimable amount animates: old value counts down to new value (800ms)
   - Subtle success toast appears: "Claimed $X.XX USDC successfully" (auto-dismiss 3s)
   - Card border briefly pulses `--color-success-500` (500ms)
   - Claim history table updates with new row (fade-in animation)
3. **On failure:**
   - Button returns to enabled state
   - Error toast: "Claim failed: [error message]" with retry link
   - No card state change

---

## 8. Dashboard Summary Widget

Above the stream cards, a summary widget shows aggregate stats:

```
┌─────────────────────────────────────────────────────┐
│  Total Claimable          Total Vesting             │
│  $1,240.00 USDC           $4,500.00 USDC            │
│  Across 3 streams         Across 3 streams          │
└─────────────────────────────────────────────────────┘
```

- **Total Claimable:** Sum of all claimable amounts, `--font-size-fluid-2xl`, `--color-primary-600`
- **Total Vesting:** Sum of all total vesting amounts, `--font-size-fluid-lg`, `--color-text-secondary`
- **Streams with urgent cliff:** Badge count of streams with cliff < 7 days

---

## 9. Accessibility

- All card states communicated via text (badge text), not color alone
- Lock/unlock icons have `aria-label` attributes ("Locked", "Unlocked")
- Progress bars have `role="progressbar"` with `aria-valuenow`, `aria-valuemin`, `aria-valuemax`
- Claim button has `aria-disabled` when claimable is 0
- Countdown updates respect `prefers-reduced-motion` (static text, no pulse)
- Confetti animation disabled when `prefers-reduced-motion: reduce`

---

## 10. Responsive Behavior

| Breakpoint | Layout |
|-----------|--------|
| < 640px (mobile) | Single column, full-width cards, stacked summary |
| 640-1024px (tablet) | 2-column card grid, summary spans full width |
| > 1024px (desktop) | 3-column card grid, summary widget + filters sidebar |
