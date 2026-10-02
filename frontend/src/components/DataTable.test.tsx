import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DataTable, compareValues, DATA_TABLE_PAGE_SIZES } from "@/components/DataTable";
import type { DataTableColumn } from "@/components/DataTable";

interface Row {
  id: string;
  name: string;
  amount: number;
  createdAt: string | null;
}

const ROWS: Row[] = [
  { id: "1", name: "Bravo", amount: 300, createdAt: "2024-03-01T00:00:00.000Z" },
  { id: "2", name: "alpha", amount: 100, createdAt: null },
  { id: "3", name: "Charlie", amount: 200, createdAt: "2024-01-01T00:00:00.000Z" },
  { id: "4", name: "Delta", amount: 200, createdAt: "2024-02-01T00:00:00.000Z" },
];

const COLUMNS: DataTableColumn<Row>[] = [
  { key: "name", header: "Name", sortValue: (row) => row.name },
  { key: "amount", header: "Amount", sortType: "number", sortValue: (row) => row.amount, align: "right" },
  {
    key: "createdAt",
    header: "Created",
    sortType: "date",
    sortValue: (row) => row.createdAt,
  },
];

function renderTable(overrides: Partial<React.ComponentProps<typeof DataTable<Row>>> = {}) {
  return render(
    <DataTable<Row>
      caption="Test streams"
      columns={COLUMNS}
      data={ROWS}
      getRowId={(row) => row.id}
      {...overrides}
    />,
  );
}

function rowNames(): string[] {
  return within(screen.getByRole("table"))
    .getAllByRole("row")
    .slice(1)
    .map((row) => within(row).getAllByRole("cell")[0]?.textContent ?? "");
}

