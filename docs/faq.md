# Frequently Asked Questions (FAQ)

Clear answers to common questions about stream lifecycles, claiming tokens, supported assets, security, and fees. Written for recipients, sponsors, and community members.

---

## Table of Contents

1. [Getting Started](#getting-started)
2. [Claiming](#claiming)
3. [Streams](#streams)
4. [Security](#security)
5. [Fees](#fees)
6. [Glossary of Terms](#glossary-of-terms)
7. [Review & Feedback](#review--feedback)

---

## Getting Started

### Q: What is Vesting Cliff Drip Stream?

**A:** Vesting Cliff Drip Stream is a decentralized application on the Stellar blockchain designed to distribute tokens transparently over time. Instead of paying someone a lump sum or relying on manual monthly transfers, a sponsor locks tokens into an automated digital vault (a smart contract).

The contract enforces two rules:
1. **The Cliff:** A designated waiting period during which no tokens can be withdrawn.
2. **The Linear Drip:** Once the cliff ends, tokens unlock smoothly and continuously with each passing block (ledger) on the Stellar network until the stream completes.

For a full conceptual overview, see the [Project README](../README.md) and the step-by-step [Walkthrough Guide](walkthrough-guide.md).

---

### Q: What tokens are supported?

**A:** Any standard Stellar token or Soroban asset can be streamed, including:
- **USDC:** Digital dollar stablecoin commonly used for payroll and grants.
- **XLM:** The native cryptocurrency of the Stellar network.
- **Custom Assets:** Any custom governance token, utility token, or fiat-backed stablecoin issued on Stellar.

*Note:* Tokens must adhere to the standard Stellar Asset Contract (SAC) interface. Non-fungible tokens (NFTs) and tokens that automatically change balances (rebasing tokens) are not supported. For technical token details, consult the [Storage Layout](storage-layout.md) and [Developer Onboarding Guide](developer-onboarding.md).

---

### Q: What wallets do I need to get started?

**A:** Any Stellar wallet that supports Soroban smart contracts works. 
- For web browsers, **Freighter** is the recommended wallet extension.
- Mobile users can access the interface through mobile web browsers with compatible wallet connections.

You do not need to download special software beyond a regular crypto wallet. To connect your wallet, follow our [Wallet Integration Guide](wallet-integration.md).

---

### Q: Do I need an account or API key to receive tokens?

**A:** No. You only need a valid Stellar wallet address (`G...`). You do not need to sign up for an account, provide an email address, or obtain an API key. 

The smart contract identifies your stream solely by your Stellar wallet public key. If you are a developer looking to integrate programmatic streaming into your application, see our [API Reference](api-reference.md) and [Configuration Guide](config.md).

---

### Q: How does a sponsor create a stream?

**A:** A sponsor connects their wallet, deposits the total token amount upfront into the contract vault, and specifies:
1. The **recipient's wallet address**.
2. The **token** to stream.
3. The **cliff period** (e.g. 6 months).
4. The **total duration** of the stream (e.g. 24 months).

Once confirmed on the blockchain, the deposit is secure and the schedule begins immediately. Learn more in the [Walkthrough Guide](walkthrough-guide.md).

---

## Claiming

### Q: When can I claim?

**A:** You can claim your tokens **any time after the cliff period has passed**:
- **Before the cliff:** You cannot claim any tokens. Your claimable balance will show `0`.
- **At the exact cliff milestone:** All tokens that accrued from day one through the cliff date become instantly claimable in one single transfer.
- **After the cliff:** Tokens continue to unlock every few seconds (each ledger). You can claim them whenever you want—daily, weekly, monthly, or all at once at the end.

Check your current status using the dashboard or read our [Claiming Flows](flows.md).

---

### Q: What is a cliff?

**A:** A **cliff** is an initial freeze period built into a vesting schedule. During this timeframe, tokens accumulate in the background according to your agreed vesting rate, but they remain locked inside the contract vault and cannot be withdrawn.

*Why use a cliff?* Cliffs are standard in compensation and grant agreements. For example, in a 1-year contract with a 3-month cliff, an employee works 3 months before unlocking their first batch of tokens. On day 91, all 3 months' worth of earnings unlock at once.

To read more about cliff calculations, see the [Glossary](glossary.md) and [Walkthrough Guide](walkthrough-guide.md).

---

### Q: Why does my claimable amount show 0?

**A:** Your claimable balance will read `0` under three common conditions:
1. **The cliff has not arrived yet:** Tokens are accumulating, but are locked until the cliff ledger is reached.
2. **You recently made a claim:** If you just claimed a few minutes ago, only a tiny fraction of a token has unlocked since your last withdrawal.
3. **The stream has not started or has completed:** Check the stream start date and end date on your dashboard.

For error troubleshooting, refer to [Error Handling](error-handling.md).

---

### Q: How often should a recipient claim?

**A:** You can claim as frequently or as infrequently as you prefer:
- Unclaimed tokens **never disappear or expire** while the stream is active; they safely accumulate inside the contract vault.
- Every claim requires a standard blockchain network fee (fractions of a cent in XLM). Claiming weekly or monthly is often more convenient and cost-effective than claiming every hour.

See the [Walkthrough Guide](walkthrough-guide.md) for claiming best practices.

---

### Q: What happens on the first claim after the cliff?

**A:** The first claim after the cliff is known as the **catch-up claim**. All the tokens that accumulated between the start date and the cliff date are released together in a single lump sum transfer directly to your wallet. Subsequent claims will only transfer newly unlocked tokens.

See our architectural diagram in [Flows](flows.md).

---

### Q: Can multiple streams or recipients be claimed at once?

**A:** Yes. The web portal and backend API provide batch claiming utilities. Sponsors or organizations managing multiple streams can execute batch claims across multiple recipients in a single transaction.

Refer to the [API Reference](api-reference.md) for details on batch endpoints.

---

## Streams

### Q: Can streams be paused?

**A:** No. Streams **cannot be paused**. Once a stream is initiated, it executes continuously and deterministically according to the schedule configured on the blockchain. 

Neither the sponsor, the recipient, nor the contract developer can temporarily stop or freeze the accrual rate. A stream can only continue running, be cancelled by the sponsor under predetermined rules, or conclude at its designated end ledger.

See [Storage Architecture](storage.md) for schedule immutability details.

---

### Q: How do I cancel?

**A:** A stream can be cancelled by its **sponsor** before the stream reaches its completion date:
1. The sponsor calls the `cancel_stream` function via the web interface or CLI.
2. **What the recipient keeps:** Any tokens that have already vested up to that exact moment are automatically transferred to the recipient (or made available for immediate withdrawal).
3. **What the sponsor receives:** All unvested tokens remaining in the vault are refunded directly back to the sponsor's wallet.
4. If cancelled *before* the cliff, the recipient receives nothing, and 100% of deposited tokens return to the sponsor.

See [Flows: Cancellation](flows.md) and [Walkthrough Guide](walkthrough-guide.md).

---

### Q: What is the drain function?

**A:** The **drain function** (`drain_expired_stream`) is a safety cleanup mechanism for abandoned streams:
- When a stream reaches its full end date, the recipient is expected to claim their remaining tokens.
- If a recipient completely abandons their wallet and fails to claim their tokens after a prolonged grace period (the drain delay), the sponsor can invoke `drain_expired_stream` to recover the abandoned tokens rather than leaving them permanently stranded in the contract vault.
- As long as the recipient claims their tokens when the stream finishes, the drain function can never touch their funds.

Learn more in [Storage](storage.md) and [Contract Specifications](schema.md).

---

### Q: What happens if a stream expires and I haven't claimed?

**A:** When a stream reaches its ending ledger, token accrual stops. Your full remaining vested balance remains safely stored in the vault waiting for you. You can claim it at any time before the post-expiration drain delay window passes.

For details on expiration timestamps and ledger math, see [Flows](flows.md).

---

### Q: Can the drip rate or duration be changed after stream creation?

**A:** No. Standard vesting stream parameters (total deposit, rate per ledger, cliff duration, total duration) are strictly **write-once and immutable** after creation. This guarantees that neither party can alter terms midway. If terms must change, the sponsor must cancel the existing stream and deploy a new one.

For technical parameters, review [Storage Layout](storage-layout.md).

---

### Q: Can a recipient have more than one stream?

**A:** On a single contract deployment, each recipient wallet address is limited to **one active stream** at a time. If an employer or organization needs to establish multiple concurrent streams for one recipient (such as separate vesting schedules for base pay and bonus equity), a second contract instance can be deployed.

See [Storage Architecture](storage.md) for how stream keys are structured.

---

## Security

### Q: What happens if the sponsor disappears?

**A:** **Your vested tokens are 100% safe.** 

Because this application runs on a decentralized blockchain smart contract, 100% of the stream's tokens are deposited into the smart contract's vault at the moment the stream is created. The sponsor does not hold the funds, and the sponsor does not need to approve your claims. 

Even if the sponsor loses access to their account, shuts down their company, or disappears entirely, the smart contract continues running autonomously. As long as the cliff has passed, you can claim your earned tokens directly from the blockchain at any time.

Read our security assurances in [SECURITY.md](../README.md#security) and [Contract Security Architecture](../SECURITY.md).

---

### Q: What is a clawback?

**A:** A **clawback** is a specialized, compliance-oriented recovery mechanism permitted **only** when using Stellar tokens that have been specifically issued with the Stellar Asset Contract (SAC) clawback flag (`AUTH_CLAWBACK_ENABLED_FLAG`).
- Clawbacks are intended exclusively for strict regulatory or contractual compliance (such as sanctions enforcement or proven fraud).
- Standard tokens and normal community assets do not permit clawbacks.
- When an authorized clawback is executed, the sponsor must submit an on-chain audit reason (up to 256 characters) that is permanently recorded in the blockchain event log.

For legal and technical details, see [Contract Security](security/security-model.md) and [Storage Layout](storage-layout.md).

---

### Q: Can the contract be upgraded after deployment?

**A:** The contract implementation uses secure, transparent upgrade mechanisms. Any upgrade to the contract code requires cryptographic authorization from designated administration keys and emits immutable on-chain upgrade events. There are no silent or hidden modifications.

Operational upgrade runbooks are documented in [Contract Upgrade Runbook](runbooks/contract-upgrade.md) and [Deployment Environments](deployment-environments.md).

---

### Q: Can the contract be paused or drained by a backdoor admin?

**A:** **No.** The smart contract contains no backdoor keys, no emergency drain function for active streams, and no arbitrary seizure mechanisms. 

Funds deposited into the vault can only ever leave the vault through:
1. Legitimate recipient claims (`claim_vested`).
2. Sponsor cancellations with fair vesting payout (`cancel_stream`).
3. Authorized compliance clawbacks on clawback-enabled tokens (`clawback_stream`).
4. Inactivity recovery after prolonged abandonment (`drain_expired_stream`).

Inspect our security invariants in [SECURITY.md](../SECURITY.md).

---

### Q: What happens if my wallet is compromised or lost?

**A:** Because smart contracts interact directly with cryptographic wallet addresses, only the holder of the wallet's private keys can sign transactions to claim tokens. 
- Always back up your wallet recovery phrase (seed phrase) in a secure, offline location.
- If you lose your keys, no administrator can recover your private keys or redirect your stream to a new address.

For wallet safety recommendations, review [Wallet Integration](wallet-integration.md).

---

## Fees

### Q: Are there fees?

**A:** Interacting with the protocol involves two distinct types of fees:
1. **Network Transaction Fees (Gas):** Standard Stellar network fees required to process transactions on the blockchain. These fees are negligible—typically less than $0.0001 (fractions of an XLM) per claim or creation transaction.
2. **Protocol Fees:** An optional fee set in basis points (1 basis point = 0.01%) by the contract deployer, capped at a maximum of 500 bps (5%). If configured, this fee is deducted directly from vested payouts and routed to the community treasury.

Details on fee structures are documented in [Deployment Environments](deployment-environments.md) and [Configuration](config.md).

---

### Q: Who pays transaction fees when claiming or creating?

**A:** The party submitting the transaction to the Stellar network pays the tiny network fee:
- **Sponsors** pay the transaction fee when creating or cancelling a stream.
- **Recipients** pay the transaction fee when claiming their vested tokens.

Both parties need a small amount of XLM (e.g. 1 to 2 XLM is enough for thousands of transactions) in their wallet to cover network gas. See [Developer Onboarding](developer-onboarding.md).

---

### Q: Who receives protocol fees?

**A:** When protocol fees are enabled, collected fees are sent to the designated `fee_recipient` address established during contract initialization. This is typically a multi-signature treasury wallet or DAO fund dedicated to ongoing protocol maintenance and infrastructure.

See [Deployment Environments](deployment-environments.md#protocol-fees) for details on fee configuration.

---

### Q: How can I estimate network fees before executing a transaction?

**A:** You can preview transaction fees in two ways:
1. **Freighter Wallet Confirmation:** Before signing any transaction, your wallet displays the maximum resource fee that will be consumed.
2. **Backend API `/estimate` Endpoint:** Applications can query `/estimate` to obtain exact ledger fee projections before presenting transactions to users.

See the [API Reference](api-reference.md) for endpoint usage.

---

## Glossary of Terms

| Term | Plain English Definition | Documentation Reference |
|---|---|---|
| **Cliff** | A designated initial waiting window during which tokens accrue but cannot yet be claimed. | [Glossary](glossary.md#cliff) |
| **Drip** | The smooth, continuous release of tokens per ledger (block) after the cliff has passed. | [Glossary](glossary.md#drip) |
| **Stream** | An active vesting schedule linking a sponsor deposit to a designated recipient wallet over time. | [README](../README.md) |
| **Sponsor** | The person or organization funding and creating the vesting schedule. | [Glossary](glossary.md#sponsor) |
| **Recipient** | The designated beneficiary who earns and claims tokens over time. | [Glossary](glossary.md#recipient) |
| **Vault** | The smart contract's secure escrow storage that holds tokens until they vest. | [Storage](storage.md) |
| **Ledger** | A block on the Stellar blockchain, occurring approximately every 5 seconds. | [Glossary](glossary.md#ledger) |
| **Smart Contract** | Self-executing digital code running on Stellar/Soroban that governs deposits and claims. | [Walkthrough](walkthrough-guide.md) |
| **Clawback** | A regulatory compliance recovery action allowed only on specifically enabled tokens. | [SECURITY.md](../SECURITY.md) |
| **Drain** | The recovery of abandoned tokens after a completed stream has sat inactive past the drain delay. | [Storage](storage.md) |
| **Freighter** | A popular browser extension wallet used to connect and interact with Soroban apps. | [Wallet Integration](wallet-integration.md) |

For our complete dictionary of blockchain and protocol terms, visit the [Full Glossary of Terms](glossary.md).

---

## Review & Feedback

This FAQ has been reviewed by non-technical stakeholders and usability reviewers to ensure clear, jargon-free explanations. 

If you have additional questions or spot an area that could be clarified further:
- Open an issue on our [GitHub repository](https://github.com/AlienScroll78/vesting-cliff-drip-stream).
- Reach out in our community Discord or discussion channels.
