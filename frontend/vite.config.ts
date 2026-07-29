import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import path from "path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon-16.svg", "favicon-32.svg", "favicon-180.svg", "logo.svg"],
      manifest: {
        name: "VestingStream",
        short_name: "VestingStream",
        description: "Cliff + drip vesting on Stellar",
        theme_color: "#1d6ae5",
        background_color: "#f9fafb",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        scope: "/",
        icons: [
          {
            src: "favicon-180.svg",
            sizes: "180x180",
            type: "image/svg+xml",
            purpose: "any maskable",
          },
          {
            src: "favicon-32.svg",
            sizes: "32x32",
            type: "image/svg+xml",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico,woff,woff2}"],
        navigateFallback: "/offline.html",
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/horizon-testnet\.stellar\.org\//,
            handler: "NetworkFirst",
            options: {
              cacheName: "horizon-api",
              expiration: { maxAgeSeconds: 60 },
            },
          },
          {
            urlPattern: /^https:\/\/api\.coingecko\.com\//,
            handler: "NetworkFirst",
            options: {
              cacheName: "coingecko-api",
              expiration: { maxAgeSeconds: 300 },
            },
          },
        ],
      },
    }),
  ],
});