function mockMatchMedia(matches: boolean) {
  const listeners: Array<() => void> = [];
  const mql = {
    matches,
    media: "",
    onchange: null,
    addEventListener: vi.fn((_event: string, cb: () => void) => {
      listeners.push(cb);
    }),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  };
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn((query: string) => ({ ...mql, media: query })),
  });
  return {
    trigger(next: boolean) {
      mql.matches = next;
      for (const listener of listeners) listener();
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("compareValues", () => {
  it("compares strings case-insensitively with numeric awareness", () => {
    expect(compareValues("alpha", "Bravo", "string")).toBeLessThan(0);
    expect(compareValues("Bravo", "alpha", "string")).toBeGreaterThan(0);
    expect(compareValues("item 2", "item 10", "string")).toBeLessThan(0);
    expect(compareValues("same", "same", "string")).toBe(0);
  });

  it("compares numbers ascending and descending", () => {
    expect(compareValues(1, 2, "number")).toBe(-1);
    expect(compareValues(2, 1, "number")).toBe(1);
    expect(compareValues(2, 2, "number")).toBe(0);
  });

  it("compares dates and accepts Date instances", () => {
    expect(compareValues("2024-01-01T00:00:00.000Z", "2024-02-01T00:00:00.000Z", "date")).toBe(-1);
    expect(compareValues(new Date("2024-03-01"), new Date("2024-02-01"), "date")).toBe(1);
  });

  it("treats blanks as the largest value and unparseable values as blanks", () => {
    expect(compareValues(null, 1, "number")).toBe(1);
    expect(compareValues(1, undefined, "number")).toBe(-1);
    expect(compareValues(null, undefined, "number")).toBe(0);
    expect(compareValues("not-a-date", "2024-01-01", "date")).toBe(1);
    expect(compareValues("abc", 5, "number")).toBe(1);
  });

  it("defaults to string comparison", () => {
    expect(compareValues("a", "b")).toBeLessThan(0);
  });
});

describe("DataTable rendering", () => {
  it("renders a real table with a caption and column headers", () => {
    renderTable();
    const table = screen.getByRole("table", { name: "Test streams" });
    expect(table.tagName).toBe("TABLE");
    expect(screen.getByText("Test streams").tagName).toBe("CAPTION");
    for (const header of ["Name", "Amount", "Created"]) {
      expect(screen.getByRole("columnheader", { name: new RegExp(header) })).toHaveAttribute(
        "scope",
        "col",
      );
    }
  });

  it("renders one row per record and one cell per column", () => {
    renderTable();
    const rows = within(screen.getByRole("table")).getAllByRole("row");
    expect(rows).toHaveLength(ROWS.length + 1);
    expect(within(rows[1] as HTMLElement).getAllByRole("cell")).toHaveLength(COLUMNS.length);
    expect(rowNames()).toEqual(["Bravo", "alpha", "Charlie", "Delta"]);
  });

  it("uses a native button as the sort trigger", () => {
    renderTable();
    const trigger = screen.getByTestId("data-table-sort-name");
    expect(trigger.tagName).toBe("BUTTON");
    expect(trigger).toHaveAttribute("type", "button");
    expect(trigger.querySelector("[class*='srOnly']")).toBeInTheDocument();
  });

  it("renders non-sortable columns without a sort trigger", () => {
    renderTable({
      columns: [...COLUMNS, { key: "actions", header: "Actions", sortable: false }],
    });
    expect(screen.queryByTestId("data-table-sort-actions")).not.toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Actions" })).not.toHaveAttribute("aria-sort");
  });

  it("renders a null date cell as an em dash", () => {
    renderTable();
    expect(screen.getAllByText("—")).toHaveLength(1);
  });

  it("applies the sticky header class to the table head", () => {
    const { container } = renderTable();
    const head = container.querySelector("thead");
    expect(head?.className).toMatch(/stickyHeader/);
    const wrapper = container.querySelector("table")?.parentElement;
    expect(wrapper?.className).toMatch(/scrollWrapper/);
  });
});

describe("DataTable accessibility", () => {
  it("marks unsorted sortable columns as aria-sort none and sorts ascending on first click", async () => {
    renderTable();
    const header = screen.getByRole("columnheader", { name: /Name/ });
    expect(header).toHaveAttribute("aria-sort", "none");

    await userEvent.click(screen.getByTestId("data-table-sort-name"));

    expect(screen.getByRole("columnheader", { name: /Name/ })).toHaveAttribute(
      "aria-sort",
      "ascending",
    );
    expect(rowNames()).toEqual(["alpha", "Bravo", "Charlie", "Delta"]);
  });

  it("announces the sort direction to screen readers and via the live region", async () => {
    renderTable();
    await userEvent.click(screen.getByTestId("data-table-sort-name"));
    expect(screen.getByTestId("data-table-sort-name")).toHaveTextContent(
      "Name, sorted ascending",
    );

    await userEvent.click(screen.getByTestId("data-table-sort-name"));
    expect(screen.getByTestId("data-table-sort-name")).toHaveTextContent(
      "Name, sorted descending",
    );
    expect(rowNames()).toEqual(["Delta", "Charlie", "Bravo", "alpha"]);
  });

  it("announces the visible range in a polite status region", async () => {
    renderTable();
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveTextContent("Showing 1 to 4 of 4");

    await userEvent.click(screen.getByTestId("data-table-sort-amount"));
    expect(status).toHaveTextContent("Amount, sorted ascending. Showing 1 to 4 of 4");
  });

  it("keeps nulls last in both directions", async () => {
    renderTable();
    await userEvent.click(screen.getByTestId("data-table-sort-createdAt"));
    expect(rowNames()).toEqual(["Charlie", "Delta", "Bravo", "alpha"]);

    await userEvent.click(screen.getByTestId("data-table-sort-createdAt"));
    expect(rowNames()).toEqual(["Bravo", "Delta", "Charlie", "alpha"]);
  });
});

describe("DataTable sorting and pagination", () => {
  const manyRows: Row[] = Array.from({ length: 30 }, (_, index) => ({
    id: String(index),
    name: `Row ${String(index).padStart(2, "0")}`,
    amount: 30 - index,
    createdAt: null,
  }));

  it("sorts by a column then paginates the sorted order", async () => {
    renderTable({ data: manyRows, pagination: { pageSize: 10 } });
    expect(rowNames()).toHaveLength(10);
    expect(rowNames()[0]).toBe("Row 00");

    await userEvent.click(screen.getByTestId("data-table-sort-name"));
    expect(rowNames()[0]).toBe("Row 00");

    await userEvent.click(screen.getByTestId("data-table-sort-name"));
    expect(rowNames().slice(0, 3)).toEqual(["Row 29", "Row 28", "Row 27"]);
    expect(screen.getByText("Page 1 of 3")).toBeInTheDocument();
  });

  it("paginates through pages with the pagination nav", async () => {
    renderTable({ data: manyRows, pagination: { pageSize: 10 } });
    const nav = screen.getByRole("navigation", { name: "Pagination" });
    expect(within(nav).getByLabelText("Go to first page")).toBeDisabled();

    await userEvent.click(within(nav).getByLabelText("Go to next page"));
    expect(rowNames().slice(0, 3)).toEqual(["Row 10", "Row 11", "Row 12"]);

    await userEvent.click(within(nav).getByLabelText("Go to last page"));
    expect(rowNames().slice(0, 3)).toEqual(["Row 20", "Row 21", "Row 22"]);

    await userEvent.click(within(nav).getByLabelText("Go to previous page"));
    expect(rowNames().slice(0, 3)).toEqual(["Row 10", "Row 11", "Row 12"]);
  });

  it("calls onPageChange when paginating", async () => {
    const onPageChange = vi.fn();
    renderTable({ data: manyRows, pagination: { pageSize: 10, onPageChange } });
    await userEvent.click(screen.getByLabelText("Go to next page"));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it("offers 10, 25 and 50 row page sizes and re-slices on change", async () => {
    renderTable({ data: manyRows });
    const select = screen.getByLabelText("Rows per page");
    expect(within(select).getAllByRole("option").map((option) => option.textContent)).toEqual(
      DATA_TABLE_PAGE_SIZES.map(String),
    );

    await userEvent.selectOptions(select, "10");
    expect(screen.getByText("Page 1 of 3")).toBeInTheDocument();
    expect(rowNames()).toHaveLength(10);

    await userEvent.selectOptions(select, "25");
    expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();
    expect(rowNames()).toHaveLength(25);

    await userEvent.selectOptions(select, "50");
    expect(screen.getByText("Page 1 of 1")).toBeInTheDocument();
    expect(rowNames()).toHaveLength(30);
  });

  it("starts on the requested page for external pagination and does not re-slice", async () => {
    const pageRows = manyRows.slice(20, 25);
    renderTable({
      data: pageRows,
      pagination: { page: 3, pageSize: 10, total: 30 },
    });
    expect(screen.getByText("Page 3 of 3")).toBeInTheDocument();
    expect(rowNames()).toEqual(["Row 20", "Row 21", "Row 22", "Row 23", "Row 24"]);
    expect(screen.queryByLabelText("Rows per page")).not.toBeInTheDocument();
  });

  it("resets to the first page when the sort column changes", async () => {
    const onPageChange = vi.fn();
    renderTable({ data: manyRows, pagination: { page: 2, onPageChange } });
    expect(screen.getByText("Page 2 of 2")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("data-table-sort-name"));
    expect(onPageChange).toHaveBeenCalledWith(1);
  });
});

describe("DataTable column visibility", () => {
  it("hides and restores a column from a native details disclosure", async () => {
    const { container } = renderTable();
    const disclosure = container.querySelector("details");
    expect(disclosure).toBeInTheDocument();
    expect(within(disclosure as HTMLElement).getByText("Columns").tagName).toBe("SUMMARY");

    const amountCheckbox = within(disclosure as HTMLElement).getByLabelText("Amount");
    await userEvent.click(amountCheckbox);
    expect(amountCheckbox).not.toBeChecked();
    expect(screen.queryByRole("columnheader", { name: /Amount/ })).not.toBeInTheDocument();
    expect(screen.queryByText("300")).not.toBeInTheDocument();

    await userEvent.click(amountCheckbox);
    expect(screen.getByRole("columnheader", { name: /Amount/ })).toBeInTheDocument();
  });

  it("lists every column in the disclosure", () => {
    const { container } = renderTable();
    const disclosure = container.querySelector("details") as HTMLElement;
    expect(within(disclosure).getAllByRole("checkbox")).toHaveLength(COLUMNS.length);
  });
});

describe("DataTable row interaction", () => {
  it("calls onRowClick without changing the row role", async () => {
    const onRowClick = vi.fn();
    renderTable({ onRowClick });
    const firstRow = screen.getAllByRole("row")[1] as HTMLElement;
    expect(firstRow.tagName).toBe("TR");
    expect(firstRow).not.toHaveAttribute("role");

    await userEvent.click(firstRow);
    expect(onRowClick).toHaveBeenCalledWith(ROWS[0]);
  });

  it("activates a focused row with Enter and Space", async () => {
    const onRowClick = vi.fn();
    renderTable({ onRowClick });
    const rows = screen.getAllByRole("row");
    const secondRow = rows[2] as HTMLElement;
    secondRow.focus();
    expect(secondRow).toHaveAttribute("tabindex", "0");

    await userEvent.keyboard("{Enter}");
    expect(onRowClick).toHaveBeenCalledWith(ROWS[1]);

    await userEvent.keyboard(" ");
    expect(onRowClick).toHaveBeenCalledTimes(2);
    expect(onRowClick).toHaveBeenLastCalledWith(ROWS[1]);
  });

  it("is not focusable when no row click handler is supplied", () => {
    renderTable();
    const firstRow = screen.getAllByRole("row")[1] as HTMLElement;
    expect(firstRow).not.toHaveAttribute("tabindex");
  });

  it("renders a navigation link in the first cell when rowHref is provided", () => {
    renderTable({ rowHref: (row) => `/streams/${row.id}` });
    const link = screen.getByRole("link", { name: "Open row, Bravo" });
    expect(link).toHaveAttribute("href", "/streams/1");
  });
});

describe("DataTable mobile layout", () => {
  it("renders a card list instead of a table below 640px", () => {
    mockMatchMedia(true);
    renderTable();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();

    const list = screen.getByRole("list");
    expect(list.tagName).toBe("UL");
    const cards = within(list).getAllByRole("listitem");
    expect(cards).toHaveLength(ROWS.length);
    expect(within(cards[0] as HTMLElement).getByText("Bravo")).toBeInTheDocument();
    expect(within(cards[0] as HTMLElement).getByText("Name")).toBeInTheDocument();
  });

  it("keeps the pagination nav available in the card layout", () => {
    mockMatchMedia(true);
    renderTable({ data: Array.from({ length: 30 }, (_, index) => ({ ...ROWS[0]!, id: `x${index}` })) });
    expect(screen.getByRole("navigation", { name: "Pagination" })).toBeInTheDocument();
  });

  it("supports row activation from cards", async () => {
    mockMatchMedia(true);
    const onRowClick = vi.fn();
    renderTable({ onRowClick });
    const card = within(screen.getByRole("list")).getAllByRole("listitem")[2] as HTMLElement;
    card.focus();
    await userEvent.keyboard("{Enter}");
    expect(onRowClick).toHaveBeenCalledWith(ROWS[2]);
  });
});

describe("DataTable empty state", () => {
  it("renders the default message when there are no rows", () => {
    renderTable({ data: [] });
    expect(screen.getByTestId("data-table-empty")).toHaveTextContent("No rows to display.");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });

  it("renders the emptyState slot", () => {
    renderTable({ data: [], emptyState: <p>No streams yet</p> });
    expect(screen.getByText("No streams yet")).toBeInTheDocument();
  });
});

describe("DataTable loading state", () => {
  it("renders the default skeleton slot and hides the table", () => {
    const { container } = renderTable({ isLoading: true });
    expect(screen.getByTestId("data-table-skeleton")).toBeInTheDocument();
    expect(screen.getByLabelText("Loading")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("status")).toHaveTextContent("Loading 5 rows");
    expect(container.querySelector("table")).not.toBeInTheDocument();
  });

  it("renders the loadingSlot slot when provided", () => {
    renderTable({ isLoading: true, loadingSlot: <p>Fetching streams</p> });
    expect(screen.getByText("Fetching streams")).toBeInTheDocument();
    expect(screen.queryByTestId("data-table-skeleton")).not.toBeInTheDocument();
  });

  it("uses a custom skeleton row count and loading label", () => {
    renderTable({ isLoading: true, skeletonRows: 2, labels: { loadingRows: (n) => `${n} pending` } });
    expect(screen.getByRole("status")).toHaveTextContent("2 pending");
  });
});
