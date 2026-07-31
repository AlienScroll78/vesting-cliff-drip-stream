"use strict";

/**
 * GraphQL endpoint — mount as:
 *   app.use('/graphql', graphqlHandler)
 *
 * GET  /graphql  → GraphiQL playground (non-production only)
 * POST /graphql  → GraphQL query execution
 *
 * Depth limiting: GRAPHQL_MAX_DEPTH env var (default: 5)
 */

const { buildSchema, parse, execute } = require("graphql");
const { checkDepth } = require("../graphql-depth-limit");
const { StellarSdk, loadConfig } = require("../lib");

const MAX_DEPTH = parseInt(process.env.GRAPHQL_MAX_DEPTH ?? "5", 10);

const schema = buildSchema(`
  type VestingSchedule {
    recipient: String!
    sponsor: String!
    token: String!
    rate: String!
    cliffLedger: Int!
    endLedger: Int!
    claimableAmount: String!
    isCliffPassed: Boolean!
  }

  type Query {
    schedule(recipient: String!): VestingSchedule
    claimableAmount(recipient: String!): String!
  }
`);

async function fetchSchedule(recipient, config) {
  const server = new StellarSdk.SorobanRpc.Server(config.SOROBAN_RPC_URL);
  const contract = new StellarSdk.Contract(config.CONTRACT_ID);
  const account = await server.getAccount(config.SPONSOR_PUBLIC_KEY ?? recipient);

  const tx = new StellarSdk.TransactionBuilder(
    { accountId: () => recipient, sequenceNumber: () => "0", incrementSequenceNumber: () => {} },
    { fee: StellarSdk.BASE_FEE, networkPassphrase: config.NETWORK_PASSPHRASE }
  )
    .addOperation(contract.call("get_schedule", StellarSdk.Address.fromString(recipient).toScVal()))
    .setTimeout(15)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (!sim.result?.retval) return null;

  const val = sim.result.retval;
  if (val.switch().name === "scvVoid") return null;

  // Parse the map returned by get_schedule
  const map = val.value().value();
  const field = (name) => {
    const entry = map.find((e) => e.key().value().toString() === name);
    return entry ? entry.val() : null;
  };

  const claimTx = new StellarSdk.TransactionBuilder(
    { accountId: () => recipient, sequenceNumber: () => "0", incrementSequenceNumber: () => {} },
    { fee: StellarSdk.BASE_FEE, networkPassphrase: config.NETWORK_PASSPHRASE }
  )
    .addOperation(contract.call("claimable_amount", StellarSdk.Address.fromString(recipient).toScVal()))
    .setTimeout(15)
    .build();

  const claimSim = await server.simulateTransaction(claimTx);
  const claimable = claimSim.result?.retval?.value()?.toString() ?? "0";

  const cliffLedger = Number(field("cliff_ledger")?.value() ?? 0);
  const currentLedger = (await server.getLatestLedger()).sequence;

  return {
    recipient,
    sponsor: field("sponsor")?.value()?.toString() ?? "",
    token: field("token")?.value()?.toString() ?? "",
    rate: field("rate_per_ledger")?.value()?.toString() ?? "0",
    cliffLedger,
    endLedger: Number(field("end_ledger")?.value() ?? 0),
    claimableAmount: claimable,
    isCliffPassed: currentLedger >= cliffLedger,
  };
}

const rootValue = {
  async schedule({ recipient }) {
    try {
      const config = loadConfig(true);
      return await fetchSchedule(recipient, config);
    } catch {
      return null;
    }
  },
  async claimableAmount({ recipient }) {
    try {
      const config = loadConfig(true);
      const schedule = await fetchSchedule(recipient, config);
      return schedule?.claimableAmount ?? "0";
    } catch {
      return "0";
    }
  },
};

const GRAPHIQL_HTML = `<!DOCTYPE html>
<html>
<head>
  <title>GraphiQL — VestingDrips</title>
  <link rel="stylesheet" href="https://unpkg.com/graphiql@3/graphiql.min.css" />
</head>
<body style="margin:0">
  <div id="graphiql" style="height:100vh"></div>
  <script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
  <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
  <script crossorigin src="https://unpkg.com/graphiql@3/graphiql.min.js"></script>
  <script>
    ReactDOM.createRoot(document.getElementById('graphiql')).render(
      React.createElement(GraphiQL, { fetcher: GraphiQL.createFetcher({ url: '/graphql' }) })
    );
  </script>
</body>
</html>`;

async function graphqlHandler(req, res) {
  // GraphiQL playground for GET requests in non-production
  if (req.method === "GET" && process.env.NODE_ENV !== "production") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(GRAPHIQL_HTML);
    return;
  }

  if (req.method !== "POST") {
    res.writeHead(405, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  let body = "";
  await new Promise((resolve) => { req.on("data", (c) => { body += c; }); req.on("end", resolve); });

  let query, variables, operationName;
  try {
    ({ query, variables, operationName } = JSON.parse(body));
  } catch {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ errors: [{ message: "invalid JSON" }] }));
    return;
  }

  let document;
  try {
    document = parse(query);
  } catch (err) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ errors: [{ message: err.message }] }));
    return;
  }

  try {
    checkDepth(document, MAX_DEPTH);
  } catch (err) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ errors: [{ message: err.message }] }));
    return;
  }

  const result = await execute({ schema, document, rootValue, variableValues: variables, operationName });
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(result));
}

module.exports = { graphqlHandler };
