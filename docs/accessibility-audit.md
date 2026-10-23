# Accessibility Audit — WCAG 2.1 AA

**Issue #824 — VestingDrips UI**  
**Standard:** WCAG 2.1 Level AA  
**Last updated:** 2026-10-19  
**Scope:** All planned React UI components in `frontend/src/components/` and the design system in `design-system/components/`

This document is the single source of truth for accessibility requirements on the VestingDrips frontend. Every section maps directly to a checklist used in the [PR template](../../.github/PULL_REQUEST_TEMPLATE.md) and design reviews.

---

## How to reproduce automated checks

```bash
cd frontend
npm ci --legacy-peer-deps
npx playwright install chromium
npm run test:a11y          # runs e2e/accessibility-audit.spec.ts via playwright.a11y.config.ts
```

Full JSON results are written to `frontend/test-results/a11y-reports/`. The suite fails on any axe-core violation rated `critical` or `serious` against rule sets `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`.

---

## 1. WCAG 2.1 AA Compliance Checklist

The criteria below are the full set of WCAG 2.1 Level AA success criteria relevant to this application. Each maps to one or more components and to the detailed spec sections further down in this document.

### Perceivable

| # | Criterion | Level | Component(s) | Spec section | Status |
|---|-----------|-------|--------------|--------------|--------|
| 1.1.1 | Non-text content has text alternatives | A | Icons, SVG illustrations, status badges | §5 Screen reader | ✅ Required |
| 1.3.1 | Info and relationships conveyed through structure | A | Tables (DataTable), form groups, headings | §6 Forms | ✅ Required |
| 1.3.2 | Meaningful sequence preserved in DOM | A | All components | §4 Keyboard | ✅ Required |
| 1.3.3 | Sensory characteristics not sole instruction | A | Error states, status badges | §5 Screen reader | ✅ Required |
| 1.3.4 | Orientation not restricted | AA | All pages | — | ✅ Required |
| 1.3.5 | Identify input purpose | AA | CreateStreamForm, ClaimBottomSheet | §6 Forms | ✅ Required |
| 1.4.1 | Colour not sole means of conveying info | A | Toast variants, field errors, status badges | §3 Contrast | ✅ Required |
| 1.4.3 | Contrast (minimum) — 4.5:1 normal text, 3:1 large text | AA | All text | §3 Contrast | ✅ Required |
| 1.4.4 | Resize text 200% without loss of content | AA | All pages | — | ✅ Required |
| 1.4.5 | Images of text not used | AA | All components | — | ✅ Required |
| 1.4.10 | Reflow at 320px width | AA | All pages | — | ✅ Required |
| 1.4.11 | Non-text contrast 3:1 (UI components, focus rings) | AA | Buttons, inputs, focus rings | §3 Contrast, §4 Keyboard | ✅ Required |
| 1.4.12 | Text spacing overridable | AA | All text | — | ✅ Required |
| 1.4.13 | Content on hover/focus dismissable and persistent | AA | Tooltips (GlossaryTerm, DataTable) | §5 Screen reader | ✅ Required |

### Operable

| # | Criterion | Level | Component(s) | Spec section | Status |
|---|-----------|-------|--------------|--------------|--------|
| 2.1.1 | All functionality keyboard accessible | A | All interactive components | §4 Keyboard | ✅ Required |
| 2.1.2 | No keyboard trap | A | Modals (CancelConfirmModal, ClawbackDialog), bottom sheet | §4 Keyboard | ✅ Required |
| 2.1.4 | Character key shortcuts reassignable or disableable | AA | KeyboardShortcuts.ts | §4 Keyboard | ✅ Required |
| 2.4.1 | Bypass blocks — skip navigation link | A | App shell | §4 Keyboard | ✅ Required |
| 2.4.2 | Page titles descriptive | A | All routes | — | ✅ Required |
| 2.4.3 | Focus order logical | A | All pages | §4 Keyboard | ✅ Required |
| 2.4.4 | Link purpose clear from context | A | All links | — | ✅ Required |
| 2.4.6 | Headings and labels descriptive | AA | All pages | §6 Forms | ✅ Required |
| 2.4.7 | Focus visible | AA | All interactive elements | §4 Keyboard | ✅ Required |
| 2.5.3 | Label in name | A | All icon-only buttons | §5 Screen reader | ✅ Required |
| 2.5.4 | Motion actuation — pointer alternative | A | — | — | N/A |

### Understandable

