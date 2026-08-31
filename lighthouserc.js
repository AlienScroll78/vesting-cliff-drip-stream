/** @type {import('@lhci/cli').LhciConfig} */
module.exports = {
  ci: {
    collect: {
      // Run against the Vite preview server; start it before lhci autorun
      // or supply startServerCommand if using lhci's built-in server management.
      url: ['http://localhost:4173/'],
      numberOfRuns: 3,
    },
    assert: {
      assertions: {
        // PWA score must be 90 or above (issue #539 acceptance criterion)
        'categories:pwa': ['error', { minScore: 0.9 }],
        // Keep performance and accessibility healthy while we're here
        'categories:performance': ['warn', { minScore: 0.8 }],
        'categories:accessibility': ['warn', { minScore: 0.9 }],
        // Service-worker must be present and registered
        'service-worker': 'error',
        // offline.html must be served when offline
        'works-offline': 'error',
        // Web app manifest is required for the full PWA checklist
        'installable-manifest': 'error',
      },
    },
    upload: {
      // Set LHCI_TOKEN env var and point to your LHCI server, or
      // use target: 'temporary-public-storage' for quick CI checks.
      target: 'filesystem',
      outputDir: '.lighthouseci',
    },
  },
}
