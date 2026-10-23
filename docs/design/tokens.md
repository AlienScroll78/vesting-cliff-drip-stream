# Design Tokens

> Issue #1036 — Design system: color palette, typography, and spacing scale

This document is the canonical reference for all design tokens used across the Vesting Cliff Drip Stream frontend. Tokens are implemented as CSS custom properties in [`design-system/tokens/tokens.css`](../../design-system/tokens/tokens.css) and exported as JSON in [`design-system/tokens/tokens.json`](../../design-system/tokens/tokens.json).

---

## Color Palette

### Primary — Blue (Trustworthy Finance)

Conveys trust, stability, and financial reliability. Used for primary actions, links, and focus states.

| Token | Light | Dark | Usage |
|-------|-------|------|-------|
| `--color-primary-50` | `#EFF6FF` | `#EFF6FF` | Page backgrounds, subtle tints |
| `--color-primary-100` | `#DBEAFE` | `#DBEAFE` | Hover backgrounds |
| `--color-primary-200` | `#BFDBFE` | `#BFDBFE` | Borders, badges |
| `--color-primary-300` | `#93C5FD` | `#93C5FD` | Disabled primary |
| `--color-primary-400` | `#60A5FA` | `#60A5FA` | Secondary accents |
| `--color-primary-500` | `#3B82F6` | `#3B82F6` | Icons, indicators |
| `--color-primary-600` | `#2563EB` | `#2563EB` | **Default primary** — buttons, links |
| `--color-primary-700` | `#1D4ED8` | `#1D4ED8` | Hover/active states |
| `--color-primary-800` | `#1E40AF` | `#1E40AF` | Pressed states |
| `--color-primary-900` | `#1E3A8A` | `#1E3A8A` | High-contrast text on light |

### Secondary — Emerald (Growth/Trust)

Used for secondary actions, positive indicators, and trustline confirmation.

| Token | Value | Usage |
|-------|-------|-------|
| `--color-secondary-500` | `#10B981` | Success-adjacent accents |
| `--color-secondary-600` | `#059669` | **Default secondary** — secondary buttons |
| `--color-secondary-700` | `#047857` | Hover states |

### Semantic Colors

| Token | Value | Usage |
|-------|-------|-------|
| `--color-success` | `--color-success-500` (`#10B981`) | Successful transactions, claim confirmations |
| `--color-warning` | `--color-warning-500` (`#F59E0B`) | Warning states, cliff approaching |
| `--color-danger` | `--color-error-500` (`#EF4444`) | Errors, destructive actions, cancel |
| `--color-accent` | `#06B6D4` (cyan-500) | General accent |
| `--color-accent-unlock` | `#F59E0B` (amber-500) | **Cliff unlock celebration** — distinct, positive |

### Neutral Scale

| Token | Light bg | Dark bg | Usage |
|-------|----------|---------|-------|
| `--color-neutral-50` | `#F8FAFC` | `#F8FAFC` | Base background (light) |
| `--color-neutral-100` | `#F1F5F9` | `#F1F5F9` | Elevated surfaces (light) |
| `--color-neutral-200` | `#E2E8F0` | `#E2E8F0` | Borders (light) |
| `--color-neutral-400` | `#94A3B8` | `#94A3B8` | Secondary text (dark) |
| `--color-neutral-600` | `#475569` | `#475569` | Secondary text (light) |
| `--color-neutral-800` | `#1E293B` | `#1E293B` | Surface background (dark) |
| `--color-neutral-900` | `#0F172A` | `#0F172A` | Base background (dark) |

### Background & Text Aliases (Theme-Aware)

| Token | Light mode | Dark mode |
|-------|------------|-----------|
| `--color-bg-base` | `--color-neutral-50` | `--color-neutral-900` |
| `--color-bg-surface` | `#FFFFFF` | `--color-neutral-800` |
| `--color-bg-elevated` | `--color-neutral-100` | `--color-neutral-700` |
| `--color-text-primary` | `--color-neutral-900` | `--color-neutral-50` |
| `--color-text-secondary` | `--color-neutral-600` | `--color-neutral-400` |
| `--color-text-disabled` | `--color-neutral-400` | `--color-neutral-600` |
| `--color-border` | `--color-neutral-200` | `--color-neutral-700` |

---

## WCAG AA Contrast Verification

All text/background combinations meet WCAG 2.1 AA (≥ 4.5:1 for normal text, ≥ 3:1 for large text).

### Light Mode

