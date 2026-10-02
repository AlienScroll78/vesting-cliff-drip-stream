# Accessibility Audit — WCAG 2.1 AA

Closes #824.

## Scope

The audit target is the page this application actually serves: `frontend/index.html`,
the "Create Vesting Stream" form. That file is the Vite root document.

There is no `src/main.tsx` and no `createRoot` call anywhere in `frontend/src`, so the
React component tree (`src/App.tsx`, `src/components/*`) is **not mounted and is not
reachable at any URL** in the current build. Scanning those components would require
bootstrapping a React entry point first, which is a separate piece of work. Everything
below therefore describes the shipped page, which is the only thing a user can reach.

## How to reproduce

```bash
cd frontend
npm ci --legacy-peer-deps
npx playwright install chromium
npm run test:a11y
```

`test:a11y` starts the Vite dev server via `playwright.a11y.config.ts` and runs
`e2e/accessibility-audit.spec.ts`. Every test fails the run on any axe-core violation of
impact `critical` or `serious` against the `wcag2a`, `wcag2aa`, `wcag21a` and `wcag21aa`
rule sets. Full JSON results are written to `frontend/test-results/a11y-reports/`.

## Automated results (axe-core 4.13.0)

Measured on Chromium 149 headless, axe-core 4.13.0, against `http://127.0.0.1:4321/`.

### Before

| Scan | Violations | Passes | Incomplete | Inapplicable |
| --- | --- | --- | --- | --- |
| Landing, light | 1 serious | 19 | 0 | 42 |
| Landing, dark | 1 serious | 19 | 0 | 42 |
| Landing, 375px | 1 serious | 19 | 0 | 42 |

Violations found, identical in all three scans:

| Impact | Rule | WCAG | Nodes | Detail |
| --- | --- | --- | --- | --- |
| serious | `link-in-text-block` | 1.4.1 Use of Color | 1 | "View your schedule →" in `.cta-section` was distinguished from its surrounding text by colour alone (`text-decoration: none`), at 1.02:1 against the adjacent `#6b7280` text. Requires 3:1, or a non-colour distinction such as an underline. |

### After

| Scan | Violations | Passes | Incomplete | Inapplicable |
| --- | --- | --- | --- | --- |
| Landing, light | 0 | 20 | 0 | 42 |
| Landing, dark | 0 | 20 | 0 | 42 |
| Landing, 375px | 0 | 20 | 0 | 42 |

**Zero critical and zero serious violations** in all three scans, which is the first
acceptance criterion for this issue.

## Fixes applied

All changes are in `frontend/index.html` unless noted.

1. **`link-in-text-block` (serious, WCAG 1.4.1)** — the CTA link is now underlined with
   `text-decoration: underline` plus `text-underline-offset`, so it is no longer
   distinguished by colour alone. The `href="#"` placeholder was also changed to `/view`,
   because `href="#"` moves focus nowhere.
2. **Focus visibility (WCAG 2.4.7)** — a global `:focus-visible` outline of `2px solid`
   with a `2px` offset was added. Previously `.connect-btn`, `.submit-btn` and every text
   input had **no** visible focus indicator, and the inputs additionally set
   `outline: none`, which suppressed the browser's own focus ring. That suppression has
   been removed so the UA ring is never disabled, even where `:focus-visible` does not
   match. Verified by a test that focuses each control and inspects the computed
   `outline-*` and `box-shadow`.
3. **Bypass block (WCAG 2.4.1)** — a "Skip to main content" link is now the first element
   in the document, becomes visible on focus, and targets `<main id="main" tabindex="-1">`
   so focus actually moves into the main landmark. A test asserts it is the first tab stop
   and that activating it focuses `#main`.
4. **Landmark naming** — `<nav>` is now `<nav aria-label="Primary">`, so the landmark has
   an accessible name when more than one navigation region exists.
5. **Error identification and announcement (WCAG 3.3.1, 4.1.3)** — the two `alert()`
   calls in the submit handler were replaced with a persistent
   `<div id="form-error" role="alert" aria-live="assertive">` region. The message is
   announced by screen readers, the offending field receives focus, and the error stays on
   screen instead of vanishing with the dialog.
