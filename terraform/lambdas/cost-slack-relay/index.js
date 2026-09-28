/**
 * cost-slack-relay/index.js
 *
 * Lambda function that receives AWS Cost Anomaly alerts via SNS
 * and posts them to a Slack #ops channel via incoming webhook.
 *
 * The webhook is read from AWS Secrets Manager at invoke time rather than being
 * injected as a plain environment variable, so it never appears in the Lambda
 * configuration or in a deployment log.
 *
 * The only dependency is the AWS SDK v3 bundled with the Node.js 20 runtime;
 * the Slack call itself uses the built-in https module.
 */

const https = require("https");
const {
  SecretsManagerClient,
  GetSecretValueCommand,
} = require("@aws-sdk/client-secrets-manager");

const secrets = new SecretsManagerClient({});

const SLACK_WEBHOOK_SECRET_ARN = process.env.SLACK_WEBHOOK_SECRET_ARN;
const SLACK_CHANNEL = process.env.SLACK_CHANNEL || "#ops";

/**
 * Resolve the Slack webhook URL from Secrets Manager.
 */
async function resolveWebhookUrl() {
  const res = await secrets.send(
    new GetSecretValueCommand({ SecretId: SLACK_WEBHOOK_SECRET_ARN })
  );
  return res.SecretString;
}

/**
 * Post a message to Slack via incoming webhook.
 */
function postToSlack(webhookUrl, text) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      channel: SLACK_CHANNEL,
      text,
      unfurl_links: false,
    });

    const parsed = new URL(webhookUrl);
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
      },
    };

    const req = https.request(options, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(body);
        } else {
          reject(new Error(`Slack returned ${res.statusCode}: ${body}`));
        }
      });
    });

    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

/**
 * Format the SNS message into a Slack-friendly block.
 */
function formatMessage(snsMessage) {
  // SNS publishes the raw JSON in the Message field
  let detail;
  try {
    detail = JSON.parse(snsMessage.Message || snsMessage);
  } catch {
    detail = { raw: snsMessage.Message || snsMessage };
  }

  const header = "🚨 *AWS Cost Anomaly Alert*";
  const monitor = detail.MonitorName || detail.monitor_name || "Unknown monitor";
  const impact = detail.AnomalyTotalImpactAbsolute || detail.total_impact || "N/A";
  const date = detail.Date || detail.date || new Date().toISOString().slice(0, 10);

  const lines = [
    header,
    `*Monitor:* ${monitor}`,
    `*Anomaly Impact:* $${impact} USD`,
    `*Date:* ${date}`,
    detail.Explanation ? `*Explanation:* ${detail.Explanation}` : "",
    "",
    `<https://console.aws.amazon.com/costmanagement/home#/cost-explorer|View in Cost Explorer>`,
  ].filter(Boolean);

  return lines.join("\n");
}

/**
 * Lambda handler — triggered by SNS.
 */
exports.handler = async (event) => {
  console.log("Received event:", JSON.stringify(event, null, 2));

  if (!SLACK_WEBHOOK_SECRET_ARN) {
    console.error("SLACK_WEBHOOK_SECRET_ARN is not configured");
    return { statusCode: 500, body: "Missing SLACK_WEBHOOK_SECRET_ARN" };
  }

  let slackWebhookUrl;
  try {
    slackWebhookUrl = await resolveWebhookUrl();
  } catch (err) {
    console.error("Failed to read Slack webhook from Secrets Manager:", err.message);
    return { statusCode: 500, body: "Unable to read Slack webhook secret" };
  }

  const results = [];

  for (const record of event.Records) {
    const snsMessage = record.Sns;
    const slackText = formatMessage(snsMessage);

    try {
      await postToSlack(slackWebhookUrl, slackText);
      console.log("Posted to Slack:", slackText.slice(0, 100));
      results.push({ status: "ok" });
    } catch (err) {
      console.error("Failed to post to Slack:", err.message);
      results.push({ status: "error", error: err.message });
    }
  }

  // Log daily cost report summary to CloudWatch
  console.log(
    JSON.stringify({
      reportType: "cost_anomaly",
      timestamp: new Date().toISOString(),
      alertsProcessed: results.length,
      results,
    })
  );

  return {
    statusCode: 200,
    body: JSON.stringify({ processed: results.length }),
  };
};
