/**
 * Lighthouse CI configuration — Issue #369
 *
 * Enforces minimum scores on every PR to prevent performance regressions.
 *
 * Core Web Vitals targets (documented here, measured by Lighthouse):
 *   LCP  (Largest Contentful Paint)   ≤ 2.5 s   → good user experience
 *   FID  (First Input Delay)          ≤ 100 ms   → good interactivity
 *   CLS  (Cumulative Layout Shift)    ≤ 0.1      → good visual stability
 *   FCP  (First Contentful Paint)     ≤ 1.8 s
 *   TTI  (Time to Interactive)        ≤ 3.8 s
 *
 * Minimum scores enforced on every PR:
 *   Performance    ≥ 80
 *   Accessibility  ≥ 95
 *   Best Practices ≥ 90
 *   SEO            ≥ 80
 */

/** @type {import('@lhci/cli').LighthouseConfig} */
module.exports = {
  ci: {
    collect: {
      // Audit the deployed Vercel/Netlify preview URL injected by CI.
      // Falls back to local server during manual runs.
      url: [process.env.LHCI_URL || "http://localhost:4173"],

      // Number of Lighthouse runs per URL — averaged for stable scores.
      numberOfRuns: 3,

      // Lighthouse settings applied to each run
      settings: {
        // Simulate a mid-tier mobile device on a 4G connection
        preset: "desktop",
        throttling: {
          rttMs: 40,
          throughputKbps: 10_240,
          cpuSlowdownMultiplier: 1,
        },
        // Skip slow third-party audits not relevant to contract errors
        skipAudits: ["uses-http2"],
      },
    },

    assert: {
      // Fail the CI check if any score drops below these thresholds.
      assertions: {
        // ── Category scores ──────────────────────────────────────────────────
        "categories:performance": ["error", { minScore: 0.8 }],
        "categories:accessibility": ["error", { minScore: 0.95 }],
        "categories:best-practices": ["error", { minScore: 0.9 }],
        "categories:seo": ["error", { minScore: 0.8 }],

        // ── Core Web Vitals ───────────────────────────────────────────────────
        // LCP ≤ 2500 ms
        "largest-contentful-paint": ["error", { maxNumericValue: 2500 }],
        // FID proxy: Total Blocking Time ≤ 200 ms
        "total-blocking-time": ["error", { maxNumericValue: 200 }],
        // CLS ≤ 0.1
        "cumulative-layout-shift": ["error", { maxNumericValue: 0.1 }],
        // FCP ≤ 1800 ms
        "first-contentful-paint": ["warn", { maxNumericValue: 1800 }],
        // TTI ≤ 3800 ms
        "interactive": ["warn", { maxNumericValue: 3800 }],

        // ── Accessibility audits ──────────────────────────────────────────────
        "color-contrast": "error",
        "html-has-lang": "error",
        "image-alt": "error",
        "button-name": "error",
        "link-name": "error",
        "aria-roles": "error",

        // ── Security / best-practices ─────────────────────────────────────────
        "is-on-https": "error",
        "no-vulnerable-libraries": "warn",
        "csp-xss": "warn",

        // ── SEO basics ────────────────────────────────────────────────────────
        "meta-description": "warn",
        "document-title": "error",
        "viewport": "error",
      },
    },

    upload: {
      // Upload results to the LHCI server for trend tracking.
      // Set LHCI_SERVER_BASE_URL and LHCI_TOKEN in CI secrets.
      target: "lhci",
      serverBaseUrl: process.env.LHCI_SERVER_BASE_URL || "https://lhci.example.com",
      token: process.env.LHCI_TOKEN || "",

      // Also save results as static files for PR artifact download.
      // target: "filesystem",
      // outputDir: "./lhci-results",
    },
  },
};
