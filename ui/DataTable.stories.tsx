import type { Meta, StoryObj } from "@storybook/react";
import { expect, within, userEvent } from "@storybook/test";
import React from "react";
import { DataTable } from "../frontend/src/components/DataTable";
import type { DataTableColumn } from "../frontend/src/components/DataTable";

interface StreamRow {
  id: string;
  name: string;
  token: string;
  amount: number;
  startedAt: string | null;
  status: "Active" | "Pre-cliff" | "Completed" | "Cancelled";
}

const COLUMNS: DataTableColumn<StreamRow>[] = [
  { key: "name", header: "Name", sortType: "string", sortValue: (row) => row.name },
  { key: "token", header: "Token", sortType: "string", sortValue: (row) => row.token },
  {
    key: "amount",
    header: "Amount",
    sortType: "number",
    align: "right",
    sortValue: (row) => row.amount,
    render: (row) => row.amount.toLocaleString(),
  },
  {
    key: "startedAt",
    header: "Started",
    sortType: "date",
    sortValue: (row) => row.startedAt,
    render: (row) => (row.startedAt ? new Date(row.startedAt).toLocaleDateString() : "—"),
  },
  { key: "status", header: "Status", sortType: "string", sortValue: (row) => row.status },
];

const ROWS: StreamRow[] = Array.from({ length: 24 }, (_, index) => ({
  id: `stream-${index + 1}`,
  name: `Stream ${String(index + 1).padStart(2, "0")}`,
  token: index % 3 === 0 ? "XLM" : "USDC",
  amount: (index + 1) * 1_250,
  startedAt:
    index % 7 === 3
      ? null
      : new Date(Date.UTC(2024, 0, 1 + index * 6)).toISOString(),
  status: (["Active", "Pre-cliff", "Completed", "Cancelled"] as const)[index % 4] ?? "Active",
}));

const meta: Meta<typeof DataTable<StreamRow>> = {
  title: "Components/DataTable",
  component: DataTable,
  tags: ["autodocs"],
  argTypes: {
    caption: { control: "text", description: "Table caption, announced by screen readers." },
    isLoading: { control: "boolean", description: "Swaps the body for a skeleton." },
  },
  parameters: {
    docs: {
      description: {
        component:
          "Responsive data table with client-side sorting, 10/25/50 pagination, column visibility, row-click navigation, a sticky header and a card layout below 640px.",
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof DataTable<StreamRow>>;

const baseArgs = {
  caption: "Vesting streams",
  columns: COLUMNS,
  data: ROWS,
  getRowId: (row: StreamRow) => row.id,
};

export const Default: Story = {
  name: "Populated",
  args: baseArgs,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTestId("data-table-sort-amount"));
    expect(canvas.getByRole("columnheader", { name: /Amount/ })).toHaveAttribute(
      "aria-sort",
      "ascending",
    );
  },
};

export const Empty: Story = {
  args: { ...baseArgs, data: [], emptyState: <p>No streams match the current filters.</p> },
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getByTestId("data-table-empty")).toBeInTheDocument();
  },
};

export const Loading: Story = {
  args: { ...baseArgs, isLoading: true },
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getByTestId("data-table-skeleton")).toBeInTheDocument();
  },
};

export const MixedSortTypes: Story = {
  name: "Mixed sort types",
  args: {
    ...baseArgs,
    initialSort: { key: "startedAt", direction: "asc" },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTestId("data-table-sort-amount"));
    expect(canvas.getByTestId("data-table-sort-amount")).toHaveTextContent(
      "Amount, sorted ascending",
    );
  },
};

export const WithRowClick: Story = {
  args: { ...baseArgs, onRowClick: () => undefined },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const row = canvas.getAllByRole("row")[1];
    expect(row).toHaveAttribute("tabindex", "0");
    await userEvent.click(row as HTMLElement);
  },
};

export const MobileCards: Story = {
  args: baseArgs,
  parameters: {
    viewport: { defaultViewport: "mobile1" },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.queryByRole("table")).not.toBeInTheDocument();
    expect(canvas.getAllByRole("listitem").length).toBeGreaterThan(0);
  },
};