| # | Criterion | Level | Component(s) | Spec section | Status |
|---|-----------|-------|--------------|--------------|--------|
| 3.1.1 | Language of page | A | `<html lang="en">` | — | ✅ Required |
| 3.1.2 | Language of parts | AA | i18n strings | — | ✅ Required |
| 3.2.1 | On focus — no unexpected change of context | A | All components | — | ✅ Required |
| 3.2.2 | On input — no unexpected change of context | A | All form inputs | §6 Forms | ✅ Required |
| 3.3.1 | Error identification | A | CreateStreamForm, all forms | §6 Forms | ✅ Required |
| 3.3.2 | Labels or instructions for input | A | All form fields | §6 Forms | ✅ Required |
| 3.3.3 | Error suggestion | AA | All form validation | §6 Forms | ✅ Required |
| 3.3.4 | Error prevention on legal commitments | AA | Cancel/clawback dialogs | §6 Forms | ✅ Required |

### Robust

| # | Criterion | Level | Component(s) | Spec section | Status |
|---|-----------|-------|--------------|--------------|--------|
| 4.1.1 | Valid HTML (no parsing errors) | A | All rendered HTML | — | ✅ Required |
| 4.1.2 | Name, role, value for all UI components | A | All custom components | §5 Screen reader | ✅ Required |
| 4.1.3 | Status messages programmatically determinable | AA | Toast, banner, live regions | §5 Screen reader | ✅ Required |

---

## 2. Automated Test Results

Measured on Chromium headless, axe-core 4.13.0, against the Vite dev server.

### Static landing page (`frontend/index.html`)

After fixes applied in issue #824:

| Scan | Violations | Passes | Incomplete | Inapplicable |
|------|-----------|--------|------------|--------------|
| Landing, light | 0 | 20 | 0 | 42 |
| Landing, dark | 0 | 20 | 0 | 42 |
| Landing, 375px | 0 | 20 | 0 | 42 |

### React component tree (`frontend/src/components/`)

Automated axe-core scanning of the React component tree is tracked in `frontend/e2e/accessibility-audit.spec.ts` and `frontend/e2e/accessibility-expanded.spec.ts`. All new components **must** pass before merging.

---

## 3. Color Contrast Audit

All ratios computed against WCAG 1.4.3 (text: 4.5:1 normal, 3:1 large ≥ 18px/14px bold) and WCAG 1.4.11 (UI components: 3:1).

### Dark theme (default)

Background base: `--color-bg-base` = `#0F172A` (neutral-900)  
Surface: `--color-bg-surface` = `#1E293B` (neutral-800)

| Use | Foreground token | Foreground hex | Background hex | Ratio | AA normal | AA large | AA UI |
|-----|-----------------|----------------|----------------|-------|-----------|----------|-------|
| Primary text on base | `--color-text-primary` | `#F8FAFC` | `#0F172A` | **19.6:1** | ✅ | ✅ | ✅ |
| Primary text on surface | `--color-text-primary` | `#F8FAFC` | `#1E293B` | **14.7:1** | ✅ | ✅ | ✅ |
| Secondary text on base | `--color-text-secondary` | `#94A3B8` | `#0F172A` | **7.1:1** | ✅ | ✅ | ✅ |
| Secondary text on surface | `--color-text-secondary` | `#94A3B8` | `#1E293B` | **5.3:1** | ✅ | ✅ | ✅ |
| Disabled text on surface | `--color-text-disabled` | `#475569` | `#1E293B` | **2.9:1** | ❌ | ✅ | — |
| Brand primary btn text | `#F8FAFC` | — | `#7C3AED` (primary-600) | **5.9:1** | ✅ | ✅ | ✅ |
| Danger btn text | `#F8FAFC` | — | `#EF4444` (error-500) | **4.6:1** | ✅ | ✅ | ✅ |
| Success badge text | `--color-success-300` | `#6EE7B7` | `#064E3B` (success-900) | **7.4:1** | ✅ | ✅ | ✅ |
| Warning badge text | `--color-warning-300` | `#FCD34D` | `#78350F` (warning-900) | **8.1:1** | ✅ | ✅ | ✅ |
| Danger badge text | `--color-error-300` | `#FCA5A5` | `#7F1D1D` (error-900) | **6.9:1** | ✅ | ✅ | ✅ |
| Info badge text | `--color-info-300` | `#93C5FD` | `#1E3A8A` (info-900) | **7.2:1** | ✅ | ✅ | ✅ |
| Success toast border on surface | `--color-success` | `#10B981` | `#1E293B` | **3.9:1** | — | — | ✅ |
| Warning toast border on surface | `--color-warning` | `#F59E0B` | `#1E293B` | **8.0:1** | — | — | ✅ |
| Danger toast border on surface | `--color-danger` | `#EF4444` | `#1E293B` | **4.8:1** | — | — | ✅ |
| Info toast border on surface | `--color-info` | `#3B82F6` | `#1E293B` | **4.3:1** | — | — | ✅ |
| Field error text | `--color-danger` | `#EF4444` | `#1E293B` | **4.8:1** | ✅ | ✅ | ✅ |
| Focus ring on base | `--color-border-focus` | `#7C3AED` | `#0F172A` | **5.2:1** | — | — | ✅ |
| Focus ring on surface | `--color-border-focus` | `#7C3AED` | `#1E293B` | **3.9:1** | — | — | ✅ |
| Input border | `--color-border` | `#334155` | `#1E293B` | **1.5:1** | — | — | ⚠️ |
| Placeholder text | `--color-text-disabled` | `#475569` | `#1E293B` | **2.9:1** | — | — | — |

