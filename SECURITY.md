# Security Policy

This document describes the security policy for the `vesting-cliff-drip-stream` project, including how to report vulnerabilities, our response commitments, safe harbor protections, and bug bounty program.

---

## Scope

The following components are **in scope** for vulnerability reports:

| Component | Description |
|-----------|-------------|
| **Smart Contract** | The Soroban/Stellar smart contract in `src/` (all entry-points, storage, arithmetic, auth logic) |
| **Backend API** | The event indexer and API server that reads from Horizon and serves indexed data |
| **Frontend** | The web application UI that interacts with wallets and the contract |
| **Infrastructure / Terraform** | AWS infrastructure configuration in `terraform/` (IAM roles, ECS tasks, RDS, VPC, networking) |

---

## Out of Scope

The following are **not eligible** for bounty and may be closed without action:

- **Third-party dependencies** — vulnerabilities in upstream crates, npm packages, or AWS-managed services. Report these directly to the upstream maintainer.
- **Testnet-only issues** — findings that are only reproducible on Stellar Testnet or Futurenet and have no plausible mainnet impact.
- **Forked or undeployed code** — branches, forks, or experimental code that has not been merged to `main` and deployed to production.
- **Denial-of-service via resource exhaustion** — flooding the RPC node or Horizon API with high-volume requests.
- **Social engineering** — attacks targeting employees, contributors, or users rather than the technical systems.
- **Physical attacks** — requiring physical access to infrastructure or end-user devices.
- **Theoretical vulnerabilities without a working proof-of-concept** — purely speculative or model-based claims without reproducible evidence.
- **Informational findings with no exploitable impact** — e.g., missing HTTP headers on non-sensitive endpoints, version disclosure in response headers.
- **Self-XSS** — cross-site scripting that requires the attacker to inject their own payload into their own session.
- **Issues already publicly disclosed** — including those listed in the [Known Issues](#known-issues) section below.

---

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

You have two options for confidential disclosure:

### Option 1 — GitHub Private Security Advisory (preferred)

Use GitHub's built-in private advisory workflow:

[**Open a Private Security Advisory →**](https://github.com/AlienScroll78/vesting-cliff-drip-stream/security/advisories/new)

This allows collaborative, confidential discussion directly on GitHub and automatically creates a draft CVE when appropriate.

### Option 2 — Email

Send a report to **security@drips.finance**.

Please include as much of the following as possible:

- A clear description of the vulnerability and its potential impact
- The affected component(s) and version or commit hash
- Step-by-step reproduction instructions
- Any proof-of-concept code, transaction payloads, or screenshots
- Your assessment of severity (Critical / High / Medium / Low)
- Whether you have already publicly disclosed or plan to disclose this finding

For sensitive reports, you may encrypt your email using our PGP key. See the [PGP Key](#pgp-key) section below.

---

## Response SLA

We are committed to the following response timeline after a report is received:

| Milestone | Target |
|-----------|--------|
| **Acknowledgement** | Within **24 hours** of receipt |
| **Triage & severity assessment** | Within **72 hours** of receipt |
| **Patch or mitigation — Critical** | Within **7 days** of confirmed triage |
| **Patch or mitigation — High** | Within **30 days** of confirmed triage |
| **Patch or mitigation — Medium / Low** | Best-effort; scheduled in the next regular release cycle |

We will keep you informed of progress throughout the remediation process. If we need additional information to reproduce or assess the issue, we will reach out within the triage window.

We ask that you observe **coordinated disclosure**: please allow us the remediation window above before publishing details of the vulnerability. We will coordinate a public disclosure date with you once a fix is available.

---

## Safe Harbor

We consider security research conducted in good faith on in-scope systems to be authorized and will not pursue civil or criminal action against researchers who:

- Make a genuine effort to avoid privacy violations, degradation of user experience, disruption to production systems, and destruction of data.
- Only interact with accounts and contracts they own or have explicit permission to test (e.g., your own Testnet wallet and a locally deployed contract instance).
- Do not access, modify, or exfiltrate data belonging to other users.
- Report discovered vulnerabilities through the channels described in this document as promptly as possible.
- Do not exploit a vulnerability beyond what is minimally necessary to confirm its existence.
- Do not demand payment before disclosing a vulnerability.

Good-faith researchers who comply with these conditions will receive our public acknowledgement (if desired), and we will work with you to understand and resolve the issue quickly.

If you are uncertain whether your research activity falls within this safe harbor, contact us at **security@drips.finance** before proceeding.

---

## Bug Bounty Program

We offer monetary rewards for valid, in-scope vulnerability reports. Severity is assessed using [CVSS v3.1](https://www.first.org/cvss/calculator/3.1) in combination with the specific context of the smart contract and financial protocol.

| Severity | Criteria (examples) | Reward |
|----------|---------------------|--------|
| **Critical** | Arbitrary theft of locked tokens; bypassing `require_auth` to cancel or claim on behalf of another user; re-entrancy enabling double-spend; logic flaw allowing unlimited minting or infinite claims | **$10,000 USD** |
| **High** | Incorrect vesting math resulting in material over- or under-payment; cliff bypass allowing premature claim; admin privilege escalation; RDS injection or authentication bypass in the backend API | **$5,000 USD** |
| **Medium** | Denial-of-service against a specific stream (preventing legitimate claims); incorrect event emission misleading the indexer; SSRF or moderate-severity infrastructure misconfiguration | **$1,000 USD** |
| **Low** | Minor informational leakage; cosmetic UI issues; low-impact logic deviations with no financial consequence | **Public recognition** in our [CHANGELOG.md](CHANGELOG.md) and Hall of Fame (if desired) |

### Bounty Terms

- Rewards are paid in **USDC on Stellar mainnet** or USD wire transfer at the researcher's preference.
- Only the **first reporter** of a given vulnerability is eligible for a reward.
- Rewards are issued after a fix has been deployed and verified.
- Employees, contractors, and immediate family members of the project are not eligible.
- We reserve the right to adjust severity and reward based on actual exploitability and impact in context.
- Vulnerabilities submitted through non-confidential channels (e.g., public GitHub issues) are not eligible.

---

## Known Issues

The following issues are **known, accepted, and not eligible for bounty**:

### 1. Integer Truncation in Rate × Duration for Very Large Values

For extremely large `rate` and `total_duration` values that approach `i128::MAX`, intermediate multiplication may truncate or overflow. This is documented as an accepted risk:

> **Overflow boundary**: The maximum valid deposit rate for a given duration is `i128::MAX / total_duration`; one unit above that returns `DepositOverflow` (error code 5).

The contract uses checked arithmetic (`checked_mul`, `checked_add`) throughout to return `DepositOverflow` rather than silently wrap. The truncation is therefore surfaced as an explicit error and not an exploitable silent integer overflow. See the [Security Considerations](README.md#security-considerations) section of the README and the relevant [ADR](docs/adr/README.md) for the full rationale.

### 2. `drain_expired_stream` is Permissionless by Design

The `drain_expired_stream` entry-point (error reference: `StreamNotExpired`, code 8; `DrainDelayNotExpired`, code 10) is callable by **any address** after `end_ledger + 6,307,200` ledgers (~1 year) have elapsed. This is an intentional design decision to allow permissionless cleanup of abandoned streams and return unclaimed tokens to the original sponsor. No authentication is required from the caller, and no funds flow to the caller — tokens are always returned to the original sponsor. This behavior is documented in the [Contract API](README.md#drain_expired_stream) section and in the architecture decision records.

---

## PGP Key

For encrypted email submissions, please use our security team's PGP public key.

**Key details:**

```
Key ID:      <REPLACE WITH KEY ID>
Fingerprint: <REPLACE WITH FULL FINGERPRINT>
Algorithm:   Ed25519 / Curve25519
Expires:     <REPLACE WITH EXPIRY DATE>
```

**Public key block:**

```
-----BEGIN PGP PUBLIC KEY BLOCK-----

<REPLACE THIS BLOCK WITH THE EXPORTED ARMORED PUBLIC KEY>
-----END PGP PUBLIC KEY BLOCK-----
```

> **Maintainer instructions:** Replace the placeholders above with the actual PGP key details before publishing. Generate a dedicated security key (`gpg --full-generate-key`), upload it to `keys.openpgp.org`, and export it with `gpg --armor --export <KEY_ID>`. Rotate the key annually and update this file accordingly. Do not use a personal key or a key also used for code signing.

You may also retrieve the key directly from the keyserver:

```
gpg --keyserver keys.openpgp.org --recv-keys <REPLACE WITH KEY ID>
```

---

## Hall of Fame

We gratefully acknowledge researchers who have responsibly disclosed vulnerabilities to us. If you would like to be listed here, let us know in your report.

| Researcher | Finding | Disclosed |
|------------|---------|-----------|
| *(none yet)* | — | — |

---

*This policy was last reviewed on 2026-09-29. For questions about this policy, contact security@drips.finance.*
