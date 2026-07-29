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

## Security Issues

Please **do not** open a public issue for security vulnerabilities. See [SECURITY.md](SECURITY.md) for the responsible-disclosure process.

---

## Code of Conduct

This project follows the [Contributor Covenant 2.1](CODE_OF_CONDUCT.md). Be kind.
