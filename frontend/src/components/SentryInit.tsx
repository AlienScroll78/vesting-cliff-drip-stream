"use client";
/**
 * SentryInit — #773
 *
 * Initialises Sentry once on mount and updates user context whenever the
 * connected wallet changes.
 *
 * Placed inside <WalletProvider> so it has access to wallet state.
 * Renders nothing to the DOM.
 */

import { useEffect } from "react";
import { initSentry, setSentryUser, clearSentryUser } from "@/sentry";
import { useWallet } from "@/contexts/WalletContext";

export function SentryInit() {
  // Initialise once (idempotent — safe to call on every render)
  useEffect(() => {
    initSentry();
  }, []);

  return <SentryUserSync />;
}

/** Inner component that has access to wallet context. */
function SentryUserSync() {
  const { address, provider, network } = useWallet();

  useEffect(() => {
    if (address) {
      // Attach hashed user context — never sends the raw address
      setSentryUser(address, provider ?? "unknown", network);
    } else {
      clearSentryUser();
    }
  }, [address, provider, network]);

  return null;
}
