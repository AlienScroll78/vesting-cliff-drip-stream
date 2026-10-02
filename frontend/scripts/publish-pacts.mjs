#!/usr/bin/env node
/**
 * publish-pacts.mjs — pushes generated pact contracts to the Pact Broker.
 *
 * Environment variables:
 *   PACT_BROKER_URL      — e.g. http://localhost:9292 or https://xxx.pactflow.io
 *   PACT_BROKER_TOKEN    — bearer token (PactFlow) or empty for basic auth
 *   PACT_BROKER_USERNAME — basic auth username (self-hosted)
 *   PACT_BROKER_PASSWORD — basic auth password (self-hosted)
 *   GITHUB_SHA           — commit SHA used as the consumer version tag
 *   GITHUB_REF_NAME      — branch name for tagging (e.g. "main", "feat/xxx")
 */

import { Publisher } from "@pact-foundation/pact";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const brokerUrl = process.env.PACT_BROKER_URL;
if (!brokerUrl) {
  console.error("ERROR: PACT_BROKER_URL is not set.");
  process.exit(1);
}

const consumerVersion = process.env.GITHUB_SHA ?? "local-" + Date.now();
const branch = process.env.GITHUB_REF_NAME ?? "local";

/** Build auth options depending on whether we have a bearer token or credentials. */
function authOptions() {
  if (process.env.PACT_BROKER_TOKEN) {
    return { pactBrokerToken: process.env.PACT_BROKER_TOKEN };
  }
  if (process.env.PACT_BROKER_USERNAME) {
    return {
      pactBrokerUsername: process.env.PACT_BROKER_USERNAME,
      pactBrokerPassword: process.env.PACT_BROKER_PASSWORD ?? "",
    };
  }
  return {};
}

const opts = {
  pactFilesOrDirs: [path.resolve(__dirname, "../../pacts")],
  pactBroker: brokerUrl,
  consumerVersion,
  branch,
  tags: [branch],
  ...authOptions(),
};

console.log(`Publishing pacts (version: ${consumerVersion}, branch: ${branch}) to ${brokerUrl} …`);

const publisher = new Publisher(opts);
publisher
  .publishPacts()
  .then(() => {
    console.log("Pacts published successfully.");
  })
  .catch((err) => {
    console.error("Failed to publish pacts:", err);
    process.exit(1);
  });