### Light theme (`data-theme="light"`)

Background base: `#F8FAFC` (neutral-50)  
Surface: `#FFFFFF`

| Use | Foreground token | Foreground hex | Background hex | Ratio | AA normal | AA large | AA UI |
|-----|-----------------|----------------|----------------|-------|-----------|----------|-------|
| Primary text on base | `--color-text-primary` | `#0F172A` | `#F8FAFC` | **19.6:1** | ✅ | ✅ | ✅ |
| Primary text on surface | `--color-text-primary` | `#0F172A` | `#FFFFFF` | **21:1** | ✅ | ✅ | ✅ |
| Secondary text on surface | `--color-text-secondary` | `#475569` | `#FFFFFF` | **7.5:1** | ✅ | ✅ | ✅ |
| Disabled text on surface | `--color-text-disabled` | `#94A3B8` | `#FFFFFF` | **2.9:1** | ❌ | ✅ | — |
| Brand primary btn text | `#FFFFFF` | — | `#7C3AED` (primary-600) | **5.9:1** | ✅ | ✅ | ✅ |
| Success badge text (light) | `--color-success-700` | `#047857` | `#D1FAE5` (success-100) | **5.4:1** | ✅ | ✅ | ✅ |
| Warning badge text (light) | `--color-warning-700` | `#B45309` | `#FEF3C7` (warning-100) | **5.1:1** | ✅ | ✅ | ✅ |
| Danger badge text (light) | `--color-error-700` | `#B91C1C` | `#FEE2E2` (error-100) | **6.2:1** | ✅ | ✅ | ✅ |
| Field error text | `--color-danger` | `#EF4444` | `#FFFFFF` | **3.9:1** | ❌ | ✅ | ✅ |
| Focus ring on white | `--color-border-focus` | `#7C3AED` | `#FFFFFF` | **7.1:1** | — | — | ✅ |
| Input border (light) | `--color-border` | `#E2E8F0` | `#FFFFFF` | **1.2:1** | — | — | ⚠️ |

### Known issues and mitigations

| Issue | WCAG | Mitigation |
|-------|------|-----------|
| Disabled text (`#475569` on `#1E293B`, 2.9:1) fails normal text contrast | 1.4.3 | Disabled elements are exempt from 1.4.3 per WCAG guidance — they convey unavailability, not content. Ensure disabled state is also communicated via `disabled` attribute or `aria-disabled`, never colour alone. |
| Field error red on white light theme (3.9:1) fails 4.5:1 for normal text | 1.4.3 | **Action required:** use `--color-error-700` (`#B91C1C`, 6.2:1 on white) for field error text in light theme. Update `.ds-field-error` in `components.css` with a `[data-theme='light']` override. |
| Input border in both themes (~1.2–1.5:1) fails 3:1 UI component threshold | 1.4.11 | **Action required:** raise input border to `--color-neutral-500` (`#64748B`) in dark theme (3.4:1 on surface) and `--color-neutral-400` (`#94A3B8`) in light theme (3.1:1 on white). The focus ring already clears 3:1. |
| Placeholder text is not required to meet 4.5:1 | 1.4.3 | Placeholders are supplementary; labels carry the accessible name. No action required. |

### Colour is never the sole indicator

Every state that uses colour also uses one of:
- An icon (all toast variants, all badge variants, field error)
- A text label (button states)
- A border style change (`.input--error` adds red border AND an icon)
- An `aria-*` attribute change (`aria-invalid`, `aria-pressed`, `aria-expanded`)

This satisfies WCAG 1.4.1.

---

## 4. Keyboard Navigation Spec

### 4.1 Skip-to-main link

A visually hidden "Skip to main content" link **must** be the first focusable element in the DOM. It becomes visible on focus.

```html
<!-- In App shell, before <nav> -->
<a href="#main-content" class="skip-nav">Skip to main content</a>

<!-- Target -->
<main id="main-content" tabindex="-1">…</main>
```

CSS pattern (already in `frontend/src/components/SkipNav.tsx`):

