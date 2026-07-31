# Stellar Wave Program

This repository participates in the **Stellar Wave Program**, a recurring open-source contribution initiative run by the [Stellar Development Foundation](https://stellar.org/foundation) via the [Drips Wave](https://drips.network/wave) platform.

---

## What is Stellar Wave?

Drips Wave turns ecosystem funding into a predictable rhythm of merged pull requests. Each **Wave** is a one-week sprint that runs on a monthly cycle. Maintainers scope issues from their backlog, contributors claim and resolve those issues, and rewards are distributed automatically at the end of the sprint — no spreadsheets, no manual accounting.

The Stellar Wave Program is the first and primary Wave Program on Drips, and has distributed over $400k to contributors across 200+ repos.

---

## How It Works

### 1. Maintainers add issues

Maintainers select issues from the backlog and add them to the Wave Program via the [Drips Wave app](https://drips.network/wave) or by applying the `Stellar Wave` label on GitHub directly. Each issue is assigned a **complexity level** that determines its Points value:

| Complexity | Points | Typical scope |
|------------|--------|---------------|
| Trivial    | 100    | Typos, small bug fixes, minor copy changes |
| Medium     | 150    | Standard features or involved bug fixes |
| High       | 200    | Complex architecture, refactors, new integrations |

### 2. Contributors apply and resolve issues

When a Wave opens, contributors browse available issues, submit an application via the Drips Wave app, and — once assigned — open a pull request. Points are awarded when the maintainer merges the PR and marks the issue as resolved.

### 3. Rewards are distributed

At the end of the Wave, the reward pool is split proportionally across all contributors by their share of total points:

```
payout = (your_points / total_points_in_wave) * reward_budget
```

Rewards are withdrawn on-chain directly from the Drips Wave app.

---

## Qualifying Issues

An issue in this repository qualifies for the Stellar Wave Program if and only if it carries the **`Stellar Wave`** label. The label is applied in one of two ways:

1. **By a maintainer through the Drips Wave app** — the Drips bot adds the label and posts a comment on the issue.
2. **Directly on GitHub** — a maintainer with write access applies the label manually. This works because the repository is already approved in the Stellar Wave Program.

Issues without the `Stellar Wave` label are not part of the program, even if they are otherwise well-suited for external contribution. Do not apply the label yourself — it is reserved for maintainers.

To find all currently active Wave issues in this repo:

```
https://github.com/AlienScroll78/vesting-cliff-drip-stream/labels/Stellar%20Wave
```

Or search across the entire Stellar ecosystem from the [Drips Wave Explore page](https://drips.network/wave).

---

## Submission Format and Required Information

### Before you apply

1. **Complete KYC** — Identity verification is mandatory before you can apply for any issue. Go to [Settings → Profile](https://drips.network/wave) in the Drips Wave app and follow the Sumsub verification flow. This typically takes under five minutes. You cannot withdraw rewards without it.
2. **Sign in with GitHub** — The app links your GitHub account to track contributions and display your Code Metrics scorecard to maintainers.

### Applying to an issue

1. Find an open issue labelled `Stellar Wave` on GitHub or in the [Drips Wave app](https://drips.network/wave).
2. Read the issue description carefully. Confirm you can complete it within the Wave's one-week window.
3. Click **Apply** in the Drips Wave app and write a short message to the maintainer. Keep it concise — one or two sentences explaining your relevant experience or a link to a similar previous PR is enough.
4. **Wait to be assigned.** Do not start coding until the maintainer officially assigns you. You will receive a notification when that happens.

### Resolving the issue

Once assigned:

1. Fork the repository (if you do not have write access) and create a feature branch.
2. Implement the fix or feature and write tests for new behaviour.
3. Open a pull request against `main` following the standard [contribution workflow](../CONTRIBUTING.md#submitting-a-pull-request).
4. **Link your PR to the issue** by including `Closes #<issue-number>` in the PR description. This is required — it triggers automatic issue closure on merge, which is how Points are awarded.
5. Address review feedback and keep the branch up to date.
6. Once the maintainer merges and closes the issue, Points are automatically allocated to your account.

### PR description requirements for Wave issues

In addition to the standard PR template, include:

- `Closes #<issue-number>` in the description (required for point allocation).
- A brief summary of the approach taken and any notable implementation decisions.
- Test evidence: paste the output of `make test` or link to the CI run.

---

## The `Stellar Wave` Label

| Who can add it | How |
|----------------|-----|
| Maintainers only | Via the Drips Wave app dashboard or directly on GitHub |

The label signals to the Drips platform that the issue is in scope for the current Wave Program. The platform uses it to surface the issue to contributors, track resolution, and allocate Points automatically on close.

Contributors and external users should **not** add or remove this label. Doing so has no effect on the Wave program (the repository must already be approved) and may cause confusion.

---

## Application Limits

To keep participation fair, Drips enforces the following limits per contributor per Wave:

| Limit | Value |
|-------|-------|
| Maximum pending applications (total) | 15 |
| Maximum assigned issues per organisation | 4 |

You can review your current limits and which issues count against them at [drips.network/wave/contributors/limit-details](https://drips.network/wave/contributors/limit-details).

---

## Frequently Asked Questions

### Can multiple contributors work on the same issue?

No. Each `Stellar Wave` issue is assigned to **one contributor**. Multiple people may apply, but the maintainer picks one and all other applications become inactive. This is a deliberate design choice — it ensures clear ownership, a clean review flow, and fair Points allocation.

If you are not selected for an issue, your application slot is freed up and you can apply to other issues immediately.

### What if I cannot finish in time?

Notify the maintainer as soon as possible. Unresolved issues at the end of a Wave carry over to the next Wave automatically — they do not disappear. If you are still working but know you will miss the deadline, communicate early so the maintainer can decide whether to wait or reassign.

### My PR was merged but I did not receive Points. What do I do?

Points are triggered when the linked issue is **closed**, not just when the PR is merged. Make sure your PR description contains `Closes #<issue-number>`. If the issue is closed and you still have not received Points after a few minutes, contact the Drips support team at [drips.network/wave/support](https://drips.network/wave/support) with a link to the closed issue and your PR.

### Can I submit a PR for a Wave issue without applying through the Drips app?

No. You must be officially assigned to the issue through the Drips Wave app to receive Points. A merged PR alone does not earn rewards if you were not the assigned contributor in the system.

### Do I need a wallet to participate?

You need a wallet address only to **withdraw** rewards after the Wave ends. You can apply for issues and earn Points without one, but you will need to add a wallet before the payout window closes. Instructions are at [docs.drips.network/wave/withdrawing-rewards](https://docs.drips.network/wave/withdrawing-rewards).

### Can I dispute a complexity rating?

Complexity is set by the maintainer. If you believe an issue is significantly harder than its current rating suggests, discuss it with the maintainer in the issue comments. Maintainers can update the complexity level before the issue is resolved.

---

## Official Resources

| Resource | Link |
|----------|------|
| Drips Wave app (apply, track, withdraw) | [drips.network/wave](https://drips.network/wave) |
| Official Wave documentation | [docs.drips.network/wave](https://docs.drips.network/wave) |
| Contributor guide | [docs.drips.network/wave/contributors/solving-issues-and-earning-rewards](https://docs.drips.network/wave/contributors/solving-issues-and-earning-rewards) |
| Points & rewards explained | [docs.drips.network/wave/points-and-rewards](https://docs.drips.network/wave/points-and-rewards) |
| Withdrawing rewards | [docs.drips.network/wave/withdrawing-rewards](https://docs.drips.network/wave/withdrawing-rewards) |
| Terms and rules | [docs.drips.network/wave/terms-and-rules](https://docs.drips.network/wave/terms-and-rules) |
| Drips Discord (support tickets) | [discord.gg/BakDKKDpHF](https://discord.gg/BakDKKDpHF) |
