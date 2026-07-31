# Design System — Vesting Cliff Drip Stream

A lightweight design system for any frontend built on top of this contract.

## Structure

```
design-system/
├── tokens/
│   ├── tokens.css          # All design tokens (CSS custom properties)
│   └── typography.css      # Fluid type scale using clamp() — issue #384
└── components/
    └── components.css      # Component styles consuming the tokens
```

## Import order

Always import in this order so components can resolve all token references:

```css
@import 'design-system/tokens/tokens.css';
@import 'design-system/tokens/typography.css';
@import 'design-system/components/components.css';
```

## Tokens

Import `tokens/tokens.css` first in your stylesheet or entry point.

### Colour palette

Each of `primary`, `secondary`, `success`, `warning`, `error`, and `neutral` is a
full 10-shade scale (`50`…`900`), e.g. `--color-primary-50` … `--color-primary-900`.
Reach for a specific shade when a component needs a lighter/darker step than the
semantic default (hover, disabled, subtle backgrounds, …).

Semantic aliases (used by `components.css`, resolve to the shade noted):

| Token | Value | Usage |
|---|---|---|
| `--color-brand-primary` | `--color-primary-600` (`#7C3AED`) | Primary actions, focus rings |
| `--color-brand-secondary` | `--color-secondary-600` (`#4F46E5`) | Hover states |
| `--color-accent` | `#06B6D4` | Highlights, badges |
| `--color-success` | `--color-success-500` (`#10B981`) | Positive status |
| `--color-warning` | `--color-warning-500` (`#F59E0B`) | Warning alerts |
| `--color-danger` | `--color-error-500` (`#EF4444`) | Errors, destructive actions |
| `--color-bg-base` | `--color-neutral-900` (`#0F172A`) | Page background |
| `--color-bg-surface` | `--color-neutral-800` (`#1E293B`) | Cards, modals |
| `--color-bg-elevated` | `--color-neutral-700` (`#334155`) | Dropdowns, hover layers |

### Dark / light theme

Dark is the default (`:root`) palette. Add `data-theme="light"` to `<html>` or
any ancestor element to flip the semantic bg/text/border aliases and shadow
opacities to the light variant — the 10-shade colour scales themselves don't
change between themes, only which alias points at which shade. This maps onto
the existing `useDarkMode` toggle in `frontend/src/hooks/useDarkMode.ts`.

### Typography scale

Sizes (fluid — all use `clamp()`, no media queries):

| Token | Min | Max | Usage |
|---|---|---|---|
| `--font-size-fluid-xs` | 11px | 12px | Labels, captions |
| `--font-size-fluid-sm` | 13px | 14px | Secondary text, badges |
| `--font-size-fluid-base` | 16px | 18px | Body text |
| `--font-size-fluid-lg` | 18px | 20px | Sub-headings, card titles |
| `--font-size-fluid-xl` | 20px | 24px | Section headings (h4) |
| `--font-size-fluid-2xl` | 24px | 30px | Page sub-headings (h3) |
| `--font-size-fluid-3xl` | 30px | 38px | Page headings (h2) |
| `--font-size-fluid-4xl` | 36px | 48px | Hero / display (h1) |

Convenience aliases in `tokens.css`:

| Alias | Maps to | Notes |
|---|---|---|
| `--font-size-body` | `fluid-base` | 16→18px; use for all body text |
| `--font-size-body-lg` | `fluid-lg` | 18→20px; card headers |
| `--font-size-label` | `fluid-sm` | 13→14px; form labels |
| `--font-size-caption` | `fluid-xs` | 11→12px; helper text |

Body text line-height: `1.6` (`--line-height-base`).  
Maximum line length: `72ch` (`--measure-body`).

Font stacks:
- **Body:** `-apple-system, BlinkMacSystemFont, 'Segoe UI', …` — system font, zero latency
- **Mono:** `'JetBrains Mono', 'Fira Code', …` — for addresses, ledger numbers, tx hashes

