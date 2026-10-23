# Notification & Error Message System

**Issue #821 — VestingDrips UI**

This document is the single source of truth for every user-visible notification, error, and confirmation in the VestingDrips frontend. It covers four distinct surface types, the VestingError code → message mapping table, and the copy-error-details feature.

---

## Design Principles

1. **No raw codes.** VestingError codes (1–27) and contract function names are never rendered to users.
2. **What + what next.** Every message states *what happened* and *what the user should do*.
3. **Calm, never alarming.** Tone is direct and helpful. Avoid "Error!" or "Fatal." as headlines.
4. **Accessible by default.** Severity is communicated through both colour and icon, never colour alone. ARIA roles are mandatory.
5. **Consistent tokens.** All colours, spacing, radius, and motion pull exclusively from `design-system/tokens/tokens.css`.

---

## 1. Toast Notifications

**File:** `design-system/components/toast.stories.tsx`  
**CSS classes:** `ds-toast-region`, `ds-toast`, `ds-toast--{variant}`

### Anatomy

```
┌──────────────────────────────────────────────── ×
│  ●  Title (semibold, 13→14px)
│     Message body (secondary, 13→14px)
│     [Copy error details]  [Retry]          ← error only
│ ▔▔▔ progress bar (top edge, auto-dismiss)
└────────────────────────────────────────────────
```

- Fixed to `bottom: 16px; right: 16px` (`.ds-toast-region`)
- Stacks vertically with `gap: 8px` when multiple toasts exist
- Max width 24 rem; text wraps, never truncates
- Slide-in from right on mount (`@keyframes ds-toast-in`, 250 ms)
- Slide-out to right on dismiss (`@keyframes ds-toast-out`, 150 ms)

### Variants

| Variant | Left border | Icon background | `role` | `aria-live` | Auto-dismiss |
|---------|-------------|-----------------|--------|-------------|--------------|
| `success` | `--color-success` (emerald-500) | emerald-900 dark / emerald-100 light | `status` | polite | **5 s** |
| `warning` | `--color-warning` (amber-500) | amber-900 / amber-100 | `alert` | assertive | **none** |
| `danger` | `--color-danger` (red-500) | red-900 / red-100 | `alert` | assertive | **none** |
| `info` | `--color-info` (blue-500) | blue-900 / blue-100 | `status` | polite | **5 s** |

> Warning and danger toasts persist until the user explicitly dismisses them. This prevents important information from disappearing before the user has read or acted on it.

### Copy Error Details (danger only)

Error toasts for contract failures surface a **Copy error details** button. Clicking it copies a JSON snippet to the clipboard:

```json
{
  "errorCode": 2,
  "errorName": "CliffNotReached",
  "timestamp": "2026-10-19T06:01:57.956Z",
  "contract": "VestingDrips"
}
```

A follow-up `info` toast ("Error details copied to clipboard") confirms the action. The clipboard write uses `navigator.clipboard.writeText`; no external service receives this data.

### Progress Bar

Success and info toasts render a 2 px progress bar along the top edge of the card (`ds-toast__progress`). The bar shrinks over the auto-dismiss duration via a CSS width animation. The bar is `aria-hidden="true"` because the dismiss is also announced via the ARIA live region.

### Storybook Stories

| Story | Description |
|-------|-------------|
| `AllVariants` | All four variants side by side |
| `SuccessToast` | Claim confirmed on-chain |
| `WarningToast` | Transaction pending |
| `ErrorToast` | Transfer failed with retry |
| `InfoToast` | Stream created |
| `CopyErrorDetails` | Full copy-error-details interaction |
| `ErrorWithErrorCode` | VestingError code 5 (DepositOverflow) mapped |
| `AutoDismiss` | Progress bar + 5 s timer |
| `InteractiveDismiss` | Live dismiss interaction with play() test |

---

## 2. Inline Field Errors

**File:** `design-system/components/inline-field-error.stories.tsx`  
**CSS class:** `ds-field-error`

### Anatomy

```
┌─────────────────────────────────────────────────┐
│  Recipient address                               │
│  ┌─────────────────────────────────────────────┐ │
│  │ not-a-valid-address                         │ │
│  └─────────────────────────────────────────────┘ │
│  ⊙  Enter a valid Stellar public key (G…).       │
└─────────────────────────────────────────────────┘
```

