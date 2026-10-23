import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SponsorStreamTable } from "./SponsorStreamTable";
import type { VestingStream } from "@/types";

const STREAMS: VestingStream[] = [
  {
    id: "1",
    recipient: "GRECIPIENT1",
    sponsor: "GSPONSOR",
    token: "USDC",
    rate: 10,
    claimableAmount: 1500,
    status: "active",
    startLedger: 51_000_000,
    cliffLedger: 51_100_000,
    endLedger: 52_000_000,
  },
  {
    id: "2",
    recipient: "GRECIPIENT2",
    sponsor: "GSPONSOR",
    token: "XLM",
    rate: 5,
    claimableAmount: 500,
    status: "completed",
  },
];

function renderTable(overrides: Partial<React.ComponentProps<typeof SponsorStreamTable>> = {}) {
  return render(
    <SponsorStreamTable
      streams={STREAMS}
      page={1}
      pageSize={25}
      total={STREAMS.length}
      onPageChange={vi.fn()}
      {...overrides}
    />,
  );
}

function recipients(): string[] {
  return within(screen.getByRole("table", { name: "Sponsor vesting streams" }))
    .getAllByRole("row")
    .slice(1)
    .map((row) => within(row).getAllByRole("cell")[0]?.textContent ?? "");
}

describe("SponsorStreamTable", () => {
  it("renders recipient, status, schedule, and claimable columns", () => {
    renderTable();

    for (const header of ["Recipient", "Status", "Cliff Date", "End Date", "Claimable", "Actions"]) {
      expect(screen.getByRole("columnheader", { name: new RegExp(header) })).toBeInTheDocument();
    }
    expect(recipients()).toEqual(["GRECIPIENT1", "GRECIPIENT2"]);
    expect(screen.getByLabelText("Status: Active")).toBeInTheDocument();
  });

  it("sorts claimable amounts numerically", async () => {
    renderTable();

    await userEvent.click(screen.getByTestId("data-table-sort-claimable"));
    expect(recipients()).toEqual(["GRECIPIENT2", "GRECIPIENT1"]);

    await userEvent.click(screen.getByTestId("data-table-sort-claimable"));
    expect(recipients()).toEqual(["GRECIPIENT1", "GRECIPIENT2"]);
  });

  it("uses row and View clicks without double-firing", async () => {
    const onViewDetails = vi.fn();
    renderTable({ onViewDetails });

    await userEvent.click(screen.getAllByRole("row")[1] as HTMLElement);
    expect(onViewDetails).toHaveBeenCalledTimes(1);
    expect(onViewDetails).toHaveBeenLastCalledWith("1");

    await userEvent.click(
      screen.getByRole("button", { name: "View details for recipient GRECIPIENT1" })
    );
    expect(onViewDetails).toHaveBeenCalledTimes(2);
  });

  it("preserves cancel availability rules", async () => {
    const onCancelStream = vi.fn();
    renderTable({ onCancelStream });

    const cancelActive = screen.getByRole("button", {
      name: "Cancel stream for recipient GRECIPIENT1",
    });
    const cancelCompleted = screen.getByRole("button", {
      name: "Cancel stream for recipient GRECIPIENT2",
    });

    expect(cancelCompleted).toBeDisabled();
    await userEvent.click(cancelActive);
    expect(onCancelStream).toHaveBeenCalledWith("1");
  });

  it("renders the DataTable loading state", () => {
    renderTable({ isLoading: true });

    expect(screen.getByTestId("data-table-skeleton")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
