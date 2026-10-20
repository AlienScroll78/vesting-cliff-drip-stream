/**
 * cypress/support/e2e.ts
 *
 * Global Cypress support file loaded before every spec.
 * - Installs Freighter wallet mock via window stub
 * - Sets up API intercepts common to all tests
 * - Imports custom commands
 */

import "./commands";

// Silence noisy console.log in tests
Cypress.on("window:before:load", (win) => {
  cy.stub(win.console, "log").as("consoleLog");
});

// Fail tests on uncaught application exceptions, but allow Freighter-related
// errors which may surface from missing extension in the test browser.
Cypress.on("uncaught:exception", (err) => {
  if (
    err.message.includes("freighter") ||
    err.message.includes("Freighter") ||
    err.message.includes("extension")
  ) {
    return false; // prevent test failure
  }
  return true;
});
