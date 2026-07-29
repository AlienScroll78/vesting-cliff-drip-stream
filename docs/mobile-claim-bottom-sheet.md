# Mobile Claim Bottom-Sheet — Design Spec

## Overview

Recipients on mobile devices currently experience a poor claim UI.
This document specifies the redesigned mobile-first bottom-sheet claim flow.

---

## Acceptance Criteria

- [ ] Design mockup approved before implementation begins
- [ ] Tested on iPhone SE (375 × 667 px) and Samsung Galaxy S21 (360 × 800 px)
- [ ] Bottom sheet dismisses on swipe-down gesture
- [ ] Single primary CTA button ("Claim Tokens")
- [ ] Claimable amount displayed prominently above the CTA

---

## Trigger

The bottom sheet opens when the recipient taps **"Claim"** on any stream row
in the stream list, or the floating claim button on the stream detail page.

---

## Layout (mobile, ≤ 640 px)

```
┌─────────────────────────────────────┐
│  ━━━  (drag handle, 32 × 4 px)      │  ← centred, top 8 px
│                                     │
│  You can claim                      │  ← caption, grey-500, 14 px
│  1,250 USDC                         │  ← amount, bold, 32 px, primary colour
│                                     │
│  Stream: Alice → Bob                │  ← stream label, 12 px, grey-400
│  Ends in 42 days                    │  ← relative time, 12 px, grey-400
│                                     │
│  ┌───────────────────────────────┐  │
│  │      Claim Tokens   →         │  │  ← primary CTA, full-width, 48 px tall
│  └───────────────────────────────┘  │
│                                     │
│  Cancel                             │  ← text link, centred, grey-500
└─────────────────────────────────────┘
```

### States

| State        | CTA label          | CTA colour  | Notes                                    |
|--------------|--------------------|-------------|------------------------------------------|
| Ready        | "Claim Tokens →"   | Blue-600    | Claimable amount > 0                     |
| Pre-cliff    | "Cliff not reached"| Grey (disabled) | Disabled; show countdown below amount |
| Loading      | Spinner            | Blue-600/50 | After tap, before tx confirmation        |
| Success      | "Claimed! ✓"       | Green-500   | Auto-dismiss after 1.5 s                 |
| Error        | "Retry"            | Red-500     | Show inline error message above CTA      |

---

## Gesture & Animation

| Interaction            | Behaviour                                                      |
|------------------------|----------------------------------------------------------------|
| Swipe down > 120 px    | Dismiss (spring animation, 300 ms ease-out)                    |
| Tap outside sheet      | Dismiss                                                        |
| Swipe up from edge     | Expand to 90 vh (shows full stream schedule details)           |
| CTA tap                | Haptic feedback (iOS) + loading state                          |

Sheet enters from bottom: `translateY(100%) → translateY(0)`, 250 ms ease-out.

---

## Accessibility

- Sheet root has `role="dialog"` and `aria-modal="true"`.
- `aria-labelledby` points to the "You can claim" heading.
- Focus is trapped inside the sheet while open.
- Dismiss action is also reachable via the "Cancel" link and the `Escape` key.
- Amount uses `aria-label="Claimable amount: 1,250 USDC"`.

---

## Contract Integration

Fetch the claimable amount from the `claimable_amount(recipient: Address)` view
before opening the sheet. If `0` and cliff not reached, open in the pre-cliff
disabled state. Call `claim_vested(recipient)` on CTA tap.

```ts
// Pseudocode
const amount = await contract.claimable_amount(recipient);
const cliffPassed = await contract.is_cliff_passed(recipient);
openBottomSheet({ amount, cliffPassed });

// On CTA tap:
await contract.claim_vested(recipient);
```

---

## Test Devices

| Device           | Viewport      | OS             | Priority |
|------------------|---------------|----------------|----------|
| iPhone SE (3rd)  | 375 × 667 px  | iOS 17         | P0       |
| Samsung Galaxy S21 | 360 × 800 px | Android 14   | P0       |
| iPhone 15 Pro    | 393 × 852 px  | iOS 17         | P1       |
| Pixel 7          | 412 × 915 px  | Android 14     | P1       |

---

## Open Questions

1. Should the sheet show full transaction history, or only the current claimable?
2. Does the sheet need a "Share" action for on-chain proof of claim?
3. Confirm token symbol display format (e.g., `1,250 USDC` vs `1250 stroops`).
