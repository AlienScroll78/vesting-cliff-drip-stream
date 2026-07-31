# Contributing to Vesting Cliff Drip Stream

Thank you for contributing! This guide covers everything you need to go from a clean checkout to an approved PR.

---

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Rust | stable (≥ 1.78) | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` |
| wasm32 target | — | `rustup target add wasm32-unknown-unknown` |
| Stellar CLI | ≥ 21.x | [Install guide](https://developers.stellar.org/docs/tools/developer-tools/cli/install-cli) |
| Node.js | ≥ 20 (frontend / E2E only) | [nodejs.org](https://nodejs.org) |
| Docker | any recent (E2E only) | [docs.docker.com](https://docs.docker.com/get-docker/) |

Verify your setup:

```bash
rustc --version          # rustc 1.x.x (...)
cargo --version
rustup target list --installed | grep wasm32-unknown-unknown
stellar --version
```

---

## Getting Started

```bash
git clone https://github.com/AlienScroll78/vesting-cliff-drip-stream.git
cd vesting-cliff-drip-stream
```

No additional `npm install` or database setup is required for contract work.  
For frontend work, run `cd frontend && npm install`.

---

## Build

```bash
# Compile the contract to WASM
make build

# Optimize the WASM binary (requires stellar CLI)
make optimize
```

The optimized binary is written to `target/vesting_cliff_drip_stream.optimized.wasm`.

---

## Tests

```bash
# Run all unit tests (native target)
make test

# Validate the on-chain contract spec
make spec-test        # builds WASM first automatically

# Lint (clippy, zero warnings policy)
make lint

# Format check
cargo fmt --all -- --check

# Frontend unit tests
cd frontend && npm test

# Playwright E2E (UI)
make test-e2e-ui

# Full E2E against local Stellar quickstart (requires Docker)
make test-e2e
```

CI runs `fmt`, `lint`, `test`, and `build` on every push. All checks must be green before a PR can merge.

---

## Code Style

**Rust**
- Follow `rustfmt` defaults — enforced by `cargo fmt --all`.
- Clippy with `--all-targets --all-features -- -D warnings` must pass with zero warnings.
- Use `checked_*` arithmetic for any value that can overflow.
- Add a doc comment (`///`) to every public function and type.

**TypeScript / CSS**
- Match the style of the surrounding file.
- No new dependencies without discussion in an issue first.

