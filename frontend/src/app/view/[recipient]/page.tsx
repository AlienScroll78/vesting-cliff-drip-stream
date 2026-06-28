import type { Metadata } from "next";
import ViewPageClient from "./ViewPageClient";

export async function generateMetadata(
  { params }: { params: { recipient: string } }
): Promise<Metadata> {
  const r = params.recipient;
  const short = r.length > 10 ? `${r.slice(0, 6)}…${r.slice(-4)}` : r;
  return {
    title: `Vesting Schedule — ${short}`,
    description: `Read-only view of the vesting schedule for ${r}`,
    openGraph: {
      title: `Vesting Schedule — ${short}`,
      description: `Read-only view of the vesting schedule for ${r}`,
      type: "website",
    },
  };
}

export default function ViewPage({ params }: { params: { recipient: string } }) {
  return <ViewPageClient recipient={params.recipient} />;
}