Numeric rendering: `font-variant-numeric: tabular-nums` on all amount/address elements.

Weights: `normal` 400 · `medium` 500 · `semibold` 600 · `bold` 700 · `extrabold` 800

### Spacing (4-point grid)

`--space-1` (4px) through `--space-16` (64px).

### Border radius

| Token | Value |
|---|---|
| `--radius-none` | `0` |
| `--radius-sm` | `0.25rem` |
| `--radius-base` | `0.5rem` |
| `--radius-lg` | `0.75rem` |
| `--radius-full` | `9999px` |

### Shadows

| Token | Usage |
|---|---|
| `--shadow-sm` | Subtle depth (inputs, badges) |
| `--shadow-md` | Cards, dropdowns |
| `--shadow-lg` | Modals, popovers |
| `--shadow-xl` | Toasts, high-elevation overlays |

## Components

### Button

```html
<button class="btn btn--primary">Create Stream</button>
<button class="btn btn--secondary">View Schedule</button>
<button class="btn btn--danger btn--sm">Cancel</button>
<button class="btn btn--primary btn--lg">Claim Vested</button>
```

Variants: `btn--primary` · `btn--secondary` · `btn--danger`  
Sizes: *(default)* · `btn--sm` · `btn--lg`

### Input

```html
<input class="input" type="text" placeholder="Recipient address" />
<input class="input input--error" type="number" value="-1" />
```

### Card

```html
<div class="card">
  <div class="card__header">Stream #1</div>
  <div class="card__body">Rate: 10 tokens/ledger · Cliff: 17 280 ledgers</div>
  <div class="card__footer">
    <button class="btn btn--secondary btn--sm">Details</button>
    <button class="btn btn--primary btn--sm">Claim</button>
  </div>
</div>
```

### Select

```html
<select class="select">
  <option>USDC</option>
  <option>XLM</option>
</select>
<select class="select select--error"><option>Invalid token</option></select>
```

### Badge

```html
<span class="ds-badge ds-badge--success">Active</span>
<span class="ds-badge ds-badge--warning">Pre-cliff</span>
<span class="ds-badge ds-badge--danger">Cancelled</span>
<span class="ds-badge ds-badge--neutral">Completed</span>
```

### Tooltip

```html
<span class="ds-tooltip" tabindex="0">
  Hover or focus me
  <span class="ds-tooltip__content" role="tooltip">Cliff catch-up amount</span>
</span>
```

### Modal

```html
<div class="ds-modal-backdrop">
  <div class="ds-modal" role="dialog" aria-modal="true" aria-labelledby="m-title">
    <div class="ds-modal__header" id="m-title">Cancel stream?</div>
    <div class="ds-modal__body">Accrued tokens remain claimable by the recipient.</div>
    <div class="ds-modal__footer">
      <button class="btn btn--secondary btn--sm">Keep stream</button>
      <button class="btn btn--danger btn--sm">Cancel stream</button>
    </div>
  </div>
</div>
```

### Toast

```html
<div class="ds-toast-region">
  <div class="ds-toast ds-toast--success" role="status">Claim confirmed on-chain.</div>
  <div class="ds-toast ds-toast--danger" role="alert">Transaction failed. Try again.</div>
</div>
```

## Deploying Storybook

A Storybook integration would consume these tokens and components. To set up:

```bash
npx storybook@latest init
# Add tokens.css and components.css to .storybook/preview.js imports
# Create stories under src/stories/ for each component variant
# Deploy to GitHub Pages:
npx storybook build -o storybook-static
# Push storybook-static/ via gh-pages action or: npx gh-pages -d storybook-static
```

## Usage in Tailwind

Alternatively, map tokens to a Tailwind config:

```js
// tailwind.config.js
module.exports = {
  theme: {
    extend: {
      colors: {
        brand: { primary: '#7C3AED', secondary: '#4F46E5' },
        accent: '#06B6D4',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
    },
  },
}
```
