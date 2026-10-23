/**
 * alarm-slack-relay/index.js
 *
 * Lambda function that receives CloudWatch alarm notifications via SNS
 * and posts them to Slack #ops with alarm name, current value, threshold,
 * and runbook link.
 *
 * The webhook URL is read from AWS Secrets Manager at invoke time — never
 * stored in Lambda configuration. Uses the same secret as the cost-slack-relay.
 *
 * Only dependency: the AWS SDK v3 bundled with the Node.js 20 runtime.
 */

const https = require("https");
const {
  SecretsManagerClient,
  GetSecretValueCommand,
} = require("@aws-sdk/client-secrets-manager");

const secrets = new SecretsManagerClient({});

const SLACK_WEBHOOK_SECRET_ARN = process.env.SLACK_WEBHOOK_SECRET_ARN;
const SLACK_CHANNEL = process.env.SLACK_CHANNEL || "#ops";
const ENVIRONMENT = process.env.ENVIRONMENT || "unknown";

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
 * Pick a runbook link based on the alarm name.
 */
function runbookLink(alarmName) {
  const base = "https://github.com/Praisefotos1/vesting-cliff-drip-stream/blob/main/docs/runbooks";
  if (alarmName.includes("rds") || alarmName.includes("storage")) {
    return `${base}/rds-restore.md`;
  }
  if (alarmName.includes("backup")) {
    return `${base}/backup-restore-verification.md`;
  }
  if (alarmName.includes("drift") || alarmName.includes("terraform")) {
    return `${base}/drift-reconciliation.md`;
  }
  if (alarmName.includes("indexer")) {
    return `${base}/backfill-stream-events.md`;
  }
  return `${base}/README.md`;
}

/**
 * Format a CloudWatch alarm SNS message into a Slack-friendly block.
 *
 * CloudWatch sends the alarm notification as a JSON object in the SNS Message
 * field. We extract the key fields: AlarmName, NewStateValue,
 * Trigger.Threshold, Trigger.Period, and the alarm description.
 */
function formatAlarmMessage(snsMessage) {
  let alarm;
  try {
    alarm = JSON.parse(snsMessage.Message || snsMessage);
  } catch {
    // Not a JSON alarm message — pass through as text
    return `⚠️ *Alert* (${ENVIRONMENT})\n\`\`\`\n${snsMessage.Message || JSON.stringify(snsMessage)}\n\`\`\``;
  }

  const alarmName = alarm.AlarmName || "Unknown alarm";
  const newState = alarm.NewStateValue || "UNKNOWN";
  const oldState = alarm.OldStateValue || "UNKNOWN";
  const description = alarm.AlarmDescription || "";
  const threshold = alarm.Trigger?.Threshold ?? "N/A";
  const metricName = alarm.Trigger?.MetricName ?? alarm.Trigger?.Metrics?.[0]?.Metric?.MetricName ?? "N/A";
  const namespace = alarm.Trigger?.Namespace ?? alarm.Trigger?.Metrics?.[0]?.Metric?.Namespace ?? "N/A";

  // Extract the current value from the trigger if available
  let currentValue = "N/A";
  if (alarm.Trigger?.Dimensions) {
    currentValue = alarm.StateChangeReason?.replace(/.*\((\d+\.?\d*).*/, "$1") || "N/A";
  }
  if (alarm.StateChangeReason) {
    const match = alarm.StateChangeReason.match(/\(.*?(\d+\.?\d*).*?\)/);
    if (match) currentValue = match[1];
  }

  const link = runbookLink(alarmName);

  const emoji = newState === "ALARM" ? "🚨" : newState === "OK" ? "✅" : "⚠️";

  const lines = [
    `${emoji} *CloudWatch Alarm: ${alarmName}*`,
    `*Environment:* ${ENVIRONMENT}`,
    `*State:* ${oldState} → ${newState}`,
    `*Metric:* ${namespace}/${metricName}`,
    `*Threshold:* ${threshold}`,
    `*Current Value:* ${currentValue}`,
    description ? `*Description:* ${description}` : "",
    "",
    `*Runbook:* <${link}|View runbook>`,
  ].filter(Boolean);

  return lines.join("\n");
}

/**
 * Lambda handler — triggered by SNS.
 */
exports.handler = async (event) => {
  console.log("Received alarm event:", JSON.stringify(event, null, 2));

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
    const slackText = formatAlarmMessage(snsMessage);

    try {
      await postToSlack(slackWebhookUrl, slackText);
      console.log("Posted alarm to Slack:", slackText.slice(0, 120));
      results.push({ status: "ok" });
    } catch (err) {
      console.error("Failed to post to Slack:", err.message);
      results.push({ status: "error", error: err.message });
    }
  }

  console.log(
    JSON.stringify({
      reportType: "cloudwatch_alarm",
      timestamp: new Date().toISOString(),
      alarmsProcessed: results.length,
      results,
    })
  );

  return {
    statusCode: 200,
    body: JSON.stringify({ processed: results.length }),
  };
};