6. **Form field descriptions (WCAG 3.3.2)** — the three address fields gained
   `aria-describedby` hint text ("Your Stellar public key.", "The account that will be
   able to claim.", "Stellar Asset Contract address…"), giving context that was previously
   conveyed only by placeholders.
7. **Table semantics** — the schedule preview table gained a `<caption>`, `scope="col"` on
   both header cells, and `aria-labelledby` pointing at its `<h2>`.
8. **Error styling in dark mode** — the new error region has an explicit dark-mode
   treatment so it does not render as pale red-on-dark.

## Keyboard (WCAG 2.1.1, 2.1.2, 2.4.3, 2.4.7)

Automated, via `e2e/accessibility-audit.spec.ts`:

- All eight interactive controls (`dark-toggle`, `wallet-btn`, `sponsor`, `recipient`,
  `token`, `rate`, `cliff-date`, `end-date`) are reachable by <kbd>Tab</kbd> alone.
  Nothing requires a pointer.
- **No keyboard traps.** The page contains no focus-trapping container; tabbing cycles
  through the document and out.
- Focus is visible on every interactive control (tested, see fix 2).
- Focus order follows DOM order, which is also visual order: skip link, theme toggle,
  connect wallet, then the form fields in reading order.
- The first tab stop is the skip link, so keyboard and screen-reader users can bypass the
  navigation (fix 3).

## Reflow / zoom (WCAG 1.4.10)

Tested at a 320px-wide viewport, which is the CSS width that 400% zoom produces from a
1280px-wide window. `documentElement.scrollWidth` does not exceed `clientWidth`, so there
is **no horizontal scrolling** and no loss of content at 400% zoom. There is no
horizontal-scroll trap at 200% either, as the same layout holds at 375px.

## Colour contrast (WCAG 1.4.3, 1.4.11)

axe-core's `color-contrast` rule passes in both light and dark modes, for normal text
(4.5:1) and large text (3:1). The dark-mode token block already documented ≥4.7:1 for all
muted text, and light-mode muted text (`#6b7280`) clears the 4.5:1 threshold on both
`--bg` and `--surface`. The one contrast failure the audit did surface was the
`link-in-text-block` rule above, which is now fixed by underlining rather than by changing
the palette.

## Screen readers — NOT YET PERFORMED

**NVDA (Windows) and VoiceOver (macOS) testing has not been carried out.** Neither
platform nor a Windows/macOS host was available in the environment where this audit was
run, and it would be wrong to record results that were never observed.

The two acceptance criteria that depend on this remain open:

- [ ] Screen reader announces all state changes — **unverified.**
- Manual NVDA + VoiceOver walkthrough of all flows — **not started.**

What has been done instead, and is a genuine prerequisite for that testing rather than a
substitute for it: every state change the page produces is now in a live region or a
native control, so that a screen reader has something to announce.

| State change | Mechanism now in place | Status |
| --- | --- | --- |
| Form validation failure | `role="alert" aria-live="assertive"` on `#form-error` | Implemented, not screen-reader tested |
| Cliff ledger hint updates | `aria-live="polite"` on `#cliff-hint` | Pre-existing, not screen-reader tested |
| End ledger hint updates | `aria-live="polite"` on `#end-hint` | Pre-existing, not screen-reader tested |
| Dark mode toggled | `aria-pressed` flips on the toggle button | Implemented, not screen-reader tested |
| Schedule preview revealed | `display: none` → `block`, then scrolled into view | **Gap:** the region is not in a live region and receives no focus, so a screen-reader user is not told it appeared. Worth addressing. |

### Suggested manual test script

1. Load `/` with NVDA. Confirm the "Skip to main content" link is the first item and that
   activating it moves the virtual cursor into the main landmark.
2. Tab to "Connect Wallet" and "Toggle dark mode". Confirm the toggle announces its
   pressed state before and after activation.
3. Submit the form with empty dates. Confirm the validation message is announced
   immediately without moving focus, and that focus then lands on the offending field.
4. Type a future cliff date. Confirm the ledger hint is announced politely, not
   interruptively, and does not interrupt the character echo.
5. Repeat 3–4 with VoiceOver + Safari, and confirm the same states are announced.

## Not audited

- **WAVE.** Not run. WAVE is a hosted service; the audit was performed with axe-core
  locally. WAVE largely re-reports the same rules plus proprietary heuristics, so it would
  be a confirmation rather than new coverage.
- **Automated testing detects roughly 30–40% of accessibility problems.** A clean axe run
  is necessary, not sufficient. Automated tooling cannot judge whether alt text is
  meaningful, whether heading order reflects the intended document outline, or whether a
  focus order makes sense to a screen-reader user. The manual pass above remains required
  before this page can be called AA-conformant.
- The unwired React components under `frontend/src/components` are out of scope for the
  reasons in *Scope*, not because they were found to be accessible.
