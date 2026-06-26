# Design System — Vesting Cliff Drip Stream

A lightweight design system for any frontend built on top of this contract.

## Structure

```
design-system/
├── tokens/
│   └── tokens.css          # All design tokens (CSS custom properties)
└── components/
    └── components.css      # Component styles consuming the tokens
```

## Tokens

Import `tokens/tokens.css` first in your stylesheet or entry point.

### Colour palette

| Token | Value | Usage |
|---|---|---|
| `--color-brand-primary` | `#7C3AED` | Primary actions, focus rings |
| `--color-brand-secondary` | `#4F46E5` | Hover states |
| `--color-accent` | `#06B6D4` | Highlights, badges |
| `--color-success` | `#10B981` | Positive status |
| `--color-warning` | `#F59E0B` | Warning alerts |
| `--color-danger` | `#EF4444` | Errors, destructive actions |
| `--color-bg-base` | `#0F172A` | Page background |
| `--color-bg-surface` | `#1E293B` | Cards, modals |
| `--color-bg-elevated` | `#334155` | Dropdowns, hover layers |

### Typography scale

Sizes: `xs` (12) · `sm` (14) · `base` (16) · `lg` (18) · `xl` (20) · `2xl` (24) · `3xl` (30)

Weights: `normal` 400 · `medium` 500 · `semibold` 600 · `bold` 700

### Spacing (4-point grid)

`--space-1` (4px) through `--space-16` (64px).

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
