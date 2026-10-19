# Mobile Navigation

## Primary navigation

At viewport widths up to 767 px, use a fixed, safe-area-aware bottom tab bar:

| Tab | Destination / action |
| --- | --- |
| Streams | `/dashboard` |
| Create | Opens the existing create-stream wizard |
| Activity | `/history` |
| Settings | `/notifications` notification preferences |

The active tab follows the current route. Its color, top indicator, and icon
scale transition over 160 ms; the bar enters from the bottom over 220 ms.
Desktop navigation and page routes are unchanged. Animations are disabled for
users who prefer reduced motion.

An unread badge on Streams counts unread `claim_available` notifications, not
all notification types. It caps visually at `9+` while its accessible name
retains the actual count.

## Quick actions sheet

The **Quick actions** control above the tab bar opens a modal sheet with links
to the existing claim flow (`/dashboard`) and sponsor cancellation flow
(`/sponsor`). Tapping outside the sheet, its Close action, or Escape dismisses
it. Focus stays inside the sheet while open and returns to the trigger after it
closes.

The sheet fades in with the backdrop and slides up over 240 ms. Swipe down from
the drag handle/top 56 px by more than 120 px to dismiss; shorter swipes snap
back. Horizontal swiping between pages is intentionally not used because it
can conflict with vertical stream-list scrolling and does not replace explicit,
accessible tab controls.

The bar and sheet include the device's bottom safe-area inset and maintain
minimum 44 px touch targets. Reduced-motion preferences remove the entry and
state-transition animations.
