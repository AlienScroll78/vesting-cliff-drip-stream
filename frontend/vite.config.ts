import { defineConfig, Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

/**
 * SW_VERSION is stamped into public/sw.js at build time so every production
 * deployment gets a fresh cache key, invalidating stale app-shell assets.
 * In dev mode the string stays as "dev" to avoid cache churn during HMR.
 */
const swVersion =
  process.env.NODE_ENV === 'production' ? `v${Date.now()}` : 'dev'

/**
 * Custom Vite plugin: replaces the bare __SW_VERSION__ identifier inside
 * public/sw.js during the build. Vite copies public/ files verbatim without
 * running them through the define transform, so we need this extra step.
 */
function swVersionPlugin(): Plugin {
  return {
    name: 'sw-version-stamp',
    apply: 'build',
    generateBundle(_options, bundle) {
      const swAsset = bundle['sw.js']
      if (swAsset && swAsset.type === 'asset' && typeof swAsset.source === 'string') {
        swAsset.source = swAsset.source.replace(
          /typeof __SW_VERSION__ !== 'undefined' \? __SW_VERSION__ : 'dev'/g,
          JSON.stringify(swVersion)
        )
      }
    },
  }
}

export default defineConfig({
  plugins: [react(), swVersionPlugin()],

  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },

  define: {
    // Makes __SW_VERSION__ available to any bundled module (e.g., if the
    // registration helper in App.tsx ever needs to read the version).
    __SW_VERSION__: JSON.stringify(swVersion),
  },

  build: {
    target: 'es2017',
    sourcemap: true,
  },
})
