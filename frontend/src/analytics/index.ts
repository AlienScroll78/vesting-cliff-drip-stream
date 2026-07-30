import posthog from "posthog-js";

declare const process: { env: Record<string, string | undefined> };

const POSTHOG_KEY =
  (typeof process !== "undefined" ? process.env.NEXT_PUBLIC_POSTHOG_KEY : undefined) ?? "";
const POSTHOG_HOST =
  (typeof process !== "undefined" ? process.env.NEXT_PUBLIC_POSTHOG_HOST : undefined) ??
  "https://app.posthog.com";

const OPT_OUT_KEY = "analytics_opt_out";

export function initAnalytics() {
  if (typeof window === "undefined" || !POSTHOG_KEY) return;
  if (isOptedOut()) return;
  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    autocapture: false,
    capture_pageview: false,
    persistence: "localStorage",
  });
}

export function isOptedOut(): boolean {
  return typeof window !== "undefined" && localStorage.getItem(OPT_OUT_KEY) === "true";
}

export function optOut() {
  localStorage.setItem(OPT_OUT_KEY, "true");
  posthog.opt_out_capturing();
}

export function optIn() {
  localStorage.removeItem(OPT_OUT_KEY);
  posthog.opt_in_capturing();
}

function track(event: string, props?: Record<string, unknown>) {
  if (isOptedOut()) return;
  posthog.capture(event, props);
}

export const analytics = {
  pageView: (page: string) => track("page_view", { page }),
  walletConnected: (address: string) => track("wallet_connected", { wallet_address: address }),
  streamCreated: (tokenSymbol: string) => track("stream_created", { token: tokenSymbol }),
  claimSubmitted: (tokenSymbol: string, amount: number) =>
    track("claim_submitted", { token: tokenSymbol, amount }),
  cancelInitiated: () => track("cancel_initiated"),
};