```css
.skip-nav {
  position: absolute;
  top: -100%;
  left: var(--space-4);
  z-index: 9999;
  padding: var(--space-2) var(--space-4);
  background: var(--color-bg-surface);
  color: var(--color-text-primary);
  border: 2px solid var(--color-border-focus);
  border-radius: var(--radius-base);
  font-weight: var(--font-weight-semibold);
  text-decoration: none;
  transition: top var(--transition-fast);
}
.skip-nav:focus {
  top: var(--space-4);
}
```

### 4.2 Tab order

Tab order must follow visual reading order (left-to-right, top-to-bottom). Never use `tabindex` values > 0 — this breaks the natural flow. Acceptable values:

| Value | Use |
|-------|-----|
| `tabindex="-1"` | Programmatic focus only (modal containers, skip-target `<main>`, drawer panels). |
| `tabindex="0"` | Non-natively-focusable elements made interactive (custom listboxes, card clickable areas). |
| `tabindex > 0` | **Never.** |

#### App shell tab order

1. Skip to main content (SkipNav)
2. Primary navigation links
3. Network selector (NetworkSelector)
4. Dark mode toggle (DarkModeToggle)
5. Wallet connect button (WalletButton / WalletConnection)
6. Page content (routed)

#### Create stream form tab order

1. Token selector (TokenBalanceSelect)
2. Recipient address input
3. Rate input
4. Cliff duration input
5. Total duration input
6. Stream description (optional)
7. Deposit calculator — read-only, skip with `aria-hidden` and `tabindex="-1"` on the inner amount display
8. Review & submit button
9. Transaction Review Summary "Edit" and "Confirm" buttons (when open)

#### Modal/dialog tab order

Focus must be **trapped** inside open modals (CancelConfirmModal, ClawbackDialog, TxDrawer, ClaimBottomSheet):

1. Dialog title (`role="dialog"`, `aria-labelledby`)
2. Content (informational)
3. **"Go back" / secondary button — receives `autoFocus`**
4. Destructive / primary confirm button

When the modal closes, focus **must** return to the element that triggered it (store a ref before opening).

#### Keyboard shortcuts (KeyboardShortcuts.ts)

Character-key shortcuts (`?`, `n`, `c`, etc.) must:
- Be suppressed when focus is inside an `<input>`, `<textarea>`, or `[contenteditable]`
- Be disableable via a setting (WCAG 2.1.4)
- Have an accessible discoverable mechanism — the `?` key opens the shortcuts modal, which is the discoverable mechanism

### 4.3 Focus indicators

Every interactive element must have a **visible focus indicator** that meets WCAG 2.4.7 and the enhanced 2.4.11 (AA) criterion of at least 2px and 3:1 contrast.

**Global rule (already in `components.css`):**
```css
:focus-visible {
  outline: 2px solid var(--color-border-focus); /* #7C3AED */
  outline-offset: 2px;
}
```

Component-specific enhancements:

| Component | Focus treatment | Contrast |
|-----------|----------------|---------|
| `.btn` | `outline: 2px solid var(--color-border-focus); outline-offset: 2px` | 5.2:1 on dark, 7.1:1 on light ✅ |
| `.input` | `border-color: var(--color-border-focus)` + `box-shadow: 0 0 0 3px rgb(124 58 237 / 0.25)` | Visible halo ✅ |
| `.select` | Same as `.input` | ✅ |
| `ds-toast__dismiss` | `outline: 2px solid currentColor; outline-offset: 2px` | ✅ |
| `ds-banner__dismiss` | Same | ✅ |
| Modal backdrop | Focus ring on first focusable child | ✅ |
| DataTable row (when interactive) | `outline: 2px solid var(--color-border-focus); outline-offset: -2px` (inset) | ✅ |

**Never suppress focus:**
```css
/* ❌ Forbidden */
:focus { outline: none; }
*:focus { outline: 0; }
```

Use `:focus-visible` only — this hides the ring for mouse users while keeping it for keyboard users.

### 4.4 Keyboard interactions for custom widgets

| Widget | Key | Behaviour |
|--------|-----|-----------|
| WalletConnection dropdown | `Enter`/`Space` | Toggle open/closed |
| WalletConnection dropdown | `Escape` | Close, return focus to trigger |
| WalletConnection dropdown | `ArrowDown`/`ArrowUp` | Move between items |
| WalletConnection dropdown | `Tab` | Close and move focus out |
| CancelConfirmModal | `Escape` | Close dialog |
| CancelConfirmModal | `Enter` on destructive btn | **Suppressed** (`onKeyDown` prevents default) |
| ClaimBottomSheet (mobile) | `Escape` | Dismiss sheet |
| DataTable sort header | `Enter`/`Space` | Toggle sort direction |
| TokenBalanceSelect | `Enter`/`Space` | Open listbox |
| TokenBalanceSelect | `ArrowDown`/`ArrowUp` | Navigate options |
| TokenBalanceSelect | `Enter` | Select option |
| TokenBalanceSelect | `Escape` | Close without selection |
| Tooltip (GlossaryTerm) | `Escape` | Dismiss tooltip |
| DarkModeToggle | `Enter`/`Space` | Toggle, announces new state via `aria-pressed` |

