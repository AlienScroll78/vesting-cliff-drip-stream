"use client";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  TooltipProps,
} from "recharts";

const LEDGERS_PER_DAY = Math.round((24 * 60 * 60) / 5);
const CHART_POINTS = 60; // number of data points

interface ScheduleInput {
  startLedger: number;
  cliffLedger: number;
  endLedger: number;
  rate: number; // tokens per ledger
  tokenSymbol?: string;
  currentLedger?: number;
}

interface DataPoint {
  ledger: number;
  /** Days from start (for X axis label) */
  dayOffset: number;
  cumulative: number;
}

function buildChartData(s: ScheduleInput): DataPoint[] {
  const { startLedger, cliffLedger, endLedger, rate } = s;
  const totalLedgers = endLedger - startLedger;
  if (totalLedgers <= 0 || rate <= 0) return [];

  const step = Math.max(1, Math.floor(totalLedgers / CHART_POINTS));
  const points: DataPoint[] = [];

  // Always include key ledgers
  const keyLedgers = new Set([startLedger, cliffLedger, endLedger]);
  if (s.currentLedger) keyLedgers.add(s.currentLedger);

  const ledgers = new Set<number>();
  for (let l = startLedger; l <= endLedger; l += step) ledgers.add(l);
  keyLedgers.forEach((l) => ledgers.add(l));

  const sorted = Array.from(ledgers).sort((a, b) => a - b);

  for (const ledger of sorted) {
    let cumulative: number;
    if (ledger < cliffLedger) {
      // Locked: nothing claimable
      cumulative = 0;
    } else if (ledger >= endLedger) {
      // Fully vested
      cumulative = rate * totalLedgers;
    } else {
      // Cliff catch-up + linear drip since cliff
      cumulative = rate * (ledger - startLedger);
    }
    points.push({
      ledger,
      dayOffset: Math.round((ledger - startLedger) / LEDGERS_PER_DAY),
      cumulative,
    });
  }
  return points;
}

function formatDay(dayOffset: number): string {
  if (dayOffset === 0) return "Day 0";
  return `Day ${dayOffset}`;
}

function CustomTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  const value = payload[0]?.value ?? 0;
  return (
    <div
      style={{
        background: "var(--color-surface, #fff)",
        border: "1px solid var(--color-border, #e5e7eb)",
        borderRadius: "0.375rem",
        padding: "0.5rem 0.75rem",
        fontSize: "0.8rem",
      }}
    >
      <div style={{ fontWeight: 600 }}>{formatDay(label as number)}</div>
      <div>{Number(value).toLocaleString()} tokens</div>
    </div>
  );
}

interface Props {
  schedule: ScheduleInput;
  /** Optional accessible description */
  description?: string;
}

export function VestingTimeline({ schedule, description }: Props) {
  const data = buildChartData(schedule);

  if (data.length === 0) {
    return (
      <p style={{ color: "#6b7280", fontSize: "0.875rem" }}>
        Invalid schedule — chart cannot be rendered.
      </p>
    );
  }

  const cliffDayOffset = Math.round((schedule.cliffLedger - schedule.startLedger) / LEDGERS_PER_DAY);
  const currentDayOffset =
    schedule.currentLedger != null
      ? Math.round((schedule.currentLedger - schedule.startLedger) / LEDGERS_PER_DAY)
      : null;
  const totalDays = Math.round((schedule.endLedger - schedule.startLedger) / LEDGERS_PER_DAY);

  const chartId = "vesting-timeline-chart";
  const descId = description ? "vesting-timeline-desc" : undefined;

  return (
    <figure
      aria-label="Vesting timeline chart"
      role="figure"
      style={{ width: "100%", margin: 0 }}
    >
      {description && (
        <figcaption
          id={descId}
          style={{ fontSize: "0.8rem", color: "#6b7280", marginBottom: "0.5rem" }}
        >
          {description}
        </figcaption>
      )}

      <div
        id={chartId}
        aria-label={`Vesting curve: cliff at day ${cliffDayOffset}, fully vested at day ${totalDays}`}
        aria-describedby={descId}
        role="img"
        data-testid="vesting-timeline"
        style={{ width: "100%", height: 220 }}
        tabIndex={0}
      >
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="vestGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--color-active, #1d6ae5)" stopOpacity={0.3} />
                <stop offset="95%" stopColor="var(--color-active, #1d6ae5)" stopOpacity={0.03} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border, #e5e7eb)" />
            <XAxis
              dataKey="dayOffset"
              tickFormatter={(v: number) => `D${v}`}
              tick={{ fontSize: 11 }}
              aria-label="Days from stream start"
            />
            <YAxis
              tickFormatter={(v: number) =>
                v >= 1_000_000
                  ? `${(v / 1_000_000).toFixed(1)}M`
                  : v >= 1_000
                  ? `${(v / 1_000).toFixed(0)}K`
                  : String(v)
              }
              tick={{ fontSize: 11 }}
              width={50}
              aria-label="Cumulative claimable tokens"
            />
            <Tooltip content={<CustomTooltip />} />

            {/* Cliff reference line */}
            <ReferenceLine
              x={cliffDayOffset}
              stroke="var(--color-pre-cliff, #b45309)"
              strokeDasharray="4 3"
              label={{
                value: "Cliff",
                position: "top",
                fontSize: 11,
                fill: "var(--color-pre-cliff, #b45309)",
              }}
            />

            {/* Current ledger position */}
            {currentDayOffset !== null && (
              <ReferenceLine
                x={currentDayOffset}
                stroke="var(--color-active, #1d6ae5)"
                strokeWidth={2}
                label={{
                  value: "Now",
                  position: "insideTopRight",
                  fontSize: 11,
                  fill: "var(--color-active, #1d6ae5)",
                }}
              />
            )}

            <Area
              type="monotone"
              dataKey="cumulative"
              stroke="var(--color-active, #1d6ae5)"
              strokeWidth={2}
              fill="url(#vestGradient)"
              dot={false}
              activeDot={{ r: 4 }}
              name={`${schedule.tokenSymbol ?? "tokens"} vested`}
              isAnimationActive={true}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Legend */}
      <div
        style={{
          display: "flex",
          gap: "1rem",
          fontSize: "0.75rem",
          color: "#6b7280",
          marginTop: "0.5rem",
          flexWrap: "wrap",
        }}
        aria-label="Chart legend"
      >
        <span>
          <span
            style={{
              display: "inline-block",
              width: 12,
              height: 3,
              background: "var(--color-active)",
              marginRight: 4,
              verticalAlign: "middle",
            }}
          />
          Cumulative vested
        </span>
        <span>
          <span
            style={{
              display: "inline-block",
              width: 12,
              height: 3,
              background: "var(--color-pre-cliff)",
              marginRight: 4,
              borderTop: "2px dashed var(--color-pre-cliff)",
              verticalAlign: "middle",
            }}
          />
          Cliff (Day {cliffDayOffset})
        </span>
        {currentDayOffset !== null && (
          <span>
            <span
              style={{
                display: "inline-block",
                width: 12,
                height: 3,
                background: "var(--color-active)",
                marginRight: 4,
                verticalAlign: "middle",
              }}
            />
            Current position
          </span>
        )}
      </div>
    </figure>
  );
}
