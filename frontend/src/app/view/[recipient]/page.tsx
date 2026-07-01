import ViewPageClient from "./ViewPageClient";

export default function ViewPage({ params }: { params: { recipient: string } }) {
  return <ViewPageClient recipient={params.recipient} />;
}