**Commit messages** — [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add multi-token support
fix: clamp claimable amount at stream end
docs: update restore runbook
chore: bump soroban-sdk to 22.0
```

Append `!` or add `BREAKING CHANGE:` in the footer for breaking changes.

---

## Changelog and Release Notes

This repository maintains a structured `CHANGELOG.md` and uses a standardized release notes template in `.github/release-notes-template.md`.

### What goes in each section
- `Breaking Changes`: incompatible API or behavior changes, required migrations, or removals. Use `BREAKING CHANGE:` in the commit body or `!` in the commit header.
- `New Features`: new entry points, view functions, UI behavior, or capabilities added in a backwards-compatible way. Use `feat:`.
- `Bug Fixes`: correctness fixes, stability improvements, and bug resolutions. Use `fix:`.
- `Security`: vulnerability fixes, hardening, and security-related remediation. Use `security:`.
- `Deprecations`: deprecated APIs, behaviors, or configuration that will be removed in a future major release. Use `deprecate:` or `feat!:` with a clear deprecation note.
- `Performance`: measurable performance or efficiency improvements. Use `perf:`.
- `Miscellaneous`: internal maintenance, tooling, docs, and other non-user-facing work. These are hidden in the changelog when generated automatically.

### Writing changelog entries
- Use short, imperative phrasing: `Add ...`, `Fix ...`, `Deprecate ...`.
- Describe the impact for users or operators, not just implementation details.
- Reference issues and PRs using `#123`, `PR #456`, or `owner/repo#123` when relevant.
- Prefer `Closes #<issue>` in PR descriptions to link issues automatically.
- Use backticks for code artifacts: `create_vesting_stream`, `VestingSchedule`, `CliffNotReached`.

### Semantic versioning policy
- `MAJOR` bump for incompatible API/behavior changes, removals, or any `BREAKING CHANGE:` commit.
- `MINOR` bump for new features and backwards-compatible improvements.
- `PATCH` bump for bug fixes, documentation changes, tests, and non-behavioral maintenance.
- Let release automation infer the release type from commit metadata when possible.

### Release automation
- This repository uses `release-please` and the configuration in `release-please-config.json`.
- `release-please` reads commit types and changelog sections from `release-please-config.json` to generate release PRs, tags, and changelog entries.
- Breaking changes are inferred from `!` in commit headers or `BREAKING CHANGE:` in commit bodies.
- Keep PR titles, commit messages, and changelog entries aligned with the section conventions above.

---

## Submitting a Pull Request

1. Fork or create a feature branch: `git checkout -b feat/<short-description>`
2. Make your changes and write tests for new behaviour.
3. Run `make test && make lint` locally — fix any failures before pushing.
4. Open a PR against `main` using the PR template.
5. Address review feedback; keep the branch up to date with `main`.
6. Squash-merge preferred; no force pushes to shared branches.

---

## Branch Protection on `main`

| Rule | Setting |
|------|---------|
| Require pull request | ✅ |
| Required approving reviews | 1 |
| Dismiss stale reviews on new push | ✅ |
| Require CI to pass before merge | ✅ (`test`, `build` checks) |
| Require branch to be up to date | ✅ |
| Allow force push | ❌ |
| Allow branch deletion | ❌ |

To (re-)apply protection rules after a fresh clone:

```bash
export GITHUB_TOKEN=<pat-with-repo-scope>
export REPO=AlienScroll78/vesting-cliff-drip-stream
bash scripts/apply_branch_protection.sh
```

---

## Admin Override

Admins can merge without a review in exceptional circumstances (incident hotfix, CI outage):

1. `enforce_admins: false` allows admins to bypass review requirements.
2. **Document the reason** in the PR using the `## Emergency Merge` section.
3. Follow up within 24 hours with a normal PR that adds or confirms tests.
4. Post a note in `#eng-oncall` linking the PR.

---

## Stellar Wave Program

This repository participates in the **[Stellar Wave Program](docs/stellar-wave.md)** — a monthly one-week contribution sprint run by the [Stellar Development Foundation](https://stellar.org/foundation) via [Drips Wave](https://drips.network/wave). Contributors earn a share of a reward pool for resolving labelled issues.

### Finding Wave issues

Issues in scope for the current Wave carry the **`Stellar Wave`** label. Browse them directly:

```
https://github.com/AlienScroll78/vesting-cliff-drip-stream/labels/Stellar%20Wave
```

Or discover issues across all participating repos on the [Drips Wave Explore page](https://drips.network/wave).

### Quick-start for contributors

1. Complete **KYC** in [Settings → Profile](https://drips.network/wave) on the Drips Wave app (required before applying).
2. Find an issue with the `Stellar Wave` label and click **Apply** in the app with a short message.
3. Wait to be assigned — do not start coding until the maintainer assigns you.
4. Open a PR against `main` following the standard workflow above.
5. Include `Closes #<issue-number>` in your PR description — this is how Points are allocated.
6. After the Wave ends, withdraw your rewards from the Drips Wave app.

### Points and rewards

| Complexity | Points |
|------------|--------|
| Trivial    | 100    |
| Medium     | 150    |
| High       | 200    |

Your payout = `(your points / total points in wave) × reward budget`.

### The `Stellar Wave` label

The label is applied by **maintainers only**, either through the Drips Wave app or directly on GitHub. Do not add or remove it yourself.

For the full details — qualifying criteria, submission requirements, application limits, and FAQ — see **[docs/stellar-wave.md](docs/stellar-wave.md)**.

---

## Security Issues

Please **do not** open a public issue for security vulnerabilities. See [SECURITY.md](SECURITY.md) for the responsible-disclosure process.

---

## Code of Conduct

This project follows the [Contributor Covenant 2.1](CODE_OF_CONDUCT.md). Be kind.