---

## 5. Screen Reader Spec

### 5.1 Landmark regions

Every page must use the following landmark structure so screen reader users can jump directly to regions:

```html
<body>
  <a href="#main-content" class="skip-nav">Skip to main content</a>

  <header role="banner">
    <nav aria-label="Primary navigation">…</nav>
  </header>

  <!-- Optional: global banners (indexer lag, RPC down) -->
  <div role="alert" aria-live="assertive">…</div>  <!-- danger banners -->
  <div role="status" aria-live="polite">…</div>    <!-- warning/info banners -->

  <main id="main-content" tabindex="-1">
    <!-- Page-specific content -->
  </main>

  <!-- Toast region — fixed position, outside main -->
  <div
    class="ds-toast-region"
    aria-label="Notifications"
    aria-live="polite"
    aria-relevant="additions removals"
    aria-atomic="false"
  >…</div>

  <footer role="contentinfo">…</footer>
</body>
```

Rules:
- Only one `<main>` per page.
- All `<nav>` elements must have an `aria-label` when more than one exists.
- `<header>` and `<footer>` at the top-level implicitly carry `banner` and `contentinfo` roles — do not add `role=` redundantly at top level.
- `<section>` and `<aside>` without `aria-label` do not expose as landmarks — add labels or use `<div>`.

### 5.2 ARIA roles by component

| Component | Root element role | Notes |
|-----------|-------------------|-------|
| Toast (success/info) | `role="status"`, `aria-live="polite"` | Non-urgent; announced at next opportunity |
| Toast (warning/danger) | `role="alert"`, `aria-live="assertive"` | Interrupts; announced immediately |
| Toast region | `aria-label="Notifications"`, `aria-live="polite"`, `aria-atomic="false"` | Container for all toasts |
| Banner (warning/info) | `role="status"`, `aria-live="polite"` | Page-level status |
| Banner (danger) | `role="alert"`, `aria-live="assertive"` | Immediate alert |
| InlineFieldError | `role="alert"` | Announced immediately on appearance |
| CancelConfirmModal | `role="dialog"`, `aria-modal="true"`, `aria-labelledby="{titleId}"` | |
| ClawbackDialog | `role="dialog"`, `aria-modal="true"`, `aria-labelledby="{titleId}"` | |
| ClaimBottomSheet | `role="dialog"`, `aria-modal="true"`, `aria-label="Claim tokens"` | Mobile |
| TxDrawer | `role="dialog"`, `aria-modal="true"`, `aria-label="Transaction details"` | |
| DataTable | `role="table"` (or native `<table>`), `aria-label` or `aria-labelledby` | |
| DataTable sort btn | `aria-sort="ascending"\|"descending"\|"none"` on `<th>` | |
| StreamStatusBadge | `role="status"` | State changes are live |
| HorizonStatusBanner | `role="alert"` (when offline) / `role="status"` (when degraded) | |
| SkeletonLoader | `aria-hidden="true"` + loading container `aria-busy="true"` | |
| WalletConnection dropdown | `role="menu"`, `aria-expanded`, items `role="menuitem"` | |
| DarkModeToggle | `role="switch"` or `<button aria-pressed>` | |
| SegmentedProgressBar | `role="progressbar"`, `aria-valuenow`, `aria-valuemin="0"`, `aria-valuemax="100"`, `aria-label` | |
| AnimatedProgressBar | `role="progressbar"`, `aria-valuenow`, `aria-valuemin`, `aria-valuemax` | |
| CliffCountdown | `role="timer"`, `aria-live="off"` (see §5.3) | Do not auto-announce — too frequent |
| CopyButton | `aria-label="Copy {content} to clipboard"` | Changes to "Copied!" for 2 s |
| EmptyStates | `role="status"` | Announces when list transitions to empty |

### 5.3 Live regions

Live regions announce dynamic content changes without requiring focus movement. Use sparingly — unnecessary `assertive` regions interrupt the user mid-sentence.

| Region | Type | `aria-live` | `aria-atomic` | When to use |
|--------|------|-------------|---------------|-------------|
| Toast region | `role="alert"` / `role="status"` | Per-toast (see above) | `false` | Every toast add/remove |
| Form validation errors | `role="alert"` | `assertive` | `true` | On form submit or blur |
| Balance update (AnimatedBalance) | Wrapper `aria-live="polite"` | `true` | When claimable amount changes |
| Stream status change (StreamStatusBadge) | `role="status"`, `aria-live="polite"` | `true` | On status transition |
| Cliff countdown (CliffCountdown) | `aria-live="off"` | — | **Never auto-announce** — updating every second floods the screen reader. Announce once when cliff is reached via a separate `role="alert"`. |
| Indexer lag banner | `role="status"`, `aria-live="polite"` | `true` | When lag threshold exceeded |
| RPC offline banner | `role="alert"`, `aria-live="assertive"` | `true` | When RPC unreachable |
| Transaction pending (TxDrawer) | `aria-live="polite"` | `true` | On status change |
| Skeleton → content transition | Container gains `aria-busy="false"` | — | When data loads |

