"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface CopyableAddressProps {
  value: string;
  kind?: "address" | "transaction";
  network?: "public" | "testnet";
  showExplorerLink?: boolean;
}

async function copyToClipboard(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // Use the legacy copy path when the Clipboard API is blocked.
    }
  }

  const input = document.createElement("textarea");
  input.value = value;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.appendChild(input);
  input.select();
  const copied = document.execCommand("copy");
  document.body.removeChild(input);
  if (!copied) throw new Error("Clipboard copy failed");
}

export function CopyableAddress({
  value,
  kind = "address",
  network = "testnet",
  showExplorerLink = true,
}: CopyableAddressProps) {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
  }, []);

  const handleCopy = useCallback(async () => {
    await copyToClipboard(value);
    setCopied(true);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setCopied(false), 2000);
  }, [value]);

  const truncated = value.length > 12 ? `${value.slice(0, 6)}...${value.slice(-6)}` : value;
  const explorerType = kind === "transaction" ? "tx" : "account";
  const explorerUrl = `https://stellar.expert/explorer/${network}/${explorerType}/${encodeURIComponent(value)}`;

  return (
    <span className="copyable-identifier">
      <span className="copyable-identifier-value" title={value}>{truncated}</span>
      <button
        type="button"
        className="copy-btn"
        onClick={handleCopy}
        aria-label="Copy address to clipboard"
      >
        {copied ? (
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M3 8l4 4 6-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <rect x="5" y="5" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1.5" />
            <path d="M3 11V3h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        )}
      </button>
      {showExplorerLink && (
        <a
          href={explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="copyable-identifier-explorer"
          aria-label={`View ${kind} on Stellar Expert`}
          title="View on Stellar Expert"
        >
          ↗
        </a>
      )}
    </span>
  );
}