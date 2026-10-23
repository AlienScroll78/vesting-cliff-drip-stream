/**
 * monthly-cost-report/index.js
 *
 * Runs on the 2nd of each month and reports the previous month's spend,
 * broken down by service, against the configured budget.
 *
 * Cost Explorer data lags roughly 24 hours behind real time, so reporting on
 * the 1st would show a partial month. The 2nd is the first day the previous
 * month is complete in Cost Explorer.
 *
 * The result is published to the same SNS topic as budget and anomaly alerts,
 * which fans out to email and to the Slack relay in #ops.
 *
 * The only dependency is the AWS SDK v3 bundled with the Node.js 20 runtime.
 */

const {
  CostExplorerClient,
  GetCostAndUsageCommand,
  GetBudgetsCommand,
} = require('@aws-sdk/client-cost-explorer');

const {
  SNSClient,
  PublishCommand,
} = require('@aws-sdk/client-sns');

const ce = new CostExplorerClient({});
const sns = new SNSClient({});

const TOPIC_ARN = process.env.SNS_TOPIC_ARN;
const ENVIRONMENT = process.env.ENVIRONMENT;
const BUDGET_NAME = process.env.BUDGET_NAME;
const PROJECT_TAG_KEY = process.env.PROJECT_TAG_KEY;

const fmt = (date) => date.toISOString().slice(0, 10);

/** The calendar month before `now`, as the half-open range Cost Explorer wants. */
function previousMonth(now) {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return { start: fmt(start), end: fmt(end) };
}

/** Unblended spend for the month, grouped by service. */
async function serviceBreakdown(period) {
  const res = await ce.send(
    new GetCostAndUsageCommand({
      TimePeriod: period,
      Granularity: "MONTHLY",
      Metrics: ["UnblendedCost"],
      GroupBy: [
        { Type: "DIMENSION", Key: "SERVICE" },
        { Type: "TAG", Key: PROJECT_TAG_KEY },
      ],
    }),
  );

  const groups = res.ResultsByTime[0]?.Groups ?? [];
  const rows = groups
    .map((g) => ({
      service: g.Keys[0],
      amount: Number(g.Metrics.UnblendedCost.Amount),
    }))
    .filter((r) => r.amount > 0)
    .sort((a, b) => b.amount - a.amount);

  const total = rows.reduce((sum, r) => sum + r.amount, 0);
  return { rows, total };
}

/** Actual spend against the budget, so the report can show utilisation. */
async function budgetUtilisation(period) {
  const res = await ce.send(
    new GetBudgetsCommand({
      TimePeriod: { Start: period.start, End: period.end },
    }),
  );

  const budget = (res.Budgets ?? []).find((b) => b.BudgetName === BUDGET_NAME);
  if (!budget) return null;

  const actual = Number(
    budget.ActualSpend?.Amount ?? budget.CalculatedSpend?.Amount ?? 0,
  );
  const limit = Number(budget.BudgetLimit?.Amount ?? 0);

  return {
    actual,
    limit,
    percent: limit > 0 ? (actual / limit) * 100 : 0,
  };
}

function formatReport(period, { rows, total }, budget) {
  const lines = [
    `*Monthly AWS cost report — ${ENVIRONMENT}*`,
    `*Period:* ${period.start} to ${period.end}`,
    `*Total (unblended):* $${total.toFixed(2)}`,
  ];

  if (budget) {
    const state = budget.percent >= 100 ? "OVER" : budget.percent >= 80 ? "WARNING" : "OK";
    lines.push(
      `*Budget:* $${budget.actual.toFixed(2)} of $${budget.limit.toFixed(2)} ` +
        `(${budget.percent.toFixed(1)}% — ${state})`,
    );
  } else {
    lines.push(`*Budget:* ${BUDGET_NAME} not found for this period`);
  }

  lines.push("", "*By service:*");
  for (const row of rows.slice(0, 10)) {
    const share = total > 0 ? ((row.amount / total) * 100).toFixed(1) : "0.0";
    lines.push(`• ${row.service}: $${row.amount.toFixed(2)} (${share}%)`);
  }
  if (rows.length > 10) {
    lines.push(`• …and ${rows.length - 10} more services`);
  }

  lines.push(
    "",
    "<https://console.aws.amazon.com/costmanagement/home#/cost-explorer|View in Cost Explorer>",
  );

  return lines.join("\n");
}

exports.handler = async () => {
  const period = previousMonth(new Date());

  const [breakdown, budget] = await Promise.all([
    serviceBreakdown(period),
    budgetUtilisation(period),
  ]);

  const text = formatReport(period, breakdown, budget);

  await sns.send(
    new PublishCommand({
      TopicArn: TOPIC_ARN,
      Subject: `Monthly AWS cost report — ${ENVIRONMENT} — $${breakdown.total.toFixed(2)}`,
      Message: JSON.stringify({
        reportType: "monthly_cost",
        environment: ENVIRONMENT,
        period,
        total: breakdown.total,
        byService: breakdown.rows,
        budget,
        text,
      }),
    }),
  );

  // Also logged so the report is retrievable from CloudWatch without opening
  // the SNS topic.
  console.log(JSON.stringify({ reportType: "monthly_cost", period, total: breakdown.total, budget }));

  return { statusCode: 200, total: breakdown.total };
};
