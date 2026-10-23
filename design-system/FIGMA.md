# Figma design handoff

The Figma file is a designer-owned binary canvas, so it cannot be authored or diffed in Git. The repository therefore maintains the importable source of truth for the file: CSS design tokens, generated manifests, Storybook screens, and the flow specification. A designer can create the Figma file from these artifacts and use the generated data as its linked Variables and component inventory.

## Source of truth

| Figma page | Repository source | Generated artifact |
|---|---|---|
| Cover | `docs/presentation/design-deck.md` | — |
| Design tokens | `design-system/tokens/tokens.css` and `design-system/tokens/typography.css` | `design-system/tokens/tokens.json` |
| Components | `design-system/components/components.css` and `frontend/src/components/` | `design-system/inventory.json` |
| Screens | `frontend/src/app/` route entrypoints | `design-system/screens.json` |
| Flows | `docs/flows.md` and `docs/mobile-claim-bottom-sheet.md` | `design-system/flows.json` |
| Annotations | `notes` fields in `screens.json` and `flows.json` | — |

Run the generator after changing tokens, component sources, or routes:

```bash
npm run design:export
npm run design:check
```

`design:check` fails in CI when a generated manifest is stale.

## Token import

`design-system/tokens/tokens.json` uses the Design Tokens Community Group shape and contains `dark` and `light` themes. Import it with a Figma token importer such as Tokens Studio, then map each token to a Figma Variable or style using the CSS variable name. Keep the mapping literal so a token rename is visible in review:

- `--color-primary-600` → `color/primary/600`
- `--color-brand-primary` → `color/semantic/brand-primary`
- `--space-4` → `space/4`
- `--radius-base` → `radius/base`
- `--font-size-fluid-body` → `typography/fluid/body`
- `--shadow-md` → `shadow/md`

The light theme is an override layer over the dark palette. Do not duplicate shared shade values in Figma; link both themes to the same Variables.

## Component inventory

`design-system/inventory.json` is generated from the component sources and Storybook titles. Each entry records the source file, CSS classes, variants, sizes, states, tokens used, accessibility expectations, and the target Figma component name. Create a Figma component set using `figmaComponentName`, then link its visual properties to the token Variables.

The inventory currently covers primitives (`Button`, `Input`, `Select`, `Card`, `Badge`, `Tooltip`, `Modal`, `Toast`) and product composites (`ScheduleCard`, `ClaimButton`, `TimelineChart`, `ClaimBottomSheet`, `StreamCreateForm`, `CreateStreamWizard`, `WalletButton`, `StatusBadge`, `Table`, and the loading/empty states).

## Screen frames

`design-system/screens.json` lists the requested screens and their real route entrypoints:

- Landing
- Stream Dashboard
- Create Stream
- Sponsor Dashboard
- Stream Explorer
- Admin Panel
- Settings
- 404

Create a desktop frame at 1440px and a mobile frame at 375px for every `figmaFrameNames` entry. The repository’s automated visual tests currently use 1280×800 and 375×667, and Storybook uses 390/768/1280. Treat 1440 and 375 as the design deliverables, then verify implementation coverage with the automated viewports.

Each screen should include loading, empty, error, and populated states. Copy the corresponding `notes` value into a Figma annotation on the frame.

## Prototype flows

`design-system/flows.json` describes the two prototype graphs:

- `create-flow`: recipient → token → schedule → review → success
- `claim-flow`: pre-cliff → claimable → submitting → success or error

Create a frame for every node using its `figmaNodeName`, then connect frames with the `edges` triggers. The claim flow must preserve the pre-cliff, loading, success, and error states from `docs/mobile-claim-bottom-sheet.md`.

## Handoff checklist

1. Create the Figma cover page with the project summary, maintainers, and the date of the last token export.
2. Import `design-system/tokens/tokens.json` and link all colour, type, spacing, radius, shadow, and transition styles to Variables.
3. Build the component sets listed in `design-system/inventory.json`; use tokens instead of hard-coded values.
4. Add the 1440px and 375px frames listed in `design-system/screens.json`.
5. Wire the create and claim prototypes from `design-system/flows.json`.
6. Add developer handoff annotations, including the route, loading state, keyboard behavior, and token dependencies for each frame.
7. Share the file with the development team and record the Figma URL in the project documentation.

## Drift prevention

The JSON files are generated, not hand-edited. If a design review changes a value, update the CSS token or component source and run `npm run design:export`. The Storybook build is deployed from `main` and provides a live, pixel-accurate reference for the same component states.
