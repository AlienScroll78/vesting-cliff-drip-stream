# Full-Stack System Architecture

This document provides a comprehensive architecture overview of the `VestingDrips` platform, illustrating the interaction between the frontend, backend infrastructure, Horizon / Soroban RPC, and on-chain Soroban smart contracts.

---

## Table of Contents

1. [Top-Level System Architecture](#top-level-system-architecture)
2. [Data Flow Diagrams](#data-flow-diagrams)
   - [Stream Creation Flow](#1-stream-creation-flow)
   - [Claim Vested Tokens Flow](#2-claim-vested-tokens-flow)
   - [Cancel Stream Flow](#3-cancel-stream-flow)
3. [Backend Component Diagram](#backend-component-diagram)
4. [Contract Storage Layout](#contract-storage-layout)

---

## Top-Level System Architecture

The following diagram illustrates how end users interact with the web interface, how the backend indexes on-chain activity, and how transactions flow through Horizon and Stellar RPC to the Soroban smart contract.

```mermaid
flowchart TD
    subgraph ClientLayer["Client Layer"]
        UI["Web Application (Next.js / Vite UI)"]
        Wallet["Stellar Wallet (Freighter / Albedo)"]
    end

    subgraph BackendLayer["Backend Infrastructure"]
        API["API Server (Express / TypeScript)"]
        Indexer["Indexer & Background Worker"]
        Redis[("Redis Cache")]
        Postgres[("PostgreSQL Database")]
    end

    subgraph StellarNetwork["Stellar & Soroban Infrastructure"]
        Horizon["Stellar Horizon API"]
        RPC["Soroban RPC Node"]
        StellarCore["Stellar Core / Ledger"]
        Contract["VestingDrips Smart Contract"]
    end

    UI -->|"1. Request Tx / Read State"| API
    UI -->|"2. Sign Transaction"| Wallet
    Wallet -->|"3. Submit Tx"| RPC
    RPC -->|"4. Execute Host Call"| Contract
    Contract -->|"5. Mutate State & Emit Events"| StellarCore
    Indexer -->|"6. Poll Events / Ingest Ledgers"| Horizon
    Indexer -->|"7. Persist Index Data"| Postgres
    API -->|"8. Read Cached Stream Data"| Redis
    API -->|"9. Query Analytics"| Postgres
    Redis <--> Indexer
```

---

## Data Flow Diagrams

### 1. Stream Creation Flow

The sponsor specifies vesting parameters, approves the deposit, and submits the `create_vesting_stream` transaction.

```mermaid
sequenceDiagram
    autonumber
    actor Sponsor
    participant UI as Web Frontend
    participant RPC as Soroban RPC
    participant Contract as VestingDrips Contract
    participant Token as SAC Token Contract
    participant Storage as Contract Storage

    Sponsor->>UI: Input recipient, rate, cliff & total duration
    UI->>RPC: simulateTransaction(create_vesting_stream)
    RPC-->>UI: Simulation result & fee estimate
    UI->>Sponsor: Request Wallet Signature
    Sponsor-->>UI: Signed Transaction
    UI->>RPC: sendTransaction(signedTx)
    RPC->>Contract: create_vesting_stream(sponsor, recipient, token, rate, cliff, total)
    Contract->>Contract: Validate parameters (rate > 0, total > cliff, deposit >= min_deposit)
    Contract->>Token: try_transfer(sponsor -> Contract Vault, total_deposit)
    Token-->>Contract: Transfer Success
    Contract->>Storage: set_schedule(recipient, VestingSchedule)
    Contract->>Contract: Emit event "vc_create"
    RPC-->>UI: Transaction Result (Success)
```

---

### 2. Claim Vested Tokens Flow

The recipient initiates a claim once the cliff ledger sequence has elapsed.

```mermaid
sequenceDiagram
    autonumber
    actor Recipient
    participant UI as Web Frontend
    participant RPC as Soroban RPC
    participant Contract as VestingDrips Contract
    participant Storage as Contract Storage
    participant Token as SAC Token Contract

    Recipient->>UI: Click "Claim Vested Tokens"
    UI->>Contract: View Query: claimable_amount(recipient)
    Contract-->>UI: Returns claimable_amount (e.g. 5,000 tokens)
    UI->>Recipient: Prompt signature for claim_vested
    Recipient-->>UI: Sign Transaction
    UI->>RPC: sendTransaction(claim_vested)
    RPC->>Contract: claim_vested(recipient)
    Contract->>Storage: get_schedule(recipient)
    Storage-->>Contract: VestingSchedule
    Contract->>Contract: Verify current_ledger >= cliff_ledger
    Contract->>Contract: Calculate earned = (current_ledger - last_claimed) * rate
    Contract->>Token: try_transfer(Contract Vault -> recipient, earned)
    Token-->>Contract: Transfer Success
    Contract->>Storage: Update last_claimed_ledger & total_claimed (or remove if end reached)
    Contract->>Contract: Emit event "vc_claim" (or "vc_done")
    RPC-->>UI: Claim Success
```

---

### 3. Cancel Stream Flow

The original sponsor cancels an active stream. Unearned tokens return to the sponsor; earned post-cliff tokens remain claimable by the recipient.

```mermaid
sequenceDiagram
    autonumber
    actor Sponsor
    participant UI as Web Frontend
    participant RPC as Soroban RPC
    participant Contract as VestingDrips Contract
    participant Storage as Contract Storage
    participant Token as SAC Token Contract

    Sponsor->>UI: Click "Cancel Stream"
    UI->>RPC: sendTransaction(cancel_stream)
    RPC->>Contract: cancel_stream(sponsor, recipient)
    Contract->>Contract: require_auth(sponsor)
    Contract->>Storage: get_schedule(recipient)
    Storage-->>Contract: VestingSchedule
    alt Current Ledger < Cliff Ledger
        Contract->>Token: try_transfer(Vault -> sponsor, full_deposit)
    else Current Ledger >= Cliff Ledger
        Contract->>Token: try_transfer(Vault -> recipient, earned_tokens)
        Contract->>Token: try_transfer(Vault -> sponsor, unearned_tokens)
    end
    Contract->>Storage: remove_schedule(recipient)
    Contract->>Contract: Emit event "vc_cancel"
    RPC-->>UI: Cancellation Complete
```

---

## Backend Component Diagram

The backend service is structured into modular layers responsible for API traffic, background blockchain indexers, real-time WebSocket notifications, caching, and persistent database storage.

```mermaid
flowchart LR
    subgraph ClientRequest["Clients"]
        WebClient["Web Client"]
        SDKClient["Third-Party SDK"]
    end

    subgraph BackendApp["Backend Application Services"]
        direction TB
        Server["Express API Server (server.ts)"]
        WS["WebSocket Server (ws.ts)"]
        Indexer["Event Indexer (indexer.ts)"]
        Jobs["Background Job Processors"]
    end

    subgraph DataStore["Data Infrastructure"]
        Cache["Redis Client (cache.js / redisClient.js)"]
        DB[(PostgreSQL Database)]
    end

    subgraph ExternalServices["External Network"]
        HorizonClient["Horizon Client (horizonClient.ts)"]
        StellarHorizon["Stellar Horizon / RPC"]
    end

    WebClient -->|"REST / GraphQL"| Server
    SDKClient -->|"REST API"| Server
    WebClient <-->|"Live Updates"| WS
    Server --> Cache
    Server --> DB
    Indexer --> HorizonClient
    HorizonClient <--> StellarHorizon
    Indexer --> DB
    Indexer --> Cache
    Jobs --> DB
    WS <--> Cache
```

---

## Contract Storage Layout

`VestingDrips` utilizes Soroban `CONTRACT_DATA` persistent storage entries. Each recipient stream is isolated under its own key derived from `DataKey::Schedule(Address)`.

```mermaid
classDiagram
    class DataKey {
        <<enum>>
        Schedule(Address recipient)
    }

    class VestingSchedule {
        +u32 version
        +Address token
        +Address sponsor
        +i128 rate_per_ledger
        +u32 start_ledger
        +u32 cliff_ledger
        +u32 end_ledger
        +u32 last_claimed_ledger
        +i128 total_claimed
    }

    class StoragePolicy {
        +PERSISTENT_LEDGER_THRESHOLD : 259,200 ledgers (~30 days)
        +PERSISTENT_BUMP_AMOUNT : 518,400 ledgers (~60 days)
        +extend_ttl(key, threshold, bump_to)
    }

    DataKey "1" --> "1" VestingSchedule : Stores entry under key
    VestingSchedule .. StoragePolicy : Automatic TTL bump on read/write
```

### Storage Characteristics

| Parameter | Value / Detail |
|---|---|
| **Storage Type** | `Persistent` (`CONTRACT_DATA`) |
| **Key Schema** | `DataKey::Schedule(recipient: Address)` |
| **Entry Size** | ~200–250 bytes per schedule |
| **TTL Bump Threshold** | 259,200 ledgers (~30 days) |
| **TTL Bump Target** | 518,400 ledgers (~60 days from current ledger) |
| **Archival Behavior** | Bumps on all reads (`get_schedule`) and writes (`set_schedule`). Expired inactive streams archive after 60 days and are automatically restored via transaction simulation preambles. |

---

## References

- [Storage Design Specification](storage.md)
- [Third-Party Integration Guide](integration-guide.md)
- [Soroban Storage Documentation](https://developers.stellar.org/docs/build/guides/storage/choosing-the-right-storage)
