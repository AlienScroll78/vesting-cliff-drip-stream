# Stream Creation Wizard — Progressive Disclosure Design

> Issue #1037 — Design stream creation wizard with progressive disclosure

This spec defines a 3-step wizard for stream creation that progressively discloses complexity. Novice users can create a stream in 3 steps; advanced users access all options via an expander.

---

## 1. Wizard Overview

```
┌──────────────────────────────────────────────────┐
│  Create Stream                          [✕]     │
│                                                  │
│  ●━━━━━━━━━○━━━━━━━━━○                           │
│  1 Recipient    2 Schedule    3 Review           │
│                                                  │
│  [Step content here]                             │
│                                                  │
│  [◀ Back]                    [Next ▶]           │
└──────────────────────────────────────────────────┘
```

### Progress Indicator

- 3 dots connected by a line, current step filled with `--color-primary-600`
- Completed steps show a checkmark inside the dot
- Step labels below: "1 Recipient", "2 Schedule", "3 Review"
- Animated transition between steps (slide left/right, 250ms)

---

## 2. Step 1 — Recipient & Token

### Layout (Mobile)

```
┌──────────────────────────────────────────┐
│  Step 1 of 3: Recipient & Token           │
│                                          │
│  Recipient Address                       │
│  ┌──────────────────────────────────────┐ │
│  │ G...                                  │ │
│  └──────────────────────────────────────┘ │
│  ✓ Valid Stellar address                  │
│                                          │
│  Token                                    │
│  ┌──────────────────────────────────────┐ │
│  │ [Select token ▾]                      │ │
│  └──────────────────────────────────────┘ │
│  USDC · Trustline: ✓ Verified             │
│                                          │
│  [◀ Back]              [Next ▶]           │
└──────────────────────────────────────────┘
```

### Validation States

| Field | Empty | Invalid | Valid |
|-------|-------|---------|-------|
| Recipient address | Placeholder "G..." | Red border + "Invalid Stellar address" | Green checkmark + "Valid Stellar address" |
| Token | "Select token" dropdown | N/A (only valid tokens listed) | Token symbol + trustline status |

### Token Selection

- Dropdown of known tokens (USDC, EURC, USDT, XLM, custom)
- "Custom token" option reveals a contract ID input field
- On selection: verify trustline exists between recipient and token contract
- Show trustline status: ✓ Verified, ⚠ No trustline (warning), ℹ Checking...

---

## 3. Step 2 — Cliff & Duration Configuration

### Layout (Mobile)

```
┌──────────────────────────────────────────┐
│  Step 2 of 3: Cliff & Duration            │
│                                          │
│  ┌──────────────────────────────────────┐ │
│  │  📊 Mini Token Flow Diagram           │ │
│  │                                      │ │
│  │  ████░░░░│████████████│░░░░░░░░       │ │
│  │  Locked   │  Drip      │  Complete    │ │
│  │  (cliff)  │  (vesting) │  (vested)    │ │
│  └──────────────────────────────────────┘ │
│                                          │
│  Cliff Period                            │
│  ┌──────────┐ ┌──────────┐               │
│  │ 30       │ │ days ▾   │               │
│  └──────────┘ └──────────┘               │
│  Tokens are fully locked during cliff    │
│                                          │
│  Vesting Duration                        │
│  ┌──────────┐ ┌──────────┐               │
│  │ 90       │ │ days ▾   │               │
│  └──────────┘ └──────────┘               │
│  After cliff, tokens drip over this period│
│                                          │
│  Total Period: 120 days                  │
│  (Cliff: 30 days + Vesting: 90 days)     │
│                                          │
│  ▾ Advanced Options                      │
│                                          │
│  [◀ Back]              [Next ▶]          │
└──────────────────────────────────────────┘
```

### Mini Token Flow Diagram

The diagram is the key educational element that explains the cliff concept visually:

```
  ████░░░░░░░░░░│████████████████│░░░░░░░░░░
  ←─ Cliff ──→  ←── Drip ────→  ← Complete →
   (locked)       (vesting)      (vested)
```

- **Cliff section:** Hatched/striped fill in `--color-neutral-400` with lock icon
- **Drip section:** Gradient fill from `--color-primary-300` to `--color-primary-600` with droplet icon
- **Complete section:** Solid `--color-success-400` with checkmark icon
- The diagram updates in real-time as the user adjusts cliff and duration values
- Below the diagram: "Cliff: 30 days → Vesting: 90 days → Total: 120 days"

### Duration Inputs

- **Cliff period:** Number input + unit dropdown (days, weeks, months)
- **Vesting duration:** Number input + unit dropdown (days, weeks, months)
- **Constraint:** Vesting duration ≥ 1 day
- **Constraint:** Cliff period ≥ 0 (0 = no cliff, immediate vesting)
- **Derived:** Total period = cliff + vesting, displayed as summary

### Advanced Options Expander

Collapsed by default. Expands with smooth height animation (250ms).

