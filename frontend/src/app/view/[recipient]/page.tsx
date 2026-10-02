import type { Metadata } from "next";
import ViewPageClient from "./ViewPageClient";

interface ViewPageProps {
  params: { recipient: string };
}

/**
 * Generate per-page metadata for the public stream view.
 *
 * Issue #765: adds OG social-preview tags and a noindex directive so individual
 * stream pages are shareable but excluded from search engine indices.
 */
export async function generateMetadata({ params }: ViewPageProps): Promise<Metadata> {
  const { recipient } = params;
  // Shorten the address for display: first 6 … last 4 chars
  const shortAddr =
    recipient.length > 12
      ? `${recipient.slice(0, 6)}…${recipient.slice(-4)}`
      : recipient;

  const title = `Vesting Stream — ${shortAddr}`;
  const description =
    `View the cliff-drip vesting schedule for ${shortAddr} on the Stellar network. ` +
    "No wallet required.";

  // Canonical public URL (Next.js resolves NEXT_PUBLIC_BASE_URL at build time;
  // falls back gracefully when undefined so local dev still works).
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "";
  const url = `${baseUrl}/view/${recipient}`;

  return {
    title,
    description,
    // Prevent search engines from indexing individual stream pages (#765)
    robots: {
      index: false,
      follow: false,
    },
    openGraph: {
      title,
      description,
      type: "website",
      url,
      siteName: "VestingStream",
    },
    twitter: {
      card: "summary",
      title,
      description,
    },
  };
}

export default function ViewPage({ params }: ViewPageProps) {
  return <ViewPageClient recipient={params.recipient} />;
}