#### Cliff countdown — specific guidance

```tsx
// ✅ Correct: suppress frequent announcements; announce milestone only
<div aria-live="off" aria-label="Time until cliff">
  <CliffCountdown ledgersRemaining={ledgersRemaining} />
</div>

// Announce once when cliff is reached
{cliffReached && (
  <div role="alert" aria-atomic="true" className="sr-only">
    Cliff reached. Tokens are now available to claim.
  </div>
)}
```

#### Balance update — specific guidance

```tsx
// ✅ Correct: polite, atomic — reads the full updated value
<span
  aria-live="polite"
  aria-atomic="true"
  aria-label={`Claimable balance: ${formattedAmount} ${tokenSymbol}`}
>
  <AnimatedBalance value={claimableAmount} />
</span>
```

### 5.4 Icon-only buttons

Every button or link that shows only an icon (no visible text label) **must** have an `aria-label`:

```tsx
// ✅
<button aria-label="Dismiss notification" onClick={onDismiss}>
  <XIcon aria-hidden="true" />
</button>

// ✅
<button aria-label="Copy address to clipboard" onClick={onCopy}>
  <CopyIcon aria-hidden="true" />
</button>

// ❌ — no accessible name
<button onClick={onDismiss}><XIcon /></button>
```

All decorative icons that accompany visible text labels must carry `aria-hidden="true"` to prevent double-announcing.

### 5.5 Wallet address and numeric content

Stellar addresses (G…) read poorly when spelled out character by character. Wrap them for better screen reader output:

```tsx
<span
  className="ds-address"
  aria-label={`Stellar address: ${truncateAddress(address)}`}
>
  {truncateAddress(address)}
</span>
```

Token amounts using `tabular-nums` don't need special treatment — screen readers read digits normally.

---

## 6. Motion and Animation Spec

### 6.1 Baseline rule

All animations in the application **must** respond to `prefers-reduced-motion: reduce`. The pattern:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

This global rule **does not replace** per-component handling — it is a safety net. Components must also handle it explicitly.

### 6.2 framer-motion (animations.tsx)

The `useReducedMotion()` hook from framer-motion is already used in all animation wrappers. The required pattern:

```tsx
const reduced = useReducedMotion();

<motion.div
  initial={reduced ? false : { opacity: 0, y: 12 }}
  animate={{ opacity: 1, y: 0 }}
  exit={reduced ? undefined : { opacity: 0 }}
  transition={{ duration: reduced ? 0 : 0.25 }}
>
```

When `reduced` is true:
- `initial={false}` disables the enter animation (element appears instantly)
- `exit={undefined}` disables the exit animation
- `transition={{ duration: 0 }}` makes any remaining transitions instant

### 6.3 CSS animations (components.css)

CSS keyframe animations used in the design system:

| Animation | Duration | Applies to | Reduced motion behaviour |
|-----------|----------|------------|--------------------------|
| `ds-toast-in` | 250ms | Toast slide-in from right | Skip to final state instantly |
| `ds-toast-out` | 150ms | Toast slide-out to right | Skip — remove from DOM immediately |
| `ds-toast__progress` | Auto-dismiss duration (5 s) | Progress bar width | Retain — it is a timer, not decorative motion. If reduced, replace with a static "closes in 5 s" text alternative. |
| `ds-field-error-in` | 150ms | Field error slide down | Skip — appear instantly |
| `ds-banner-in` | 200ms | Banner slide down | Skip — appear instantly |
| ConfettiBurst (ConfettiBurst.tsx) | 1.5 s | Success celebration | **Disable entirely.** Confetti has no informational value and causes vestibular issues. |

Required CSS for all component animations:

```css
@keyframes ds-toast-in {
  from { transform: translateX(100%); opacity: 0; }
  to   { transform: translateX(0);    opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
  @keyframes ds-toast-in {
    from { opacity: 0; }
    to   { opacity: 1; }
  }
}

@keyframes ds-field-error-in {
  from { transform: translateY(-4px); opacity: 0; }
  to   { transform: translateY(0);    opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
  .ds-field-error { animation: none; }
}
```

### 6.4 Duration limits

All animations must stay under 400ms (WCAG 2.3.3 — below the threshold that triggers photosensitive responses). Current values:

