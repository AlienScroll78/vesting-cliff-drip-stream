/**
 * cost-slack-relay/index.js
 *
 * Lambda function that receives AWS Cost Anomaly alerts via SNS
 * and posts them to a Slack #ops channel via incoming webhook.
 *
 * No external dependencies — uses only Node.js built-in https module.
 */

const https = require("https");
const url = require("url");

const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;
const SLACK_CHANNEL = process.env.SLACK_CHANNEL || "#ops";

/**
 * Post a message to Slack via incoming webhook.
 */
function postToSlack(text) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      channel: SLACK_CHANNEL,
      text,
      unfurl_links: false,
    });

    const parsed = new URL(SLACK_WEBHOOK_URL);
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

  if (!SLACK_WEBHOOK_URL) {
    console.error("SLACK_WEBHOOK_URL is not configured");
    return { statusCode: 500, body: "Missing SLACK_WEBHOOK_URL" };
  }

  const results = [];

  for (const record of event.Records) {
    const snsMessage = record.Sns;
    const slackText = formatMessage(snsMessage);

    try {
      await postToSlack(slackText);
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
