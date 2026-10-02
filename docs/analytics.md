# Analytics Events

This project uses [PostHog](https://posthog.com) for privacy-friendly product analytics.

## Configuration

Set the following environment variables:

```
NEXT_PUBLIC_POSTHOG_KEY=phc_...
NEXT_PUBLIC_POSTHOG_HOST=https://app.posthog.com   # optional, defaults to posthog.com
```

If `NEXT_PUBLIC_POSTHOG_KEY` is not set, analytics is silently disabled.

## Privacy

- **No PII is collected.** Wallet addresses are public on-chain identifiers and are the only identity signal sent.
- **Autocapture is disabled.** Only the events listed below are tracked.
- **Opt-out:** Users can disable analytics at any time via the "Disable analytics" link in the footer. The preference is stored in `localStorage` under the key `analytics_opt_out`.

## Tracked Events

| Event | When fired | Properties |
|---|---|---|
| `page_view` | On every route change | `page` — pathname |
| `wallet_connected` | After wallet connection succeeds | `wallet_address` — public Stellar address |
| `stream_created` | When the create-stream form is submitted | `token` — token symbol |
| `claim_submitted` | When user confirms a claim | `token`, `amount` |
| `cancel_initiated` | When user initiates stream cancellation | _(none)_ |

## Opt-out API

```ts
import { optOut, optIn, isOptedOut } from "@/analytics";

optOut();       // disables tracking immediately, persists in localStorage
optIn();        // re-enables tracking
isOptedOut();   // returns true if user has opted out
```