- Appears **below** the invalid input, never above it
- Colour: `--color-danger` (red-500)
- Font: caption scale (11→12 px)
- Animates in from above (`ds-field-error-in`, 150 ms, translateY −4 px → 0)

### Accessibility wiring (mandatory)

```html
<input
  id="recipient"
  aria-describedby="recipient-error"
  aria-invalid="true"
/>
<span id="recipient-error" class="ds-field-error" role="alert">
  <span class="ds-field-error__icon" aria-hidden="true">…</span>
  <span class="ds-field-error__text">Enter a valid Stellar public key (starts with G).</span>
</span>
```

- `aria-invalid="true"` on the input
- `aria-describedby` pointing at the error `id`
- `role="alert"` on the error element so screen readers announce it immediately on appearance
- The `<input>` gets the `.input--error` class (red border)

### Validation trigger

Errors appear **on blur** (not on every keystroke) to avoid interrupting the user mid-typing. Re-validation happens live after the first blur, so fixing the field clears the error immediately.

### Storybook Stories

| Story | Description |
|-------|-------------|
| `AllFieldErrors` | All four form fields in error state |
| `RecipientAddressError` | Sponsor == recipient guard |
| `RateTooLow` | Rate × duration below minimum deposit |
| `MetadataTooLong` | 260-character description (limit 256) |
| `LiveValidation` | Interactive blur-trigger demonstration |
| `MultipleErrors` | Two related fields in error simultaneously |

---

## 3. Banner Alerts

**File:** `design-system/components/banner-alert.stories.tsx`  
**CSS classes:** `ds-banner`, `ds-banner--{variant}`

### Anatomy

```
┌──────────────────────────────────────────────── [Action]  ×
│ ⚠️  Title (semibold)
│     Message body (90% opacity)
└────────────────────────────────────────────────────────────
```

- Full-width, sits at the **top of the page content area** (below the nav bar)
- Not fixed/sticky; scrolls with content unless the layout pins it
- `title` is optional; without it only the message is shown (inline style)

### Variants

| Variant | Background | Border | `role` | `aria-live` |
|---------|------------|--------|--------|-------------|
| `warning` | amber-900 (amber-50 light) | `--color-warning` | `status` | polite |
| `info` | blue-900 (blue-50 light) | `--color-info` | `status` | polite |
| `danger` | red-900 (red-50 light) | `--color-danger` | `alert` | assertive |

### When to use each variant

- **warning** — degraded service the user should know about but can still proceed (e.g. indexer lag, testnet mode)
- **info** — neutral announcements (planned maintenance, new feature callouts)
- **danger** — service is currently unavailable and the user cannot complete actions (RPC down, database unreachable)

### Dismissal

- Optional `onDismiss` prop renders the `×` button
- Once dismissed, the banner is removed from the DOM; no re-appearance on reload
- Danger banners should **not** be dismissable when the underlying condition is still active

### Storybook Stories

| Story | Description |
|-------|-------------|
| `AllVariants` | All three variants stacked |
| `IndexerLag` | Warning: indexer 5 min behind with "Refresh now" action |
| `MaintenanceInfo` | Info: planned Horizon maintenance |
| `RpcUnavailable` | Danger: Soroban RPC unreachable, no dismiss |
| `InteractiveDismiss` | Live dismiss + "Show again" toggle |
| `NoTitleVariant` | Inline message without title |

---

## 4. Destructive Action Confirmation Dialogs

**File:** `design-system/components/destructive-confirm-dialog.stories.tsx`  
**CSS classes:** `ds-modal-backdrop`, `ds-modal`, `ds-modal--danger`

### Anatomy

```
┌──────────────────────────────────────────────────┐
│  Cancel stream #3                                 │  ← title (red)
│  This action is permanent and cannot be undone.   │  ← subtitle
│                                                    │
│  Recipient: GAAA…AWHF                            │
│                                                    │
│  ⚠️  Cliff not yet reached. Full deposit …        │  ← optional warning
│                                                    │
│  Recipient receives    12 450 USDC                │
│  Sponsor refund        87 550 USDC                │
│                                                    │
│  Type CANCEL to confirm                           │
│  ┌────────────────────────────────────────────┐   │
│  │ CANCEL                                     │   │
│  └────────────────────────────────────────────┘   │
│                           [Go back]  [Cancel ×]   │
└──────────────────────────────────────────────────┘
```

### Safety rules

