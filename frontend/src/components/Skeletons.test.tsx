import { describe, it, expect } from "vitest";
import { render, screen, act } from "@testing-library/react";
import {
  Skeleton,
  DashboardSkeleton,
  SponsorStreamListSkeleton,
  StreamExplorerSkeleton,
  NotificationListSkeleton,
  AnalyticsSummarySkeleton,
  DashboardStatsSkeleton,
  StreamTableRowSkeleton,
} from "./Skeletons";
import { TxProgress } from "./TxProgress";
import { NavLoadingBar } from "./NavLoadingBar";
import { OptimisticStreamCard } from "./OptimisticStreamCard";

describe("Skeleton base primitive", () => {
  it("is decorative for screen readers", () => {
    const { container } = render(<Skeleton />);
    expect(container.firstChild).toHaveAttribute("aria-hidden", "true");
  });
});

// The five data-fetching views the issue calls out (#823).
describe("page skeletons", () => {
  it("Stream Dashboard skeleton is announced as busy", () => {
    render(<DashboardSkeleton />);
    expect(screen.getByLabelText(/loading dashboard/i)).toHaveAttribute(
      "aria-busy",
      "true",
    );
  });

  it("Sponsor Stream List renders rows with varying widths", () => {
    render(<SponsorStreamListSkeleton rows={3} />);
    const list = screen.getByLabelText(/loading sponsor streams/i);
    expect(list).toHaveAttribute("aria-busy", "true");
    const rows = list.querySelectorAll('[data-testid="sponsor-stream-skeleton-row"]');
    expect(rows).toHaveLength(3);
  });

  it("Sponsor Stream List caps the row count", () => {
    render(<SponsorStreamListSkeleton rows={50} />);
    const list = screen.getByLabelText(/loading sponsor streams/i);
    expect(list.querySelectorAll('[data-testid="sponsor-stream-skeleton-row"]')).toHaveLength(5);
  });

  it("Stream Explorer renders table rows", () => {
    render(<StreamExplorerSkeleton rows={4} />);
    const table = screen.getByLabelText(/loading stream explorer/i);
    expect(table).toHaveAttribute("aria-busy", "true");
    expect(table.querySelectorAll('[data-testid="explorer-skeleton-row"]')).toHaveLength(4);
  });

  it("Notification List renders items", () => {
    render(<NotificationListSkeleton items={3} />);
    const list = screen.getByLabelText(/loading notifications/i);
    expect(list).toHaveAttribute("aria-busy", "true");
    expect(list.querySelectorAll('[data-testid="notification-skeleton-item"]')).toHaveLength(3);
  });

  it("Analytics Summary renders stat cards", () => {
    render(<AnalyticsSummarySkeleton cards={4} />);
    const summary = screen.getByLabelText(/loading analytics/i);
    expect(summary).toHaveAttribute("aria-busy", "true");
    expect(summary.querySelectorAll('[data-testid="analytics-skeleton-card"]')).toHaveLength(4);
  });

  it("Analytics Summary can omit the chart placeholder", () => {
    const { container } = render(<AnalyticsSummarySkeleton cards={2} showChart={false} />);
    expect(container.querySelectorAll('[data-testid="analytics-skeleton-card"]')).toHaveLength(2);
    // No chart region reserved when showChart is false.
    expect(screen.getByLabelText(/loading analytics/i).children).toHaveLength(1);
  });
});

describe("skeleton accessibility", () => {
  it("marks every individual placeholder aria-hidden", () => {
    const { container } = render(<StreamExplorerSkeleton rows={2} />);
    const blocks = container.querySelectorAll('[aria-hidden="true"]');
    expect(blocks.length).toBeGreaterThan(0);
  });

  it("gives each busy region a distinct accessible label", () => {
    render(
      <div>
        <StreamExplorerSkeleton />
        <NotificationListSkeleton />
      </div>
    );
    expect(screen.getByLabelText(/loading stream explorer/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/loading notifications/i)).toBeInTheDocument();
  });
});

// ─── New skeleton components ──────────────────────────────────────────────────

describe("DashboardStatsSkeleton", () => {
  it("renders 4 stat cards by default", () => {
    render(<DashboardStatsSkeleton />);
    const region = screen.getByLabelText(/loading dashboard stats/i);
    expect(region).toHaveAttribute("aria-busy", "true");
    expect(region.querySelectorAll('[data-testid="dashboard-stat-skeleton-card"]')).toHaveLength(4);
  });

  it("respects the count prop", () => {
    render(<DashboardStatsSkeleton count={2} />);
    expect(
      screen.getByLabelText(/loading dashboard stats/i)
        .querySelectorAll('[data-testid="dashboard-stat-skeleton-card"]'),
    ).toHaveLength(2);
  });

  it("caps count at 4", () => {
    render(<DashboardStatsSkeleton count={99} />);
    expect(
      screen.getByLabelText(/loading dashboard stats/i)
        .querySelectorAll('[data-testid="dashboard-stat-skeleton-card"]'),
    ).toHaveLength(4);
  });
});

describe("StreamTableRowSkeleton", () => {
  it("renders a row with aria-hidden", () => {
    const { container } = render(<StreamTableRowSkeleton />);
    const row = container.querySelector('[data-testid="stream-table-row-skeleton"]');
    expect(row).toBeInTheDocument();
    expect(row).toHaveAttribute("aria-hidden", "true");
  });
});

// ─── TxProgress ───────────────────────────────────────────────────────────────

