# SBOM & License Compliance

This document explains how Software Bill of Materials (SBOM) artifacts are generated for each release and how license compliance is enforced in CI.

---

## What is an SBOM?

A Software Bill of Materials is a formal, machine-readable inventory of every software component and its declared license. SBOMs are required by an increasing number of enterprise customers and government frameworks (e.g., US Executive Order 14028). This project produces SBOMs in **SPDX 2.3 JSON** format, the most widely supported open standard.

---

## SBOM Files

Each GitHub Release includes four SBOM files as attached assets:

| File | Contents |
|------|----------|
| `sbom.spdx.json` | Merged SBOM combining all three scopes below |
| `sbom-rust.spdx.json` | Cargo / Rust dependencies only |
| `sbom-node-root.spdx.json` | Root `package.json` dependencies (Storybook tooling) |
| `sbom-node-frontend.spdx.json` | `frontend/package.json` dependencies (React app) |

The combined `sbom.spdx.json` is the primary artifact for auditors.

### Accessing SBOMs

Download from any release page:

```bash
gh release download v1.2.3 --pattern "sbom*.spdx.json"
```

Or from the [Releases](https://github.com/your-org/vesting-cliff-drip-stream/releases) page directly.

---

## Generation Tooling

| Tool | Purpose |
|------|---------|
| [syft](https://github.com/anchore/syft) (`anchore/syft-action@v6`) | SPDX SBOM generation for Rust and Node.js packages |
| [cargo-license](https://github.com/onur/cargo-license) | Rust license scanning in CI (report generation) |
| [cargo-deny](https://github.com/EmbarkStudios/cargo-deny) | Rust license allowlist enforcement in CI |
| [license-checker](https://github.com/davglass/license-checker) | Node.js license scanning in CI |
| [grype](https://github.com/anchore/grype) | Vulnerability scanning of the generated SBOM |

SBOMs are regenerated on every release. The generation workflow is defined in [`.github/workflows/sbom.yml`](../.github/workflows/sbom.yml).

### How the SPDX file is generated

The SBOM is produced by **syft**, not by `cargo sbom`. There is no `cargo sbom` subcommand in the Cargo toolchain; `cargo-cyclonedx` provides a comparable output in CycloneDX rather than SPDX, and is not used here. To reproduce the release artifact locally:

```bash
# Install syft once — https://github.com/anchore/syft/releases
curl -sSfL https://raw.githubusercontent.com/anchore/syft/main/install.sh | sh -s -- -b /usr/local/bin

# Generate the merged SPDX 2.3 JSON (this is sbom.spdx.json)
syft . -o spdx-json=sbom-local.spdx.json

# Per-scope variants, matching what the release workflow attaches
syft dir:.            -o spdx-json=sbom-rust.spdx.json
syft dir:./            -o spdx-json=sbom-node-root.spdx.json
syft dir:./frontend    -o spdx-json=sbom-node-frontend.spdx.json
```

`syft` walks the filesystem and the resolved dependency graph, so the Rust scope comes from `Cargo.lock` and the Node.js scopes from each `package-lock.json`. Run it from a clean checkout: stale `target/` and `node_modules/` directories change the output, and `syft` will happily catalogue whatever it finds.

Verify the result against the released artifact before publishing:

```bash
jq -S '.[].name' sbom-local.spdx.json | sort > /tmp/local.txt
jq -S '.packages[].name' sbom.spdx.json  | sort > /tmp/released.txt
diff /tmp/local.txt /tmp/released.txt
```

### How the SBOM is attached to releases

`sbom.yml` runs on release and uploads the four SPDX files as release assets, using `softprops/action-gh-release`. Each file is a separate asset so a consumer can take the Rust-only or Node-only scope without parsing the merged document. The merged `sbom.spdx.json` is the primary artifact for auditors; the per-scope files exist so a Rust consumer is not forced to reconcile a mixed-language graph.

---

## License Policy

The project's license policy is defined in [`.license-policy.json`](../.license-policy.json) at the repository root. It is the authoritative source for CI enforcement.

### Allowed Licenses

The following licenses are approved for use in all dependencies (runtime and development):

| License | SPDX ID |
|---------|---------|
| MIT | `MIT` |
| MIT No Attribution | `MIT-0` |
| Apache 2.0 | `Apache-2.0` |
| Apache 2.0 + LLVM exception | `Apache-2.0 WITH LLVM-exception` |
| 2-clause BSD | `BSD-2-Clause` |
| 3-clause BSD | `BSD-3-Clause` |
| ISC | `ISC` |
| Zero-clause BSD | `0BSD` |
| The Unlicense | `Unlicense` |
| Creative Commons Zero 1.0 | `CC0-1.0` |
| Blue Oak 1.0 | `BlueOak-1.0.0` |
| zlib | `Zlib` |
| Unicode DFS 2016 | `Unicode-DFS-2016` |
| Unicode 3.0 | `Unicode-3.0` |

### Disallowed Licenses

The following licenses are **rejected** by CI:

| License family | SPDX IDs |
|----------------|----------|
| GNU GPL v2 | `GPL-2.0`, `GPL-2.0-only`, `GPL-2.0-or-later` |
| GNU GPL v3 | `GPL-3.0`, `GPL-3.0-only`, `GPL-3.0-or-later` |
| GNU LGPL v2/v2.1 | `LGPL-2.0*`, `LGPL-2.1*` |
| GNU LGPL v3 | `LGPL-3.0`, `LGPL-3.0-only`, `LGPL-3.0-or-later` |
| GNU AGPL v3 | `AGPL-3.0`, `AGPL-3.0-only`, `AGPL-3.0-or-later` |
| Server Side Public License | `SSPL-1.0` |
| Business Source License | `BUSL-1.1` |
| Proprietary / Closed source | `Proprietary` |

**Rationale:** Copyleft licenses (GPL, LGPL, AGPL) impose obligations that can propagate to downstream users of the compiled WASM or JavaScript bundles. To keep the project freely usable by enterprise consumers, only permissive licenses are allowed.

### Dual-Licensed Packages

For packages with dual licenses expressed as SPDX OR (`MIT OR Apache-2.0`), the CI scanner accepts the package if **at least one** of the options is in the allowed list. For AND expressions, **all** parts must be allowed.

### Explicit Exceptions

Individual packages may be granted an exception via the `explicit_exceptions` array in `.license-policy.json`. Each exception requires:

- `package`: exact package name
- `license`: the license string that triggered the exception
- `reason`: justification
- `approved_by`: team or individual who reviewed it
- `approved_date`: ISO 8601 date of approval

Exceptions should be reviewed annually. When in doubt, raise a pull request and tag the security team for review.

---

## License Scanning in CI

The `License Scan` workflow ([`.github/workflows/license-scan.yml`](../.github/workflows/license-scan.yml)) runs on every pull request and push to `main`. It has four parallel jobs:

| Job | Scope | Tool |
|-----|-------|------|
| `rust-licenses` | All Cargo dependencies | `cargo-license` + Python policy check |
| `rust-deny` | All Cargo dependencies | `cargo-deny` against [`deny.toml`](../deny.toml) |
| `node-licenses-root` | Root `package.json` | `license-checker` + Node.js policy check |
| `node-licenses-frontend` | `frontend/package.json` | `license-checker` + Node.js policy check |

### The two Rust checkers, and why both run

The policy has a single authoritative definition, [`.license-policy.json`](../.license-policy.json). It is enforced twice, by two independent mechanisms:

- **`cargo-license` + Python** generates a full licence report and a script compares each package against the allowlist. This is the original mechanism. It produces an auditable artifact (uploaded for 30 days) and it is the check that reports *every* package, so it is what you read when a build fails.
- **`cargo-deny`** evaluates the same allowlist natively, from [`deny.toml`](../deny.toml). It does not need the report to be generated first, and it distinguishes a *disallowed* licence from an *unclassified* one — so a newly-introduced GPL dependency produces `disallowed license` rather than a generic `unlicensed crate`.

They overlap deliberately. A policy edit that satisfies one but not the other fails the build, which is the point: two independent transcriptions of the same allowlist will not drift together without someone noticing. `deny.toml` is a hand-maintained transcription of `.license-policy.json`; **if you change the allowlist, change both.** Nothing currently verifies they agree, so treat a policy change as a two-file edit.

`deny.toml` also contains `advisories`, `bans`, and `sources` configuration, but those sections are deliberately left permissive. CI runs `cargo deny check licenses` and *not* a bare `cargo deny check`, so only the licence allowlist is enforced. Narrowing the other sections is a separate decision that should get its own review.

Run it locally:

```bash
cargo install cargo-deny --locked
cargo deny check licenses
```

### Failure behavior

- A dependency with a **disallowed** license causes an immediate failure with a `FAIL` prefix line in the log, and a `disallowed license` error from `cargo-deny`.
- A dependency with an **unknown** license (not in the allowed or disallowed list) also fails, requiring the policy to be updated.
- Packages listed in `explicit_exceptions` are printed as `SKIP` and do not cause failure. For `cargo-deny` the equivalent is an `[[licenses.exceptions]]` entry in `deny.toml`.
- Raw license reports (`*.json`) are uploaded as workflow artifacts for 30 days, regardless of pass/fail.

### Handling a crate cargo-deny cannot classify

Some crates ship a licence expression that is not valid SPDX — `ring` uses `ISC AND OpenSSL`. `cargo-deny` cannot classify those without help, and reports them as `unlicensed` regardless of whether the licence is acceptable.

Two separate entries are needed, and the distinction matters:

- `[[licenses.clarify]]` restates the expression so the crate can be parsed. It says "this is the licence expression", not "this is approved".
- `[[licenses.exceptions]]` is the actual approval. It says "and we have reviewed it".

A `clarify` without an accompanying exception leaves the crate admitted-but-unclassified, which is not the same as reviewed. `deny.toml` includes both for `ring`, matching the `explicit_exceptions` entry in `.license-policy.json`.

### Adding a new dependency

1. Add the dependency as normal.
2. Run the license scan locally to check compliance:

   **Rust:**
   ```bash
   cargo install cargo-license --locked
   cargo license
   ```

   **Node.js:**
   ```bash
   npm install -g license-checker
   license-checker --summary       # root
   cd frontend && license-checker --summary  # frontend
   ```

3. If the new dependency has an unlisted license, either:
   - Add the license to the `allowed` list in `.license-policy.json` (if it is genuinely permissive), or
   - Add an entry to `explicit_exceptions` with a justification and get it reviewed.

---

## Release Notes Summary

Every release automatically includes a **Dependency & License Summary** section appended to the release body by the `release-notes-summary` job in [`.github/workflows/release.yml`](../.github/workflows/release.yml). It shows:

- Package count per scope (Rust, root Node.js, frontend Node.js)
- License distribution table for each scope

This gives downstream users a quick at-a-glance view of what's in the release without having to parse the SBOM file.

---

## Contributor Guide — Adding Dependencies

This section explains how to add, verify, and document new dependencies in compliance with the project's license policy.

### 1. Check if the dependency's license is approved

Before adding a dependency, verify its license against the [approved list](#allowed-licenses) above.

**Rust (Cargo):**
```bash
cargo install cargo-license --locked
cargo license | grep -i '<package-name>'
```

**Node.js:**
```bash
npm info <package-name> license          # quick check
license-checker --summary --production   # full scan (root)
cd frontend && license-checker --summary --production  # frontend
```

If the license SPDX ID appears in the **allowed** list, you can proceed. If it appears in the **disallowed** list, you cannot use the package — find an alternative.

### 2. Request approval for a new license type

If the dependency uses a license not in either list:

1. Open a GitHub issue with the `security` label.
2. Include:
   - Package name and version
   - SPDX license identifier (exact string)
   - Why you need this dependency
   - Whether a permissive alternative exists
3. The security team will review and either:
   - Add the license to the `allowed` list in `.license-policy.json`, or
   - Grant an `explicit_exceptions` entry with justification.

### 3. Regenerate the SBOM locally

After adding dependencies, regenerate the SBOM to verify it produces a clean artifact:

```bash
# Install syft (one-time)
curl -sSfL https://raw.githubusercontent.com/anchore/syft/main/install.sh | sh -s -- -b /usr/local/bin

# Generate SBOM
syft . -o spdx-json=sbom-local.spdx.json

# Verify against the release SBOM
diff <(jq '.packages[].name' sbom-local.spdx.json | sort) \
     <(jq '.packages[].name' sbom.spdx.json | sort)
```

### 4. Handle copyleft transitive dependencies

If a **transitive** dependency (a dependency of a dependency) carries a copyleft license:

1. **Do not merge** the PR until the issue is resolved.
2. Check if a newer version of the direct dependency uses a permissive alternative.
3. If no alternative exists, open an issue tagged `security` requesting a waiver.
4. Waivers require:
   - Confirmation that the copyleft code is not linked into the final WASM/JS bundle
   - Or an `explicit_exceptions` entry with a time-bound review date

### 5. Quarantine procedure for dependencies with known CVEs

When a dependency has a known CVE:

1. **Check severity:** Use `cargo audit` (Rust) or `npm audit` (Node.js).
2. **Critical / High:** Block the PR. Upgrade to a patched version or remove the dependency.
3. **Medium / Low:** Document in the PR description. Open a follow-up issue to upgrade.
4. **Transitive dependency CVE:** Check if upgrading the direct dependency resolves it.

```bash
# Rust
cargo install cargo-audit --locked
cargo audit

# Node.js
npm audit --omit=dev
cd frontend && npm audit --omit=dev
```

> **Rule:** A dependency with a CVE scoring ≥ 9.0 (Critical) must be upgraded or removed before the PR can merge.

---

## Verifying an SBOM

To verify a downloaded SBOM against the actual source tree, install [syft](https://github.com/anchore/syft) locally and regenerate:

```bash
syft . -o spdx-json=sbom-local.spdx.json
```

Then diff it against the published SBOM. Minor differences in timestamps and document namespace are expected; the `packages` array should match the release tag's lockfiles.

To query the SBOM with [grype](https://github.com/anchore/grype) for vulnerabilities:

```bash
grype sbom:sbom.spdx.json
```
