/**
 * cypress/support/commands.ts
 *
 * Custom Cypress commands shared across all specs.
 */

// Extend the Cypress namespace to include our custom commands
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Cypress {
    interface Chainable {
      /**
       * Stub the Freighter wallet API on the window object.
       * Must be called inside a `cy.window()` callback or before page load.
       */
      stubFreighter(opts?: {
        address?: string;
        network?: string;
        isConnected?: boolean;
        rejectSign?: boolean;
        rejectConnect?: boolean;
      }): Chainable<void>;

      /** Connect the wallet via the UI connect button. */
      connectWallet(address?: string): Chainable<void>;

      /** Intercept all /api/streams/* requests with mock data. */
      interceptStreamApis(opts?: {
        recipient?: string;
        claimableAmount?: number;
        status?: string;
      }): Chainable<void>;
    }
  }
}

const DEFAULT_ADDRESS = "GABC1EXAMPLERECIPIENTADDRESSXYZ";
const DEFAULT_NETWORK = "TESTNET";

Cypress.Commands.add(
  "stubFreighter",
  (opts = {}) => {
    const {
      address = DEFAULT_ADDRESS,
      network = DEFAULT_NETWORK,
      isConnected = false,
      rejectSign = false,
      rejectConnect = false,
    } = opts;

    cy.window().then((win) => {
      // Mimic @stellar/freighter-api surface used by the app
      (win as Window & { freighterApi?: object }).freighterApi = {
        isConnected: () => Promise.resolve(isConnected),
        getAddress: () =>
          isConnected
            ? Promise.resolve({ address })
            : Promise.reject(new Error("Not connected")),
        requestAccess: () =>
          rejectConnect
            ? Promise.reject(new Error("User rejected"))
            : Promise.resolve({ address }),
        getNetwork: () => Promise.resolve({ network }),
        signTransaction: (_xdr: string, _opts: object) =>
          rejectSign
            ? Promise.reject(new Error("User rejected signing"))
            : Promise.resolve({ signedTxXdr: "SIGNED_XDR_MOCK_VALUE" }),
      };
    });
  }
);

Cypress.Commands.add("connectWallet", (address = DEFAULT_ADDRESS) => {
  cy.stubFreighter({ address, isConnected: false });
  cy.get('[data-testid="wallet-connect-btn"], [aria-label*="Connect"], button')
    .contains(/connect wallet/i)
    .first()
    .click();
  // After click, freighter.requestAccess resolves and app updates state
  cy.stubFreighter({ address, isConnected: true });
});

Cypress.Commands.add(
  "interceptStreamApis",
  (opts = {}) => {
    const {
      recipient = DEFAULT_ADDRESS,
      claimableAmount = 1500,
      status = "active",
    } = opts;

    // Stream list
    cy.intercept("GET", "/api/streams*", {
      statusCode: 200,
      body: {
        streams: [
          {
            id: "stream-1",
            recipient,
            sponsor: "GSPONSOR_ADDRESS_EXAMPLE_XYZ",
            token: "USDC",
            rate: 10,
            claimableAmount,
            status,
            startLedger: 51_027_200,
            cliffLedger: 51_113_600,
            endLedger: 57_248_000,
            totalDeposit: 63_072_000,
          },
        ],
        total: 1,
        page: 1,
        pageSize: 25,
      },
    }).as("getStreams");

    // Single stream
    cy.intercept("GET", `/api/streams/${recipient}`, {
      statusCode: 200,
      body: {
        id: "stream-1",
        recipient,
        sponsor: "GSPONSOR_ADDRESS_EXAMPLE_XYZ",
        token: "USDC",
        rate: 10,
        claimableAmount,
        status,
      },
    }).as("getStream");

    // Cancel preview
    cy.intercept("GET", `/api/streams/${recipient}/cancel-preview`, {
      statusCode: 200,
      body: {
        recipientKeeps: claimableAmount,
        sponsorRefund: 63_072_000 - claimableAmount,
        cliffReached: claimableAmount > 0,
      },
    }).as("getCancelPreview");

    // Build cancel tx
    cy.intercept("POST", `/api/streams/${recipient}/build-cancel-tx`, {
      statusCode: 200,
      body: { txXdr: "UNSIGNED_TX_XDR_MOCK" },
    }).as("buildCancelTx");

    // Claim tx
    cy.intercept("POST", `/api/streams/${recipient}/build-claim-tx`, {
      statusCode: 200,
      body: { txXdr: "UNSIGNED_CLAIM_TX_XDR_MOCK" },
    }).as("buildClaimTx");

    // Soroban RPC simulation
    cy.intercept("POST", "**/soroban/rpc", {
      statusCode: 200,
      body: {
        id: "1",
        jsonrpc: "2.0",
        result: {
          status: "SUCCESS",
          latestLedger: "51203500",
        },
      },
    }).as("sorobanRpc");
  }
);

export {};