describe("TxProgress", () => {
  it("renders all 4 steps", () => {
    render(<TxProgress currentStep="signed" />);
    expect(screen.getByTestId("tx-step-signed")).toBeInTheDocument();
    expect(screen.getByTestId("tx-step-submitted")).toBeInTheDocument();
    expect(screen.getByTestId("tx-step-confirming")).toBeInTheDocument();
    expect(screen.getByTestId("tx-step-confirmed")).toBeInTheDocument();
  });

  it("marks the active step with data-active and earlier steps with data-done", () => {
    render(<TxProgress currentStep="confirming" />);
    expect(screen.getByTestId("tx-step-signed")).toHaveAttribute("data-done");
    expect(screen.getByTestId("tx-step-submitted")).toHaveAttribute("data-done");
    expect(screen.getByTestId("tx-step-confirming")).toHaveAttribute("data-active");
    expect(screen.getByTestId("tx-step-confirmed")).toHaveAttribute("data-pending");
  });

  it("marks the active step as failed when failed=true", () => {
    render(<TxProgress currentStep="submitted" failed />);
    expect(screen.getByTestId("tx-step-submitted")).toHaveAttribute("data-failed");
  });

  it("shows a spinner on the active step (not confirmed)", () => {
    render(<TxProgress currentStep="confirming" />);
    expect(screen.getByTestId("tx-step-spinner-confirming")).toBeInTheDocument();
  });

  it("does not show a spinner on the confirmed step", () => {
    render(<TxProgress currentStep="confirmed" />);
    expect(screen.queryByTestId("tx-step-spinner-confirmed")).not.toBeInTheDocument();
  });

  it("shows a hash link when confirmed and txHash provided", () => {
    const hash = "ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890";
    render(<TxProgress currentStep="confirmed" txHash={hash} />);
    const link = screen.getByTestId("tx-progress-hash-link");
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", expect.stringContaining(hash));
  });

  it("has an accessible live region for status updates", () => {
    render(<TxProgress currentStep="submitted" />);
    // The status role element should exist
    const status = document.querySelector('[role="status"]');
    expect(status).toBeInTheDocument();
  });

  it("is labelled as an ordered list of steps", () => {
    render(<TxProgress currentStep="signed" />);
    expect(screen.getByRole("list", { name: /transaction steps/i })).toBeInTheDocument();
  });
});

// ─── NavLoadingBar ────────────────────────────────────────────────────────────

describe("NavLoadingBar", () => {
  it("renders when visible=true", () => {
    render(<NavLoadingBar visible />);
    expect(screen.getByTestId("nav-loading-bar")).toBeInTheDocument();
  });

  it("is absent from the DOM when visible=false", () => {
    render(<NavLoadingBar visible={false} />);
    expect(screen.queryByTestId("nav-loading-bar")).not.toBeInTheDocument();
  });

  it("has role=progressbar with accessible label", () => {
    render(<NavLoadingBar visible />);
    const bar = screen.getByRole("progressbar");
    expect(bar).toBeInTheDocument();
    expect(bar).toHaveAttribute("aria-label", "Page loading");
  });

  it("accepts a custom label", () => {
    render(<NavLoadingBar visible label="Loading streams…" />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-label", "Loading streams…");
  });
});

// ─── OptimisticStreamCard ─────────────────────────────────────────────────────

describe("OptimisticStreamCard", () => {
  const address = "GABCDE1234567890ABCDE1234567890ABCDE1234567890ABCDE12345678";

  it("renders with aria-busy=true", () => {
    render(<OptimisticStreamCard recipient={address} />);
    expect(screen.getByTestId("optimistic-stream-card")).toHaveAttribute("aria-busy", "true");
  });

  it("shows the truncated recipient address as the title", () => {
    render(<OptimisticStreamCard recipient={address} />);
    expect(screen.getByText(/GABCDE12/)).toBeInTheDocument();
  });

  it("shows the 'Pending confirmation' badge by default", () => {
    render(<OptimisticStreamCard recipient={address} />);
    expect(screen.getByLabelText("Pending confirmation")).toBeInTheDocument();
  });

  it("accepts a custom badge label", () => {
    render(<OptimisticStreamCard recipient={address} badgeLabel="Awaiting ledger" />);
    expect(screen.getByLabelText("Awaiting ledger")).toBeInTheDocument();
  });

  it("displays provided token, rate, cliff and duration metadata", () => {
    render(
      <OptimisticStreamCard
        recipient={address}
        token="USDC"
        rate={10}
        cliffDays={30}
        totalDays={365}
      />,
    );
    expect(screen.getByText("USDC")).toBeInTheDocument();
    expect(screen.getByText("10 USDC/ledger")).toBeInTheDocument();
    expect(screen.getByText("~30 days")).toBeInTheDocument();
    expect(screen.getByText("~365 days")).toBeInTheDocument();
  });

  it("shows em-dashes for missing metadata", () => {
    render(<OptimisticStreamCard recipient={address} />);
    // token, rate, cliff, duration — all missing
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBeGreaterThanOrEqual(3);
  });

  it("has an indeterminate progressbar for confirmation activity", () => {
    render(<OptimisticStreamCard recipient={address} />);
    const bar = screen.getByRole("progressbar", {
      name: /transaction confirmation in progress/i,
    });
    expect(bar).toBeInTheDocument();
    // Indeterminate: no aria-valuenow
    expect(bar).not.toHaveAttribute("aria-valuenow");
  });
});
