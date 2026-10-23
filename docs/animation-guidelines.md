# UI Animation Guidelines

Animations should reinforce the token-stream metaphor: a lock releases when
the cliff is reached, and earned tokens flow to the recipient. Motion should
communicate a state change without delaying interaction or distracting from
the information.

## Timing and easing

| Interaction | Duration | Easing |
| --- | ---: | --- |
| Button press and status/icon transitions | 100–200 ms | `ease-out` or `cubic-bezier(0.2, 0, 0, 1)` |
| Balance ticker and other UI feedback | 200–400 ms | cubic ease-out |
| Cliff unlock and claim-success celebration | 600–1000 ms | ease-out |

Use compositor-friendly `transform` and `opacity` for movement. Color transitions
are limited to small status surfaces. Never make motion a prerequisite for
understanding or completing an action.

## Interaction patterns

- When the cliff is reached, animate the locked icon into an unlocked state.
- Ticker the claimable balance briefly when its value changes.
- Use a short, dismissible token/confetti burst after a successful claim.
- Transition status badge color and icon together; retain a visible text label.
- Give enabled buttons immediate pressed feedback with a subtle scale and shadow.

All motion must respect `prefers-reduced-motion`: remove movement and celebration
effects, and render the final value/state immediately. The reduced-motion CSS
fallback complements component-level checks.
