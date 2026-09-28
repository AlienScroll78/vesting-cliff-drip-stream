/**
 * Playwright fixture: wallet mock injection.
 *
 * Instead of loading the real Freighter extension (which requires a funded
 * testnet account and headless-incompatible browser) we inject a lightweight
 * stub that replaces the @stellar/freighter-api module at the browser level.
 *
 * The stub is stored on `window.__freighterMock` and the WalletContext reads
 * it via a route handler we install on the page before navigation.
 *
 * Usage:
 *   import { test, expect } from './fixtures/walletMock'
 *   // `page` already has the wallet pre-connected with MOCK_ADDRESS
 */

import { test as base, expect, type Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const MOCK_ADDRESS =
  "GABC1234EFGH5678IJKLMNOPQRSTUVWXYZ0123456789ABCDEFGHIJKL";

// A valid-looking Stellar testnet SAC contract address (56 chars, C-prefix)
export const MOCK_TOKEN_ADDRESS =
  "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";

export const MOCK_RECIPIENT =
  "GDEF5678IJKL9012MNOPQRSTUVWXYZ01234567890ABCDEFGHIJKLMNOP";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MockWalletState = "connected" | "disconnected" | "error";

interface WalletFixtures {
  /** Page with the Freighter API stubbed out; wallet pre-connected. */
  mockedPage: Page;
  /** Set the wallet state during a test (connected / disconnected / error). */
  setWalletState: (state: MockWalletState, address?: string) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Browser-side stub script
// ---------------------------------------------------------------------------

/**
 * Returns a JS snippet that stubs window.__freighter_api__.
 * The WalletContext imports from @stellar/freighter-api; Vite resolves these
 * to the npm module. We override the module's exports via a globalThis hook
 * that runs before the React app boots.
 */
function buildFreighterStubScript(
  address: string,
  connected: boolean
): string {
  return `
(function() {
  'use strict';
  const ADDR = ${JSON.stringify(address)};

  // The stub object mirrors the public API of @stellar/freighter-api v6
  const stub = {
    isConnected: () => Promise.resolve({ isConnected: ${connected} }),
    getAddress: () => Promise.resolve({ address: ADDR }),
    requestAccess: () => Promise.resolve({ address: ADDR }),
    setAllowed: () => Promise.resolve(true),
    signTransaction: (xdr) => Promise.resolve({ signedTxXdr: xdr }),
    signAuthEntry: (entryXdr) => Promise.resolve({ signedAuthEntry: entryXdr }),
    getNetwork: () => Promise.resolve({ network: 'TESTNET', networkPassphrase: 'Test SDF Network ; September 2015' }),
    getNetworkDetails: () => Promise.resolve({
      network: 'TESTNET',
      networkPassphrase: 'Test SDF Network ; September 2015',
      sorobanRpcUrl: 'https://soroban-testnet.stellar.org',
    }),
  };

  // Store stub on window so the app's module interceptor can pick it up.
  window.__freighterStub = stub;

  // Override global accessor used by some versions of freighter-api
  if (!window.freighter) {
    Object.defineProperty(window, 'freighter', {
      get() { return stub; },
      configurable: true,
    });
  }

  console.log('[walletMock] Freighter stub installed, address=' + ADDR + ', connected=${connected}');
})();
`;
}

// ---------------------------------------------------------------------------
// Fixture definition
// ---------------------------------------------------------------------------

export const test = base.extend<WalletFixtures>({
  mockedPage: async ({ page }, use) => {
    await installWalletMock(page, MOCK_ADDRESS, true);
    await use(page);
  },

  setWalletState: async ({ page }, use) => {
    const fn = async (state: MockWalletState, address = MOCK_ADDRESS) => {
      const connected = state === "connected";
      if (state === "error") {
        await page.evaluate(() => {
          (window as unknown as Record<string, unknown>).__freighterStub = {
            isConnected: () => Promise.resolve({ isConnected: false }),
            getAddress: () =>
              Promise.resolve({ error: "User rejected", address: "" }),
            requestAccess: () => Promise.reject(new Error("User rejected")),
          };
        });
      } else {
        await page.evaluate(
          ({ addr, conn }: { addr: string; conn: boolean }) => {
            (window as unknown as Record<string, unknown>).__freighterStub = {
              isConnected: () => Promise.resolve({ isConnected: conn }),
              getAddress: () => Promise.resolve({ address: addr }),
              requestAccess: () => Promise.resolve({ address: addr }),
              setAllowed: () => Promise.resolve(true),
              signTransaction: (xdr: string) =>
                Promise.resolve({ signedTxXdr: xdr }),
              signAuthEntry: (xdr: string) =>
                Promise.resolve({ signedAuthEntry: xdr }),
              getNetwork: () =>
                Promise.resolve({
                  network: "TESTNET",
                  networkPassphrase: "Test SDF Network ; September 2015",
                }),
            };
          },
          { addr: address, conn: connected }
        );
      }
    };
    await use(fn);
  },
});

export { expect };

// ---------------------------------------------------------------------------
// Helper: install mock on a page
// ---------------------------------------------------------------------------

/**
 * Install the Freighter stub on a Playwright page.
 *
 * Strategy:
 *  1. `addInitScript` runs before any page JS, so the stub is available as
 *     `window.__freighterStub` when the React app boots.
 *  2. We also intercept the Vite-served freighter-api module via a route
 *     that returns a tiny ES module re-exporting from `window.__freighterStub`.
 *     This works because Vite serves node_modules as individual files.
 */
export async function installWalletMock(
  page: Page,
  address: string = MOCK_ADDRESS,
  connected: boolean = true
): Promise<void> {
  // 1. Inject stub before page scripts run
  await page.addInitScript(
    buildFreighterStubScript(address, connected)
  );

  // 2. Intercept the freighter-api network request and return a stub module.
  //    Vite serves it as:  /node_modules/.vite/deps/@stellar_freighter-api.js
  //    or as a direct import from the chunk.  We catch all variants.
  await page.route(
    (url) =>
      url.pathname.includes("freighter") ||
      url.pathname.includes("@stellar_freighter"),
    async (route) => {
      const stubModule = `
// Playwright freighter-api stub
const __stub = () => window.__freighterStub || {};
export const isConnected   = (...a) => __stub().isConnected?.(...a)   ?? Promise.resolve({ isConnected: false });
export const getAddress    = (...a) => __stub().getAddress?.(...a)    ?? Promise.resolve({ address: '' });
export const requestAccess = (...a) => __stub().requestAccess?.(...a) ?? Promise.resolve({ address: '' });
export const setAllowed    = (...a) => __stub().setAllowed?.(...a)    ?? Promise.resolve(true);
export const signTransaction  = (...a) => __stub().signTransaction?.(...a)  ?? Promise.resolve({ signedTxXdr: a[0] });
export const signAuthEntry    = (...a) => __stub().signAuthEntry?.(...a)    ?? Promise.resolve({ signedAuthEntry: a[0] });
export const getNetwork       = (...a) => __stub().getNetwork?.(...a)       ?? Promise.resolve({ network: 'TESTNET', networkPassphrase: '' });
export const getNetworkDetails= (...a) => __stub().getNetworkDetails?.(...a)?? Promise.resolve({ network: 'TESTNET', networkPassphrase: '', sorobanRpcUrl: '' });
export default { isConnected, getAddress, requestAccess, setAllowed, signTransaction, signAuthEntry, getNetwork, getNetworkDetails };
`;
      await route.fulfill({
        status: 200,
        contentType: "application/javascript",
        body: stubModule,
      });
    }
  );
}
