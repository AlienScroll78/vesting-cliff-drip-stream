import type { Metadata } from "next";
import StreamDashboardClient from "./StreamDashboardClient";

export const metadata: Metadata = {
  title: "Stream Dashboard | Vesting Cliff Drip",
  description:
    "View your vesting schedule, claimable balance, and claim tokens from your vesting stream.",
};

/**
 * Issue #757 — Stream Dashboard Page
 *
 * Server component shell — hands off to the client component that handles
 * wallet connection, live data fetching, and the claim transaction flow.
 */
export default function DashboardPage() {
  return <StreamDashboardClient />;
}