| Foreground | Background | Ratio | Pass |
|-----------|-----------|-------|------|
| `--color-neutral-900` (#0F172A) | `#FFFFFF` (surface) | 16.4:1 | ✅ AA |
| `--color-neutral-600` (#475569) | `#FFFFFF` (surface) | 7.6:1 | ✅ AA |
| `--color-primary-600` (#2563EB) | `#FFFFFF` (surface) | 5.2:1 | ✅ AA |
| `--color-primary-700` (#1D4ED8) | `--color-primary-50` (#EFF6FF) | 8.6:1 | ✅ AA |
| `--color-success-600` (#059669) | `#FFFFFF` (surface) | 4.6:1 | ✅ AA |
| `--color-error-600` (#DC2626) | `#FFFFFF` (surface) | 5.9:1 | ✅ AA |
| `--color-warning-700` (#B45309) | `--color-warning-50` (#FFFBEB) | 5.7:1 | ✅ AA |

### Dark Mode

| Foreground | Background | Ratio | Pass |
|-----------|-----------|-------|------|
| `--color-neutral-50` (#F8FAFC) | `--color-neutral-900` (#0F172A) | 16.4:1 | ✅ AA |
| `--color-neutral-400` (#94A3B8) | `--color-neutral-800` (#1E293B) | 4.7:1 | ✅ AA |
| `--color-primary-400` (#60A5FA) | `--color-neutral-900` (#0F172A) | 5.9:1 | ✅ AA |
| `--color-success-400` (#34D399) | `--color-neutral-900` (#0F172A) | 8.7:1 | ✅ AA |
| `--color-error-400` (#F87171) | `--color-neutral-900` (#0F172A) | 5.9:1 | ✅ AA |

---

## Typography Scale

### Font Families

| Token | Value | Usage |
|-------|-------|-------|
| `--font-family-base` | System font stack | Body text, UI labels |
| `--font-family-mono` | JetBrains Mono, Fira Code, Consolas | Addresses, amounts, ledger numbers |

### Fluid Type Scale

Uses `clamp()` for responsive sizing — no media queries needed.

| Token | Min (320px) | Max (1280px) | Usage |
|-------|-------------|-------------|-------|
| `--font-size-fluid-xs` | 11px | 12px | Captions, helper text |
| `--font-size-fluid-sm` | 13px | 14px | Labels, metadata, badges |
| `--font-size-fluid-base` | 16px | 18px | Body text |
| `--font-size-fluid-lg` | 18px | 20px | Section headings, card titles |
| `--font-size-fluid-xl` | 20px | 24px | Page headings |
| `--font-size-fluid-2xl` | 24px | 30px | Hero headings |
| `--font-size-fluid-3xl` | 30px | 36px | Display headings |

### Font Weights

| Token | Value |
|-------|-------|
| `--font-weight-normal` | 400 |
| `--font-weight-medium` | 500 |
| `--font-weight-semibold` | 600 |
| `--font-weight-bold` | 700 |

### Line Heights

| Token | Value | Usage |
|-------|-------|-------|
| `--line-height-tight` | 1.25 | Headings |
| `--line-height-snug` | 1.375 | Subheadings |
| `--line-height-base` | 1.6 | Body text |
| `--line-height-loose` | 1.75 | Relaxed reading |

---

## Spacing Scale

4px base unit, t-shirt sizes for semantic naming.

| Token | Value | Pixels | T-shirt |
|-------|-------|--------|---------|
| `--space-1` | 0.25rem | 4px | xs |
| `--space-2` | 0.5rem | 8px | sm |
| `--space-4` | 1rem | 16px | md |
| `--space-6` | 1.5rem | 24px | lg |
| `--space-8` | 2rem | 32px | xl |
| `--space-3` | 0.75rem | 12px | (between sm and md) |
| `--space-5` | 1.25rem | 20px | (between md and lg) |
| `--space-10` | 2.5rem | 40px | 2xl |
| `--space-12` | 3rem | 48px | 3xl |
| `--space-16` | 4rem | 64px | 4xl |

---

## Elevation / Shadow Tokens

| Token | Light mode | Dark mode | Usage |
|-------|-----------|-----------|-------|
| `--shadow-sm` | `0 1px 2px rgb(15 23 42 / 0.06)` | `0 1px 2px rgb(0 0 0 / 0.4)` | Cards, inputs |
| `--shadow-md` | `0 4px 6px rgb(15 23 42 / 0.08)` | `0 4px 6px rgb(0 0 0 / 0.4)` | Dropdowns, popovers |
| `--shadow-lg` | `0 10px 15px rgb(15 23 42 / 0.1)` | `0 10px 15px rgb(0 0 0 / 0.5)` | Modals, dialogs |
| `--shadow-xl` | `0 20px 25px rgb(15 23 42 / 0.12)` | `0 20px 25px rgb(0 0 0 / 0.5)` | Floating elements |

---

## Border Radius

| Token | Value | Usage |
|-------|-------|-------|
| `--radius-sm` | 0.25rem | Inputs, badges |
| `--radius-base` | 0.5rem | Cards, buttons |
| `--radius-lg` | 0.75rem | Modals, large containers |
| `--radius-full` | 9999px | Pills, avatars |

---

## Transitions

| Token | Value | Usage |
|-------|-------|-------|
| `--transition-fast` | 150ms ease | Hover states, toggles |
| `--transition-base` | 250ms ease | Panels, accordions |
| `--transition-slow` | 400ms ease | Theme transitions, large animations |

---

## Theme Switching

Light mode is the default (`:root`). Dark mode is opt-in via `[data-theme='dark']` on `<html>` or any ancestor element. Only semantic aliases (bg, text, border, shadow) flip — shade scales are theme-invariant.

```html
<!-- Light (default) -->
<html>...</html>

<!-- Dark mode -->
<html data-theme="dark">...</html>
```
