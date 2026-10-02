import { themes as prismThemes } from "prism-react-renderer";
import type { Config } from "@docusaurus/types";
import type * as Preset from "@docusaurus/preset-classic";

const config: Config = {
  title: "Vesting Cliff Drip Stream",
  tagline:
    "Production-ready Soroban smart contract combining time-locked cliff with linear token streaming on Stellar",
  favicon: "img/favicon.svg",

  // GitHub Pages deployment config
  url: "https://docs.vestingdrips.xyz",
  baseUrl: "/",

  // GitHub Pages config
  organizationName: "vesting-cliff-drip-stream", // GitHub org/user name
  projectName: "vesting-cliff-drip-stream", // GitHub repo name
  trailingSlash: false,

  onBrokenLinks: "warn",
  onBrokenMarkdownLinks: "warn",

  i18n: {
    defaultLocale: "en",
    locales: ["en"],
  },

  presets: [
    [
      "classic",
      {
        docs: {
          // Serve docs from the repo's docs/ directory (symlinked/copied at build time)
          path: "docs",
          routeBasePath: "/",
          sidebarPath: "./sidebars.ts",
          // Point to GitHub for editing
          editUrl:
            "https://github.com/vesting-cliff-drip-stream/vesting-cliff-drip-stream/edit/main/",
          // Enable versioning
          lastVersion: "current",
          versions: {
            current: {
              label: "Latest",
              path: "/",
            },
          },
          showLastUpdateAuthor: true,
          showLastUpdateTime: true,
        },
        blog: false,
        theme: {
          customCss: "./src/css/custom.css",
        },
        sitemap: {
          changefreq: "weekly",
          priority: 0.5,
          ignorePatterns: ["/tags/**"],
          filename: "sitemap.xml",
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    // Social card image
    image: "img/social-card.png",

    // Algolia DocSearch
    algolia: {
      // These are public-facing values — safe to commit.
      // Replace with actual values from https://docsearch.algolia.com/apply/
      appId: "YOUR_ALGOLIA_APP_ID",
      apiKey: "YOUR_ALGOLIA_SEARCH_API_KEY", // search-only (public) key
      indexName: "vestingdrips",
      contextualSearch: true,
      searchParameters: {},
      searchPagePath: "search",
    },

    navbar: {
      title: "VestingDrips",
      logo: {
        alt: "VestingDrips Logo",
        src: "img/logo.svg",
      },
      items: [
        {
          type: "docSidebar",
          sidebarId: "docsSidebar",
          position: "left",
          label: "Docs",
        },
        {
          type: "docSidebar",
          sidebarId: "apiSidebar",
          position: "left",
          label: "API Reference",
        },
        {
          type: "docSidebar",
          sidebarId: "runbooksSidebar",
          position: "left",
          label: "Runbooks",
        },
        {
          type: "docsVersionDropdown",
          position: "right",
        },
        {
          href: "https://github.com/vesting-cliff-drip-stream/vesting-cliff-drip-stream",
          label: "GitHub",
          position: "right",
        },
      ],
    },

    footer: {
      style: "dark",
      links: [
        {
          title: "Documentation",
          items: [
            { label: "Getting Started", to: "/developer-onboarding" },
            { label: "API Reference", to: "/api-reference" },
            { label: "Architecture", to: "/architecture" },
            { label: "FAQ", to: "/faq" },
          ],
        },
        {
          title: "Contract",
          items: [
            { label: "Glossary", to: "/glossary" },
            { label: "Error Handling", to: "/error-handling" },
            { label: "Flows", to: "/flows" },
            { label: "Storage", to: "/storage" },
          ],
        },
        {
          title: "Operations",
          items: [
            { label: "Runbooks", to: "/runbooks" },
            { label: "CI/CD", to: "/ci-cd" },
            { label: "Security Model", to: "/security/security-model" },
            { label: "SBOM", to: "/sbom" },
          ],
        },
        {
          title: "Community",
          items: [
            {
              label: "GitHub",
              href: "https://github.com/vesting-cliff-drip-stream/vesting-cliff-drip-stream",
            },
            {
              label: "CHANGELOG",
              href: "https://github.com/vesting-cliff-drip-stream/vesting-cliff-drip-stream/blob/main/CHANGELOG.md",
            },
            {
              label: "Security Policy",
              href: "https://github.com/vesting-cliff-drip-stream/vesting-cliff-drip-stream/blob/main/SECURITY.md",
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} Vesting Cliff Drip Stream. Built with Docusaurus.`,
    },

    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ["rust", "bash", "toml", "yaml", "sql", "typescript"],
    },

    colorMode: {
      defaultMode: "light",
      disableSwitch: false,
      respectPrefersColorScheme: true,
    },

    docs: {
      sidebar: {
        hideable: true,
        autoCollapseCategories: true,
      },
    },

    announcementBar: {
      id: "stellar_network",
      content:
        '🌟 Deployed on <a href="https://stellar.org" target="_blank">Stellar</a> via Soroban smart contracts. <a href="/developer-onboarding">Get started →</a>',
      backgroundColor: "#6c63ff",
      textColor: "#ffffff",
      isCloseable: true,
    },
  } satisfies Preset.ThemeConfig,

  markdown: {
    mermaid: true,
  },

  themes: ["@docusaurus/theme-mermaid"],

  plugins: [
    [
      "@docusaurus/plugin-ideal-image",
      {
        quality: 70,
        max: 1030,
        min: 640,
        steps: 2,
        disableInDev: false,
      },
    ],
  ],
};

export default config;