1. **Auto-focus goes to "Go back"**, not the destructive button. This means a hasty keyboard user won't accidentally confirm.
2. **Type-to-confirm gate** on cancel stream: the user must type `CANCEL` exactly. The destructive button is `disabled` until the text matches.
3. **Reason required** on clawback: a non-empty compliance reason (≤ 256 chars) must be provided. The reason is stored on-chain in the emitted event.
4. **Enter key is suppressed** on the destructive button to prevent accidental confirmation.
5. **Escape dismisses** via `onClick` on the backdrop (`e.target === e.currentTarget`).

### Pre-cliff vs post-cliff cancel

| State | Recipient receives | Sponsor refund | Warning shown |
|-------|--------------------|----------------|---------------|
| Cliff **reached** | Accrued tokens (green) | Remainder (blue) | No |
| Cliff **not reached** | 0 (text-disabled) | Full deposit (blue) | Yes: "Cliff not yet reached. The full deposit will be refunded to the sponsor." |

### Clawback

- Only available on tokens with the SAC clawback flag
- Bypasses cliff state — the full remaining balance returns to the sponsor
- Recipient receives 0 regardless of vested amount
- The compliance reason is mandatory (`aria-required="true"`) and stored on-chain

### Storybook Stories

| Story | Description |
|-------|-------------|
| `CancelStreamPostCliff` | Cancel after cliff — split payout |
| `CancelStreamPreCliff` | Cancel before cliff — full sponsor refund |
| `ClawbackStream` | Compliance clawback with reason textarea |
| `InteractiveCancelDialog` | Full open/confirm/close interaction |

---

## 5. VestingError Code → Message Mapping

**File:** `frontend/src/lib/errorMessages.ts`  
**Interface:** `ErrorInfo` (`title`, `explanation`, `action`, `category`, `retryable`, `faqUrl`, `i18nKey`)

All 27 codes are mapped. Unknown codes fall back to a generic "Something unexpected happened" entry via `getErrorInfo(code)`.

### Full table

| Code | Name | Severity | Title | Category | Retryable |
|------|------|----------|-------|----------|-----------|
| 1 | `ScheduleNotFound` | danger | No vesting stream found | auth | false |
| 2 | `CliffNotReached` | warning | Your cliff date hasn't arrived yet | auth | true |
| 3 | `InvalidDuration` | danger | The durations don't line up | contract | false |
| 4 | `InvalidRate` | danger | That rate won't work | contract | false |
| 5 | `DepositOverflow` | danger | That deposit is too large | contract | false |
| 6 | `ScheduleAlreadyExists` | danger | A stream already exists for this recipient | contract | false |
| 7 | `NothingToClaim` | info | You've already claimed all available tokens | contract | true |
| 8 | `StreamNotExpired` | warning | This stream hasn't finished yet | contract | true |
| 9 | `TransferFailed` | danger | The transfer failed | network | true |
| 10 | `DrainDelayNotExpired` | warning | It's too early to recover unclaimed tokens | contract | true |
| 11 | `InvalidRecipient` | danger | That recipient address won't work | auth | false |
| 12 | `InvalidCliffDuration` | danger | The cliff duration isn't valid | contract | false |
| 13 | `AlreadyInitialized` | info | This contract is already set up | contract | false |
| 14 | `RecipientNotAllowed` | danger | That recipient isn't allowed | auth | false |
| 15 | `StreamPaused` | warning | This stream is paused | contract | true |
| 16 | `BatchTooLarge` | danger | Too many streams in one go | contract | false |
| 17 | `RateTooLow` | danger | That rate is below the minimum | contract | false |
| 18 | `NotInitialized` | danger | This contract isn't ready yet | contract | false |
| 19 | `InvalidSegments` | danger | The rate segments aren't valid | contract | false |
| 20 | `MetadataTooLong` | danger | That description is too long | contract | false |
| 21 | `Unauthorized` | danger | You're not allowed to do that | auth | false |
| 22 | `DepositBelowMinimum` | danger | The deposit is below the minimum | contract | false |
| 23 | `StreamAlreadyPaused` | info | This stream is already paused | contract | false |
| 24 | `StreamNotPaused` | info | This stream isn't paused | contract | false |
| 25 | `VersionOverflow` | danger | The stream has reached its version limit | unexpected | false |
| 26 | `ClawbackNotSupported` | danger | This token doesn't support clawback | contract | false |
| 27 | `InvalidToken` | danger | That token address isn't valid | contract | false |

