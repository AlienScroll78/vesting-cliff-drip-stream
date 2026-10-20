import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  Skeleton,
  DashboardSkeleton,
  SponsorStreamListSkeleton,
  StreamExplorerSkeleton,
  NotificationListSkeleton,
  AnalyticsSummarySkeleton,
} from "./Skeletons";

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