```
  ▾ Advanced Options
  ┌──────────────────────────────────────┐
  │ Stream Metadata                      │
  │ ┌────────────────────────────────────┐ │
  │ │ Optional label or memo             │ │
  │ └────────────────────────────────────┘ │
  │                                      │
  │ Allowlist                            │
  │ ☐ Restrict claiming to specific      │
  │   addresses                          │
  │ [Add address...]                     │
  │                                      │
  │ Variable Rate Segments               │
  │ ☐ Enable custom vesting schedule     │
  │   with variable rates per segment    │
  │ [Add segment...]                     │
  └──────────────────────────────────────┘
```

### Validation States

| Field | Empty/Default | Invalid | Valid |
|-------|--------------|---------|-------|
| Cliff period | Placeholder "30" | Red: "Cliff must be ≥ 0" | Green: "Cliff: 30 days" |
| Vesting duration | Placeholder "90" | Red: "Duration must be ≥ 1 day" | Green: "Vesting: 90 days" |
| Total exceeds limits | N/A | Red: "Total period exceeds 365 days maximum" | Green checkmark |

---

## 4. Step 3 — Review & Confirm

### Layout (Mobile)

```
┌──────────────────────────────────────────┐
│  Step 3 of 3: Review                     │
│                                          │
│  ┌──────────────────────────────────────┐ │
│  │  Recipient                           │ │
│  │  GABC...XYZ                          │ │
│  │                                      │ │
│  │  Token: USDC                         │ │
│  │  Cliff: 30 days                      │ │
│  │  Vesting: 90 days                     │ │
│  │  Total: 120 days                      │ │
│  │                                      │ │
│  │  ─────────────────────────────────── │ │
│  │  Total Deposit:    $1,250.00 USDC    │ │
│  │  Network Fee:     ~$0.02 XLM         │ │
│  │  ─────────────────────────────────── │ │
│  │  Total Cost:      $1,250.02           │ │
│  └──────────────────────────────────────┘ │
│                                          │
│  Mini token flow diagram (read-only)     │
│  ████░░░│████████│░░░░░░                  │
│                                          │
│  ☐ I understand tokens are locked        │
│    during the cliff period               │
│                                          │
│  [◀ Back]         [Create Stream ✓]      │
└──────────────────────────────────────────┘
```

### Review Summary Contents

| Field | Source | Display |
|-------|--------|---------|
| Recipient address | Step 1 | Truncated with "copy" button |
| Token | Step 1 | Symbol + name |
| Cliff period | Step 2 | "30 days" |
| Vesting duration | Step 2 | "90 days" |
| Total period | Calculated | "120 days" |
| Total deposit | Calculated | Amount + token symbol |
| Network fee | Estimated | "~$0.02 XLM" |
| Total cost | Calculated | Deposit + fee |

### Confirmation Checkbox

- Required: User must check "I understand tokens are locked during the cliff period"
- Create button is disabled until checkbox is checked
- Tooltip on disabled button: "Please confirm you understand the cliff terms"

### Create Button

| State | Style | Action |
|-------|-------|--------|
| Disabled (checkbox unchecked) | Muted, `--color-neutral-300` | Tooltip: "Confirm understanding first" |
| Enabled | Primary, `--color-primary-600`, full width | Opens wallet for signing |
| Loading (signing) | Spinner, disabled | Awaits wallet confirmation |
| Success | Redirect to stream detail page | Brief success toast |

---

## 5. Navigation & Error Handling

### Back/Next Navigation

- **Back button:** Always available (except Step 1). Returns to previous step without losing data.
- **Next button:** Disabled until current step is valid. On click: validates, then advances.
- **Step skipping:** Not allowed. Users must complete steps in order.
- **Data persistence:** Wizard state persists across step navigation. If user navigates back from Step 3 to Step 1, Step 1 shows their previous input.

### Error Messages

| Error type | Display | Position |
|-----------|---------|----------|
| Invalid field | Red text below field, `--color-error-500` | Below the input |
| Constraint violation | Red text below field group | Below the group |
| Network error (fee estimate) | Warning banner at top of Step 3 | Above review summary |
| Wallet rejection | Error toast: "Transaction rejected" | Bottom of modal |
| Transaction failure | Error toast with error message + retry | Bottom of modal |

### Validation Timing

- **On blur:** Field validates when user leaves it
- **On submit (Next):** All fields validate, first error scrolls into view
- **On change:** After first invalid submission, field re-validates on each change (immediate feedback)

---

## 6. Desktop Layout

On desktop (≥768px), the wizard uses a centered panel (max-width 600px) with the same vertical flow. The mini token flow diagram is wider and more detailed. Advanced options use a two-column layout for metadata fields.

---

## 7. Accessibility

- Wizard has `role="dialog"` and `aria-modal="true"`
- Progress indicator has `role="progressbar"` with `aria-valuenow` (1-3)
- Each step is a labeled region with `aria-labelledby`
- Form fields have associated `<label>` elements
- Error messages use `aria-live="polite"` and `role="alert"`
- Back/Next buttons have `aria-label` with step context ("Back to recipient step")
- Keyboard navigation: Tab through fields, Enter submits current step
- Mini token flow diagram has text alternative: "Cliff period of 30 days, then vesting over 90 days, for a total of 120 days"