> **Severity → toast variant mapping:** `danger` errors use the `danger` toast; `warning` errors use the `warning` toast; `info` errors use the `info` toast. Success is reserved for successful outcomes (claim confirmed, stream created).

### Dynamic interpolation

`getErrorMessage(code, values)` supports dynamic values for two codes:

- **Code 2 (`CliffNotReached`)** — pass `{ date: "12 Mar 2026" }` to produce "Your cliff date hasn't arrived yet. Tokens will unlock on 12 Mar 2026."
- **Code 1 (`ScheduleNotFound`)** — pass `{ address: "GAAA…" }` to include the address in the message.

### i18n

Each entry carries an `i18nKey` (`errors.codes.{Name}`) for future localisation. The key structure matches `frontend/public/locales/en/` namespace files. Add translated strings under the same key in `es/`, `pt/`, `zh/` to enable localisation without changing this file.

---

## 6. Copy Error Details

The copy-error-details feature appears on `danger` toasts when a VestingError code is present. It is the primary support-triage tool for on-chain failures.

### Copied payload

```ts
interface CopiedErrorDetails {
  errorCode: number;       // e.g. 2
  errorName: string;       // e.g. "CliffNotReached"
  timestamp: string;       // ISO 8601, e.g. "2026-10-19T06:01:57.956Z"
  contract: string;        // always "VestingDrips"
}
```

### UX flow

1. Transaction fails → error toast appears with "Copy error details" button and optional "Retry" button.
2. User clicks "Copy error details".
3. `navigator.clipboard.writeText(JSON.stringify(details, null, 2))` is called.
4. A follow-up `info` toast appears: "Error details copied to clipboard. Paste into a support message to help diagnose the issue."
5. The info toast auto-dismisses after 5 s.

### No external calls

The clipboard write is local. No data is sent to a third-party service. The payload does not include wallet addresses or private keys.

---

## 7. Design Token Reference

All notification components consume these tokens from `design-system/tokens/tokens.css`:

| Token | Value | Usage |
|-------|-------|-------|
| `--color-success` | `#10B981` (emerald-500) | Success toast border, progress bar |
| `--color-warning` | `#F59E0B` (amber-500) | Warning toast/banner border |
| `--color-danger` | `--color-error-500` = `#EF4444` | Error toast border, field error text, dialog accent |
| `--color-info` | `#3B82F6` (blue-500) | Info toast border |
| `--color-success-900/100` | dark/light bg for icon | Toast icon badge |
| `--radius-base` | `0.5rem` | Toast, banner, dialog corners |
| `--shadow-xl` | elevation | Toast, dialog |
| `--transition-fast` | `150ms ease` | Dismiss animation, field error entrance |
| `--transition-base` | `250ms ease` | Toast slide-in |
| `--font-size-label` | clamp(13→14px) | Toast text, banner text |
| `--font-size-caption` | clamp(11→12px) | Field error, toast actions, dialog metadata |

---

## 8. Accessibility Checklist

- [ ] Toast region uses `aria-live="polite"` (status) or `"assertive"` (alert) per variant
- [ ] Field errors use `role="alert"` and are wired via `aria-describedby` + `aria-invalid`
- [ ] Banner uses `role="alert"` (danger) or `role="status"` (warning, info)
- [ ] Dialog uses `role="dialog"`, `aria-modal="true"`, `aria-labelledby`
- [ ] "Go back" button receives `autoFocus` in all confirmation dialogs
- [ ] All icon-only buttons have `aria-label`
- [ ] Colour is never the sole indicator of state (icons present on all variants)
- [ ] Minimum touch target `44×44 px` on all interactive elements

---

## 9. File Map

| Purpose | File |
|---------|------|
| Design tokens | `design-system/tokens/tokens.css` |
| Component CSS | `design-system/components/components.css` |
| Toast stories | `design-system/components/toast.stories.tsx` |
| Banner alert stories | `design-system/components/banner-alert.stories.tsx` |
| Inline field error stories | `design-system/components/inline-field-error.stories.tsx` |
| Confirmation dialog stories | `design-system/components/destructive-confirm-dialog.stories.tsx` |
| Error code → message map | `frontend/src/lib/errorMessages.ts` |
| This spec | `docs/design/notification-system.md` |
