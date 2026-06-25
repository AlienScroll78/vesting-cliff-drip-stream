# Visual Regression Testing

Visual snapshots are captured with Storybook and Chromatic.

## Covered snapshots

- Schedule card: `ScheduleCardSnapshot`
- Claim button: `ClaimButtonReadySnapshot`
- Disabled claim button: `ClaimButtonDisabledSnapshot`
- Timeline chart: `TimelineChartSnapshot`
- Cancel modal: `ModalSnapshot`

## CI behavior

The `Visual Regression` workflow installs Node dependencies, builds Storybook,
and publishes the stories to Chromatic. `exitZeroOnChanges: false` makes CI fail
when Chromatic detects an unexpected visual diff.

## Diff review process

1. Open the Chromatic check from the pull request.
2. Inspect each changed snapshot at the configured 390, 768, and 1280 pixel
   viewport widths.
3. Accept the baseline only when the visual change is intentional and the UI is
   still readable at every viewport.
4. Reject the change and update the branch when the diff shows unintended
   layout movement, clipped text, missing content, or incorrect state styling.

This repository did not previously include a frontend. The Storybook fixtures in
`ui/` provide deterministic component snapshots for the requested vesting UI
surfaces.