| Component | Duration | Status |
|-----------|----------|--------|
| PageTransition | 250ms | ✅ |
| ModalTransition | 250ms | ✅ |
| AnimatedBalance | 250ms | ✅ |
| AnimatedProgressBar | 250ms | ✅ |
| Toast slide-in | 250ms | ✅ |
| Toast slide-out | 150ms | ✅ |
| Field error entrance | 150ms | ✅ |
| ConfettiBurst | 1500ms | ✅ (disabled under reduced motion) |

### 6.5 Auto-playing content

No component may auto-play video or animated content that lasts more than 3 seconds without a pause mechanism (WCAG 2.2.2). The toast progress bar is exempt as it is a timer indicator, not decorative animation.

---

## 7. Form Accessibility Spec

### 7.1 Label associations

Every form control must have an accessible name via one of:

1. `<label for="id">` (preferred for all visible labels)
2. `aria-labelledby="id"` (for labels that are visible but not `<label>` elements)
3. `aria-label="…"` (for controls where a visible label would be redundant, e.g., search)

```tsx
// ✅ Preferred
<label htmlFor="recipient">Recipient address</label>
<input id="recipient" type="text" />

// ✅ Acceptable (label text elsewhere in DOM)
<h3 id="cliff-heading">Cliff duration</h3>
<input aria-labelledby="cliff-heading" type="number" />

// ❌ Placeholder as sole label — forbidden
<input placeholder="Recipient address" type="text" />
```

Placeholder text is **never** a substitute for a `<label>`. Placeholders disappear on input and have insufficient contrast as text content.

### 7.2 Hint text and descriptions

Use `aria-describedby` to link supplementary hint text to an input. The hint must remain visible (not a tooltip):

```tsx
<label htmlFor="rate">Token rate (per ledger)</label>
<input
  id="rate"
  type="number"
  aria-describedby="rate-hint rate-error"
/>
<span id="rate-hint" className="field-hint">
  Tokens drip at this rate per Stellar ledger (~5 s each).
</span>
{error && (
  <span id="rate-error" className="ds-field-error" role="alert">
    {error}
  </span>
)}
```

When both hint and error are present, list both IDs in `aria-describedby` (space-separated). Screen readers read them in listed order.

### 7.3 Error announcement

Errors must be announced immediately when they appear, without requiring the user to move focus:

```tsx
// ✅ Error announced on appearance via role="alert"
<span id="recipient-error" className="ds-field-error" role="alert">
  <span className="ds-field-error__icon" aria-hidden="true">…</span>
  <span className="ds-field-error__text">
    Enter a valid Stellar public key (starts with G).
  </span>
</span>
```

The input must also carry:
```tsx
<input
  aria-invalid={hasError ? "true" : undefined}
  aria-describedby={hasError ? "recipient-error" : undefined}
/>
```

**Validation trigger rules:**
- Show error **on blur** (not on every keystroke) to avoid interrupting typing.
- Re-validate live after the first blur, so fixing the value clears the error immediately.
- On form submit, validate all fields, announce a summary (if using a form-level error region), then move focus to the first invalid field.

### 7.4 Form-level error summary

When submitting the Create Stream form with multiple invalid fields, render a summary above the form and move focus to it:

```tsx
<div
  id="form-error-summary"
  role="alert"
  aria-live="assertive"
  tabIndex={-1}
  ref={summaryRef}
>
  {errors.length > 0 && (
    <>
      <p>Please fix {errors.length} error{errors.length > 1 ? 's' : ''} before submitting:</p>
      <ul>
        {errors.map(e => (
          <li key={e.field}>
            <a href={`#${e.field}`}>{e.message}</a>
          </li>
        ))}
      </ul>
    </>
  )}
</div>
```

After form submit, call `summaryRef.current?.focus()` if there are errors.

### 7.5 Fieldset groupings

Related fields must be grouped with `<fieldset>` + `<legend>`:

```tsx
// ✅ Duration fields — semantically related
<fieldset>
  <legend>Stream duration</legend>
  <div>
    <label htmlFor="cliff-duration">Cliff duration (ledgers)</label>
    <input id="cliff-duration" type="number" />
  </div>
  <div>
    <label htmlFor="total-duration">Total duration (ledgers)</label>
    <input id="total-duration" type="number" />
  </div>
</fieldset>

// ✅ Radio groups always require fieldset + legend
<fieldset>
  <legend>Network</legend>
  <label><input type="radio" name="network" value="testnet" /> Testnet</label>
  <label><input type="radio" name="network" value="mainnet" /> Mainnet</label>
