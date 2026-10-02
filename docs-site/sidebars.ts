import type { SidebarsConfig } from "@docusaurus/plugin-content-docs";

/**
 * Sidebar configuration for VestingDrips documentation.
 *
 * Three sidebars:
 *   - docsSidebar   – main documentation
 *   - apiSidebar    – API reference and changelogs
 *   - runbooksSidebar – operational runbooks
 */
const sidebars: SidebarsConfig = {
  docsSidebar: [
    {
      type: "doc",
      id: "index",
      label: "Introduction",
    },
    {
      type: "category",
      label: "Getting Started",
      collapsed: false,
      items: [
        "developer-onboarding",
        "walkthrough-guide",
        "comparison",
        "faq",
      ],
    },
    {
      type: "category",
      label: "Architecture",
      collapsed: false,
      items: [
        "architecture",
        "flows",
        "schema",
        "storage",
        "config",
      ],
    },
    {
      type: "category",
      label: "Contract",
      collapsed: false,
      items: [
        "glossary",
        "error-handling",
        "integration-guide",
        "wallet-integration",
        "api-changelog",
      ],
    },
    {
      type: "category",
      label: "Performance & Observability",
      collapsed: true,
      items: [
        "performance",
        "benchmarks",
        "opentelemetry",
        "analytics",
        "wasm-size",
        "stellar-wave",
        "ci-cd",
      ],
    },
    {
      type: "category",
      label: "Security",
      collapsed: true,
      items: [
        "security/security-model",
        "security/codeql-suppression",
        "sbom",
      ],
    },
    {
      type: "category",
      label: "Architecture Decision Records",
      collapsed: true,
      link: {
        type: "doc",
        id: "adr/README",
      },
      items: [
        "adr/0001-per-recipient-storage-key",
        "adr/0002-i128-rate-representation",
        "adr/0003-cliff-math-catchup-claim",
        "adr/0004-error-code-numbering",
        "adr/0005-ttl-persistent-storage-strategy",
        "adr/0006-i128-rate-type-detailed",
        "adr/0006-checked-arithmetic-strategy",
        "adr/0007-pause-resume-design",
        "adr/0008-multi-token-storage",
      ],
    },
    {
      type: "category",
      label: "Testing",
      collapsed: true,
      items: [
        "mutation/report",
        "horizon-unavailability-tests",
        "a11y-audit",
        "visual-regression",
        "stream-status-badges",
        "mobile-claim-bottom-sheet",
        "sponsor-cost-calculator",
        {
          type: "category",
          label: "Coverage",
          items: ["coverage/README"],
        },
      ],
    },
    {
      type: "category",
      label: "Design",
      collapsed: true,
      items: [
        "design/multi-token",
      ],
    },
    {
      type: "category",
      label: "Research",
      collapsed: true,
      items: [
        "research/findings-report",
        "research/heuristic-evaluation",
        "research/action-plan",
        "research/usability-study-1",
        "research/usability-test-protocol",
        "research/participant-screener",
        "research/observation-notes-template",
        "research/findings-report-template",
      ],
    },
    {
      type: "category",
      label: "Presentation",
      collapsed: true,
      items: [
        "presentation/design-deck",
        "presentation/slides",
        "presentation/script",
      ],
    },
  ],

  apiSidebar: [
    {
      type: "doc",
      id: "api-reference",
      label: "API Reference",
    },
    {
      type: "doc",
      id: "api-changelog",
      label: "API Changelog",
    },
    {
      type: "doc",
      id: "schema",
      label: "Schema",
    },
    {
      type: "doc",
      id: "error-handling",
      label: "Error Handling",
    },
  ],

  runbooksSidebar: [
    {
      type: "doc",
      id: "runbooks/README",
      label: "Runbooks Overview",
    },
    {
      type: "category",
      label: "Infrastructure",
      collapsed: false,
      items: [
        "runbooks/drift-reconciliation",
        "runbooks/emergency-override",
        "runbooks/disaster-recovery",
        "runbooks/migration-rollback",
        "runbooks/contract-upgrade",
      ],
    },
    {
      type: "category",
      label: "Database",
      collapsed: false,
      items: [
        "runbooks/rds-restore",
        "runbooks/backfill-stream-events",
      ],
    },
    {
      type: "category",
      label: "Monitoring",
      collapsed: false,
      items: [
        "runbooks/cost-monitoring",
        "runbooks/cloudwatch-logs",
        "runbooks/canary-deployment",
      ],
    },
  ],
};

export default sidebars;
