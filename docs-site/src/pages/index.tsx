import clsx from "clsx";
import Link from "@docusaurus/Link";
import useDocusaurusContext from "@docusaurus/useDocusaurusContext";
import Layout from "@theme/Layout";
import Heading from "@theme/Heading";
import styles from "./index.module.css";

type FeatureItem = {
  title: string;
  emoji: string;
  description: string;
};

const features: FeatureItem[] = [
  {
    title: "Cliff + Linear Streaming",
    emoji: "⏳",
    description:
      "Combines a mandatory cliff period with linear token dripping. Recipients cannot claim until cliff_ledger is reached — then accrued tokens release instantly, with the remainder streaming linearly.",
  },
  {
    title: "Production-Ready on Soroban",
    emoji: "🌟",
    description:
      "Built on Stellar's Soroban smart contract platform. Fully audited auth model, checked arithmetic to prevent overflow, TTL-managed persistent storage, and structured on-chain events.",
  },
  {
    title: "Full Lifecycle Control",
    emoji: "🔄",
    description:
      "Create, claim, cancel, pause/resume, clawback, and drain streams. Sponsors can reclaim funds pre-cliff; post-cliff cancellations split accrued tokens fairly.",
  },
  {
    title: "Algolia Search",
    emoji: "🔍",
    description:
      "Full-text search across all documentation pages powered by Algolia DocSearch. Find any contract function, error code, or operational procedure instantly.",
  },
  {
    title: "Versioned Docs",
    emoji: "📌",
    description:
      "Documentation versions track each release tag. Integrators can pin to a specific contract version while staying informed of the latest improvements.",
  },
  {
    title: "Runbooks & ADRs",
    emoji: "📖",
    description:
      "Operational runbooks for every infrastructure procedure, plus Architecture Decision Records documenting key design choices — storage layout, rate types, error codes, and more.",
  },
];

function Feature({ title, emoji, description }: FeatureItem) {
  return (
    <div className={clsx("col col--4", styles.feature)}>
      <div className={styles.featureEmoji} role="img" aria-label={title}>
        {emoji}
      </div>
      <Heading as="h3">{title}</Heading>
      <p>{description}</p>
    </div>
  );
}

function HomepageHero() {
  const { siteConfig } = useDocusaurusContext();
  return (
    <header className={clsx("hero hero--primary", styles.heroBanner)}>
      <div className="container">
        <Heading as="h1" className="hero__title">
          {siteConfig.title}
        </Heading>
        <p className="hero__subtitle">{siteConfig.tagline}</p>
        <div className={styles.buttons}>
          <Link
            className="button button--secondary button--lg"
            to="/developer-onboarding"
          >
            Get Started →
          </Link>
          <Link
            className="button button--outline button--secondary button--lg"
            to="/api-reference"
          >
            API Reference
          </Link>
        </div>
      </div>
    </header>
  );
}

function TokenFlowDiagram() {
  return (
    <section className={styles.tokenFlow}>
      <div className="container">
        <Heading as="h2">How It Works</Heading>
        <pre className={styles.asciiDiagram}>
          {`Token Flow
──────────────────────────────────────────────────────────────────────
Ledger:   start_ledger      cliff_ledger                  end_ledger
               │                 │                              │
Tokens:        │   [locked]      │  ← instant catch-up claim → │ ← linear drip ──┤
               │                 │                              │`}
        </pre>
        <ol className={styles.flowSteps}>
          <li>
            <strong>Sponsor</strong> deposits the full allocation upfront into
            the contract vault.
          </li>
          <li>
            Recipient <strong>cannot claim anything</strong> until{" "}
            <code>cliff_ledger</code> is reached.
          </li>
          <li>
            At the cliff, all tokens accrued since <code>start_ledger</code> are{" "}
            <strong>released instantly</strong>.
          </li>
          <li>
            Remaining tokens continue to{" "}
            <strong>drip linearly per ledger</strong> until{" "}
            <code>end_ledger</code>.
          </li>
        </ol>
      </div>
    </section>
  );
}

export default function Home(): JSX.Element {
  const { siteConfig } = useDocusaurusContext();
  return (
    <Layout
      title={`${siteConfig.title} — Docs`}
      description="Production-ready Soroban smart contract combining time-locked cliff with linear token streaming for long-term contributor retention on Stellar."
    >
      <HomepageHero />
      <main>
        <TokenFlowDiagram />
        <section className={styles.features}>
          <div className="container">
            <div className="row">
              {features.map((props, idx) => (
                <Feature key={idx} {...props} />
              ))}
            </div>
          </div>
        </section>
        <section className={styles.quickLinks}>
          <div className="container">
            <div className="row">
              <div className="col col--4">
                <div className={styles.quickLinkCard}>
                  <Heading as="h3">🚀 Quick Start</Heading>
                  <p>
                    Set up your local environment and deploy to Stellar testnet
                    in minutes.
                  </p>
                  <Link to="/developer-onboarding" className="button button--primary button--sm">
                    Developer Onboarding
                  </Link>
                </div>
              </div>
              <div className="col col--4">
                <div className={styles.quickLinkCard}>
                  <Heading as="h3">📋 Contract API</Heading>
                  <p>
                    Full API reference for all contract entry-points, view
                    functions, and error codes.
                  </p>
                  <Link to="/api-reference" className="button button--primary button--sm">
                    API Reference
                  </Link>
                </div>
              </div>
              <div className="col col--4">
                <div className={styles.quickLinkCard}>
                  <Heading as="h3">⚙️ Operations</Heading>
                  <p>
                    Runbooks for infrastructure drift, database restore,
                    contract upgrade, and disaster recovery.
                  </p>
                  <Link to="/runbooks" className="button button--primary button--sm">
                    View Runbooks
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>
    </Layout>
  );
}
