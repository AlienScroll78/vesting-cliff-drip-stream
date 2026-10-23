## Description

<!-- What does this PR do? Why is this change needed? Link the motivation and any relevant context. -->



## Changes

<!-- Bullet list of the key changes made. -->

-

## Related Issues

<!-- Closes #<issue-number> -->

---

## Testing

- [ ] New tests added for new behaviour?
- [ ] All existing tests pass (`make test`)
- [ ] Mutation score maintained (`make mutants` — no unexpected survivors)
- [ ] Relevant edge cases covered (boundary values, error paths)

## Documentation

- [ ] `CHANGELOG.md` updated (new section under `Unreleased`)
- [ ] ADR added or updated if a design decision changed (`docs/adr/`)
- [ ] Runbook updated if an operational procedure changed (`docs/runbooks/`)
- [ ] Inline `///` doc comments added for all public functions and types
- [ ] README updated if the public API or Quick Start steps changed

## Accessibility

> Skip this section only for PRs that touch no UI code (e.g. pure Rust contract changes, infra-only, docs).
> Full requirements: [docs/accessibility-audit.md](../docs/accessibility-audit.md)

### Automated (CI)

- [ ] `npm run test:a11y` passes — zero axe-core `critical` or `serious` violations on all affected routes
- [ ] No new `:focus { outline: none }` or `*:focus { outline: 0 }` in CSS

### Manual checks (required for any component add/change)

- [ ] Keyboard: tab through all interactive elements — focus order is logical and no focus traps introduced
- [ ] Keyboard: skip-to-main link is first tab stop and moves focus into `<main>` correctly
- [ ] Keyboard: all modals/dialogs close on `Escape` and return focus to the trigger element
- [ ] Colour: every state change conveyed by colour also has an icon, label, or ARIA attribute (1.4.1)
- [ ] Contrast: new text/background combinations are ≥ 4.5:1 normal text, ≥ 3:1 large text and UI components (1.4.3, 1.4.11)
- [ ] Motion: new animations/transitions skip or instant-cut under `prefers-reduced-motion: reduce`
- [ ] Screen reader: all dynamic state changes (toasts, errors, live balances) are announced via the correct live region policy (`polite` or `assertive`)
- [ ] Forms: every input has a visible `<label>`, `aria-describedby` for hints/errors, and `aria-invalid="true"` on validation failure
- [ ] Icons: all icon-only buttons have `aria-label`; all decorative icons have `aria-hidden="true"`
- [ ] Timers: countdown timers (cliff countdown) use `aria-live="off"` — one-off milestone announcements use `role="alert"`

## Security

- [ ] `require_auth()` used correctly for all state-mutating entry points
- [ ] All arithmetic uses `checked_*` operations — no unchecked addition, subtraction, or multiplication
- [ ] No secrets, private keys, or credentials committed
- [ ] Input validation present for all user-supplied values (lengths, ranges, non-zero checks)
- [ ] Error codes are explicit — no silent failures or unwraps in contract code

## Performance

- [ ] WASM binary size unchanged or smaller (`make wasm-size` — compare against baseline in `benchmarks/`)
- [ ] No N+1 database queries introduced in backend changes
- [ ] Benchmark results within acceptable range (`make bench`) — attach output if changed

## Breaking Changes

- [ ] Contract API unchanged **OR** `docs/api-changelog.md` updated with migration notes
- [ ] Storage layout unchanged **OR** ADR documenting the migration path added
- [ ] No removal or rename of public entry-point functions without a deprecation notice

---

## Checklist

- [ ] Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/)
- [ ] `make lint` passes locally (zero Clippy warnings)
- [ ] `cargo fmt --all -- --check` passes
- [ ] No new dependencies added without prior discussion (see [SBOM policy](../docs/sbom.md))
- [ ] PR title is ≤ 70 characters and uses a conventional commit prefix (`feat:`, `fix:`, `docs:`, etc.)

---

<!-- Emergency merges only — delete this section if not applicable -->
## Emergency Merge

**Reason:**
**Incident link:**
**Follow-up PR:**