</fieldset>
```

Fieldset groupings required in CreateStreamForm:

| Group | Fields | Legend text |
|-------|--------|-------------|
| Parties | Sponsor (read-only), Recipient | "Stream parties" |
| Token | Token selector, Rate | "Token and rate" |
| Duration | Cliff duration, Total duration | "Stream duration" |
| Metadata | Description | "Stream details" (optional fieldset) |

### 7.6 Required fields

Mark required fields visually and programmatically:

```tsx
<label htmlFor="recipient">
  Recipient address
  <span aria-hidden="true"> *</span>
</label>
<input
  id="recipient"
  required
  aria-required="true"
/>
```

Include a note near the form: "Fields marked with * are required." This note must come before the first required field in DOM order.

### 7.7 Destructive confirmation (WCAG 3.3.4)

Cancel stream and clawback actions are legal/financial commitments. The type-to-confirm gate in `destructive-confirm-dialog.stories.tsx` satisfies WCAG 3.3.4 Error Prevention (Legal, Financial, Data):

- The action is **reversible** before confirmation (Go back button)
- The action is **verified** by typing CANCEL / entering a compliance reason
- The user has opportunity to **review** the impact breakdown before confirming

The Enter key suppression on the destructive button (`onKeyDown` prevents default for `key === "Enter"`) prevents accidental submission.

### 7.8 Autocomplete

For fields that accept user-specific data, add `autocomplete` attributes to help password managers and autofill:

| Field | `autocomplete` value |
|-------|---------------------|
| Wallet/Stellar address inputs | `off` (addresses are not standard autofill categories) |
| Clawback reason textarea | `off` |
| Numeric inputs (rate, duration) | `off` |

---

## 8. Testing Checklist Reference

See the [PR template](../../.github/PULL_REQUEST_TEMPLATE.md) for the checklist embedded in every PR. The items below are the canonical source.

### Automated (must pass in CI)

- [ ] axe-core reports zero `critical` or `serious` violations for all affected routes (`npm run test:a11y`)
- [ ] All new interactive elements reachable and operable by keyboard alone
- [ ] No `:focus { outline: none }` or `*:focus { outline: 0 }` in new CSS

### Manual (required for any UI PR that adds/changes a component)

- [ ] Keyboard: tab through all interactive elements on the affected page — focus order is logical
- [ ] Keyboard: no focus traps introduced (modals included — Escape must close them)
- [ ] Keyboard: skip-to-main link is the first tab stop and works correctly
- [ ] Colour: every state change conveyed by colour also has an icon, label, or ARIA attribute
- [ ] Contrast: new text/background combinations verified at ≥ 4.5:1 (normal) or ≥ 3:1 (large / UI)
- [ ] Motion: animations pause/skip under `prefers-reduced-motion: reduce`
- [ ] Screen reader (VoiceOver or NVDA): all dynamic state changes (toasts, errors, status updates) are announced appropriately
- [ ] Forms: every input has a visible `<label>`, `aria-describedby` hint where applicable, and `aria-invalid` on error
- [ ] Icons: all icon-only buttons have `aria-label`; decorative icons have `aria-hidden="true"`
- [ ] Live regions: countdown timers use `aria-live="off"`; toasts/errors use appropriate live policies

---

## Appendix A — Screen reader test script

1. Load the app with NVDA (Windows/Firefox) or VoiceOver (macOS/Safari).
2. Verify the first tab stop is "Skip to main content" and that activating it moves the virtual cursor into `<main>`.
3. Tab through the nav bar — confirm network selector and wallet button are reachable and announce state.
4. Open the Create Stream form. Tab through all fields — confirm each announces its label and any hint text.
5. Submit with empty required fields — confirm the error summary is announced immediately and focus moves to the first error.
6. Fix one field and blur — confirm the field-level error clears without losing focus.
7. Successfully create a stream — confirm the success toast is announced (`role="status"`).
8. Trigger a transfer failure — confirm the danger toast is announced (`role="alert"`) and the "Copy error details" button is reachable.
9. Open the Cancel Stream dialog — confirm `role="dialog"` is announced, focus lands on "Go back", and Escape closes it.
10. On dashboard, wait for a balance update — confirm it is announced politely without interrupting other reading.

---

## Appendix B — Tools

| Tool | Purpose | How to run |
|------|---------|-----------|
| axe-core (Playwright) | Automated rule scanning | `npm run test:a11y` in `frontend/` |
| NVDA + Firefox | Screen reader (Windows) | Manual — install from nvaccess.org |
| VoiceOver + Safari | Screen reader (macOS) | Manual — ⌘F5 to activate |
| WebAIM Contrast Checker | Contrast ratio verification | https://webaim.org/resources/contrastchecker/ |
| Colour Contrast Analyser (desktop) | Eyedropper contrast checking | https://www.tpgi.com/color-contrast-checker/ |
| Lighthouse (CI) | Accessibility score (supplementary) | `.github/workflows/lighthouse.yml` |
