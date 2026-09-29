# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.x.x   | ✅ Actively supported |
| < 1.0   | ❌ Not supported |

Security patches are backported to the latest stable `1.x` release only.
Users on older versions are strongly encouraged to upgrade.

---

## Scope

The following components are **in scope** for vulnerability reports:

| Component | Location | Examples of in-scope issues |
|-----------|----------|-----------------------------|
| Soroban smart contract | `src/` | Auth bypass, arithmetic overflow, incorrect vesting math, reentrancy |
| Backend API server | `backend/` | Injection, broken auth, data exposure, insecure deserialization |
| Frontend application | `frontend/` | XSS, CSRF, private key leakage via UI |
| CI/CD pipeline | `.github/workflows/` | Secret exposure, supply-chain attacks |
| Infrastructure (Terraform / Kubernetes) | `terraform/`, `k8s/`, `helm/` | Privilege escalation, publicly exposed admin endpoints |

### Out of Scope

The following are **not eligible** for bounty rewards and should not be reported:

- Vulnerabilities in third-party dependencies that are already publicly known (please open a
  standard dependency update PR instead).
- Issues affecting only the Stellar **testnet** deployment with no mainnet path.
- Denial-of-service attacks that require a large volume of legitimate transactions.
- Social engineering, phishing, or attacks requiring physical access to a device.
- Missing security headers or rate-limit configurations on non-production endpoints.
- Bugs that require the attacker to already control the victim's private key.
- Reports generated entirely by automated scanners with no manual triage or proof of
  exploitability.
- Theoretical vulnerabilities without a demonstrated impact.

---

## Reporting a Vulnerability

**Please do NOT report security vulnerabilities through public GitHub issues or pull requests.**
Public disclosure before a patch is available puts all users at risk.

### Preferred channel

Submit a **GitHub private security advisory** directly in this repository:

[→ Open a private security advisory](https://github.com/AlienScroll78/vesting-cliff-drip-stream/security/advisories/new)

This keeps the report confidential, allows the maintainers to collaborate privately with you,
and creates a permanent audit trail.

### Alternative channel (encrypted email)

If you prefer email, send your report to **security@example.com**.  
Encrypt sensitive reports using the PGP key below (see [PGP Key](#pgp-key)).

### What to include

A high-quality report significantly speeds up triage. Please include:

1. **Component affected** — contract, backend, frontend, infra, CI.
2. **Vulnerability class** — e.g. auth bypass, integer overflow, SQL injection.
3. **Steps to reproduce** — minimal, numbered, copy-paste steps.
4. **Proof of concept** — code, a transaction hash, or a curl command demonstrating impact.
5. **Impact assessment** — what an attacker can achieve and which users are affected.
6. **Suggested fix** — optional but appreciated.

---

## Response SLA

| Milestone | Commitment |
|-----------|-----------|
| **Acknowledgement** | Within **24 hours** of receipt |
| **Triage and severity assignment** | Within **72 hours** of acknowledgement |
| **Patch for Critical / High** | Within **7 calendar days** of confirmation |
| **Patch for Medium** | Within **30 calendar days** of confirmation |
| **Patch for Low / Informational** | Addressed in the next scheduled release |
| **Public disclosure** | Coordinated with reporter; default **90 days** after patch release |

If we are unable to meet a deadline, we will notify you promptly and agree on an extension.

---

## Safe Harbor

We consider security research conducted in good faith to be authorised activity. If you:

- Report the vulnerability to us before public disclosure,
- Do not access, modify, or exfiltrate data beyond what is necessary to demonstrate the issue,
- Do not degrade service availability or interfere with other users' streams, and
- Provide us a reasonable time to remediate before any public disclosure,

then we will **not pursue civil or criminal action** against you in connection with your
research, and we will work with you to understand and resolve the issue.

We ask that you:

- Only test against the Stellar **testnet** deployment or a local environment.
- Do not exploit a vulnerability beyond the minimum needed to prove it.
- Promptly notify us if you accidentally access any live user data.

---

## Bug Bounty

We operate a reward programme for responsibly disclosed vulnerabilities.
Rewards are paid in USDC or XLM on the Stellar network.

| Severity | Definition | Reward range |
|----------|-----------|-------------|
| **Critical** | Direct loss of funds, auth bypass that affects all users, contract exploit | Up to **$10,000** |
| **High** | Partial fund loss, privilege escalation, severe data exposure | Up to **$5,000** |
| **Medium** | Limited data exposure, denial-of-service, CSRF with meaningful impact | Up to **$1,000** |
| **Low / Informational** | Hardening improvements, minor misconfigurations | Acknowledgement + swag |

### Severity criteria

We use [CVSS v3.1](https://www.first.org/cvss/calculator/3.1) as a baseline and apply the
following contract-specific adjustments:

- **Exploits that drain the vault or allow unauthorised claiming** are always Critical,
  regardless of CVSS score.
- **Bugs that bypass `require_auth()`** for any state-mutating entry point are High or above.
- **Read-only data exposure** (e.g. leaking a recipient's unclaimed balance) is at most Medium.

Rewards are at the sole discretion of the maintainers. Duplicate reports (same root cause, first
reporter wins) and out-of-scope reports are not eligible.

---

## Known Issues and Accepted Risks

The following are known limitations that have been evaluated and accepted as acceptable risk.
Reports for these items will be closed as informational:

| Issue | Accepted risk reasoning |
|-------|------------------------|
| On-chain rollback not possible after contract upgrade | Soroban platform limitation; mitigated by the [emergency upgrade runbook](docs/runbooks/emergency-contract-upgrade.md) |
| TTL expiry of persistent storage entries | Mitigated by automatic TTL bumps on every read/write (documented in [ADR-0005](docs/adr/0005-ttl-persistent-storage-strategy.md)) |
| No on-chain pause mechanism for the entire contract | By design; individual streams can be paused via `pause_stream` |
| Sponsor can cancel a stream before the cliff without recipient consent | By design and documented in the contract API |

---

## PGP Key

Use this key to encrypt sensitive vulnerability reports sent to **security@example.com**.

```
-----BEGIN PGP PUBLIC KEY BLOCK-----

[Replace this placeholder with the team's actual PGP public key before publishing.
 Generate with: gpg --gen-key, then export with: gpg --armor --export security@example.com]

-----END PGP PUBLIC KEY BLOCK-----
```

Key fingerprint: `XXXX XXXX XXXX XXXX XXXX  XXXX XXXX XXXX XXXX XXXX`

---

## Security Update Process

1. A security patch is developed in a **private fork**.
2. The patch is reviewed by at least **two maintainers**.
3. A [GitHub Security Advisory](https://github.com/AlienScroll78/vesting-cliff-drip-stream/security/advisories)
   is drafted with CVE request if applicable.
4. The patch is merged, tagged, and released.
5. The advisory is published and users are notified through GitHub releases and the
   `#announcements` channel.
6. The `CHANGELOG.md` is updated with the CVE reference and affected versions.

---

## Contact

| Channel | Use for |
|---------|---------|
| [GitHub Security Advisories](https://github.com/AlienScroll78/vesting-cliff-drip-stream/security/advisories/new) | Preferred — confidential vulnerability reports |
| **security@example.com** | Alternative — encrypted email for sensitive reports |
| `#security` (internal Slack) | Maintainer coordination during active incidents |

For general (non-security) questions, open a [GitHub Discussion](https://github.com/AlienScroll78/vesting-cliff-drip-stream/discussions).
