---
id: index
title: Vesting Cliff Drip Stream
sidebar_label: Introduction
slug: /
---

# Vesting Cliff Drip Stream

[![Coverage](https://img.shields.io/badge/coverage-90%25-green?logo=rust)](./coverage/README)

A production-ready **Soroban smart contract** that combines a **time-locked cliff** with **linear token streaming** for long-term contributor retention on the Stellar network.

---

## What Is This?

Standard token streams release tokens immediately. This contract adds a mandatory **cliff period** before any tokens can be claimed, ensuring contributors remain aligned with the project before unlocking value.

```
Token Flow
──────────────────────────────────────────────────────────────────────
Ledger:   start_ledger      cliff_ledger                  end_ledger
               │                 │                              │
Tokens:        │   [locked]      │  ← instant catch-up claim → │ ← linear drip ──┤
               │                 │                              │
```

1. **Sponsor** deposits the full allocation upfront into the contract vault.
2. Recipient cannot claim anything until `cliff_ledger` is reached.
3. At the cliff, all tokens accrued since `start_ledger` are **released instantly**.
4. Remaining tokens continue to **drip linearly per ledger** until `end_ledger`.

---

## Quick Navigation

| Section | Description |
|---------|-------------|
| [Developer Onboarding](./developer-onboarding) | Set up your local environment |
| [Walkthrough Guide](./walkthrough-guide) | End-to-end tutorial |
| [API Reference](./api-reference) | All contract entry-points and view functions |
| [Architecture](./architecture) | System design and Mermaid diagrams |
| [Error Handling](./error-handling) | All 26 error codes with recovery guidance |
| [Glossary](./glossary) | Key terms defined |
| [FAQ](./faq) | Common questions about lifecycle, claiming, tokens, and fees |
| [Runbooks](./runbooks/README) | Operational procedures |
| [ADRs](./adr/README) | Architecture Decision Records |

---

## Key Links

- **[Comparison vs. Standard Drips](./comparison)** — feature table, cancel behaviour, migration instructions
- **[Security Model](./security/security-model)** — auth, overflow protection, duplicate prevention, TTL management
- **[SBOM](./sbom)** — Software Bill of Materials and license policy
- **[CI/CD](./ci-cd)** — full pipeline documentation

---

> Coming from standard Drips? See the [comparison guide](./comparison) for a feature table, cancel behaviour details, and migration instructions.
>
> Have a question? Check the [FAQ](./faq) for common answers about stream lifecycle, claiming, token support, and fees.
