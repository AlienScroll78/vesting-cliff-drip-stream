"use client";
import { useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { Skeleton } from "./Skeletons";
import styles from "./DataTable.module.css";

export type SortDirection = "asc" | "desc";

export type SortType = "string" | "number" | "date";

export type DataTablePageSize = 10 | 25 | 50;

export type DataTableValue = string | number | Date | null | undefined;

export interface DataTableSort {
  key: string;
  direction: SortDirection;
}

export interface DataTableColumn<T> {
  key: string;
  header: string;
  sortType?: SortType;
  sortValue?: (row: T) => DataTableValue;
  render?: (row: T) => ReactNode;
  sortable?: boolean;
  align?: "left" | "right";
}

export interface DataTablePagination {
  page?: number;
  pageSize?: DataTablePageSize;
  total?: number;
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (pageSize: DataTablePageSize) => void;
}

export interface DataTableLabels {
  columns?: string;
  rowsPerPage?: string;
  pageOf?: (page: number, totalPages: number) => string;
  firstPage?: string;
  previousPage?: string;
  nextPage?: string;
  lastPage?: string;
  pagination?: string;
  empty?: string;
  loading?: string;
  loadingRows?: (count: number) => string;
  showing?: (from: number, to: number, total: number) => string;
  sortedBy?: (header: string, direction: SortDirection) => string;
  notSorted?: string;
  openRow?: (header: string) => string;
}

export interface DataTableProps<T> {
  caption: string;
  columns: DataTableColumn<T>[];
  data: T[];
  getRowId: (row: T) => string;
  pagination?: DataTablePagination;
  initialSort?: DataTableSort;
  isLoading?: boolean;
  onRowClick?: (row: T) => void;
  rowHref?: (row: T) => string;
  emptyState?: ReactNode;
  loadingSlot?: ReactNode;
  skeletonRows?: number;
  labels?: DataTableLabels;
  className?: string;
}

export const DATA_TABLE_PAGE_SIZES: readonly DataTablePageSize[] = [10, 25, 50];

export const MOBILE_CARD_QUERY = "(max-width: 639px)";

function isBlank(value: DataTableValue): value is null | undefined {
  return value === null || value === undefined;
}

function toTime(value: Exclude<DataTableValue, null | undefined>): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  return new Date(value).getTime();
}

export function compareValues(
  a: DataTableValue,
  b: DataTableValue,
  type: SortType = "string",
): number {
  if (isBlank(a) && isBlank(b)) return 0;
  if (isBlank(a)) return 1;
  if (isBlank(b)) return -1;

  if (type === "number") {
    const left = Number(a);
    const right = Number(b);
    if (Number.isNaN(left) && Number.isNaN(right)) return 0;
    if (Number.isNaN(left)) return 1;
    if (Number.isNaN(right)) return -1;
    if (left === right) return 0;
    return left < right ? -1 : 1;
  }

  if (type === "date") {
    const left = toTime(a);
    const right = toTime(b);
    if (Number.isNaN(left) && Number.isNaN(right)) return 0;
    if (Number.isNaN(left)) return 1;
    if (Number.isNaN(right)) return -1;
    if (left === right) return 0;
    return left < right ? -1 : 1;
  }

  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

function isSortable<T>(column: DataTableColumn<T>): boolean {
  return column.sortable !== false && typeof column.sortValue === "function";
}

function cellValue<T>(column: DataTableColumn<T>, row: T): DataTableValue {
  return column.sortValue ? column.sortValue(row) : null;
}

function defaultCellContent(value: DataTableValue): ReactNode {
  if (isBlank(value)) return "—";
  if (value instanceof Date) return value.toLocaleDateString();
  return value;
}

function sortRows<T>(rows: T[], column: DataTableColumn<T>, direction: SortDirection): T[] {
  const sign = direction === "asc" ? 1 : -1;
  return [...rows].sort((left, right) => {
    const a = cellValue(column, left);
    const b = cellValue(column, right);
    if (isBlank(a) && isBlank(b)) return 0;
    if (isBlank(a)) return 1;
    if (isBlank(b)) return -1;
    return sign * compareValues(a, b, column.sortType ?? "string");
  });
}

function defaultLabels(): Required<
  Pick<
    DataTableLabels,
    | "columns"
    | "rowsPerPage"
    | "pageOf"
    | "firstPage"
    | "previousPage"
    | "nextPage"
    | "lastPage"
    | "pagination"
    | "empty"
    | "loading"
    | "loadingRows"
    | "showing"
    | "sortedBy"
    | "notSorted"
    | "openRow"
  >
> {
  return {
    columns: "Columns",
    rowsPerPage: "Rows per page",
    pageOf: (page, totalPages) => `Page ${page} of ${totalPages}`,
    firstPage: "Go to first page",
    previousPage: "Go to previous page",
    nextPage: "Go to next page",
    lastPage: "Go to last page",
    pagination: "Pagination",
    empty: "No rows to display.",
    loading: "Loading",
    loadingRows: (count) => `Loading ${count} rows`,
    showing: (from, to, total) => `Showing ${from} to ${to} of ${total}`,
    sortedBy: (header, direction) =>
      `${header}, sorted ${direction === "asc" ? "ascending" : "descending"}`,
    notSorted: "not sorted, activate to sort ascending",
    openRow: (header) => `Open row, ${header}`,
  };
}

function resolveLabels(labels?: DataTableLabels) {
  return { ...defaultLabels(), ...labels };
}

export function DataTable<T>({
  caption,
  columns,
  data: rows,
  getRowId,
  pagination,
  initialSort,
  isLoading = false,
  onRowClick,
  rowHref,
  emptyState,
  loadingSlot,
  skeletonRows = 5,
  labels,
  className,
}: DataTableProps<T>) {
  const l = resolveLabels(labels);
  const isMobile = useMediaQuery(MOBILE_CARD_QUERY);
  const [sort, setSort] = useState<DataTableSort | null>(initialSort ?? null);
  const [hiddenKeys, setHiddenKeys] = useState<string[]>([]);
  const [page, setPage] = useState(pagination?.page ?? 1);
  const [pageSize, setPageSize] = useState<DataTablePageSize>(pagination?.pageSize ?? 25);

  const isClientPaginated = pagination?.total === undefined;
  const showPageSize = isClientPaginated || pagination?.onPageSizeChange !== undefined;

  const visibleColumns = useMemo(
    () => columns.filter((column) => !hiddenKeys.includes(column.key)),
    [columns, hiddenKeys],
  );

  const sortedRows = useMemo(() => {
    if (!sort) return rows;
    const column = columns.find((candidate) => candidate.key === sort.key);
    if (!column) return rows;
    return sortRows(rows, column, sort.direction);
  }, [rows, columns, sort]);

  const totalRows = pagination?.total ?? sortedRows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const currentPage = Math.min(pagination?.page ?? page, totalPages);
  const visibleRows = isClientPaginated
    ? sortedRows.slice((currentPage - 1) * pageSize, currentPage * pageSize)
    : sortedRows;

  const rangeStart = totalRows === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const rangeEnd = Math.min(currentPage * pageSize, totalRows);

  const goToPage = (next: number) => {
    const clamped = Math.min(Math.max(next, 1), totalPages);
    setPage(clamped);
    pagination?.onPageChange?.(clamped);
  };

  const changePageSize = (next: DataTablePageSize) => {
    setPageSize(next);
    setPage(1);
    pagination?.onPageSizeChange?.(next);
    pagination?.onPageChange?.(1);
  };

  const toggleSort = (key: string) => {
    setSort((previous) => {
      if (previous?.key !== key) return { key, direction: "asc" };
      if (previous.direction === "asc") return { key, direction: "desc" };
      return null;
    });
    if (isClientPaginated) {
      setPage(1);
      pagination?.onPageChange?.(1);
    }
  };

  const toggleColumn = (key: string) => {
    setHiddenKeys((previous) =>
      previous.includes(key) ? previous.filter((entry) => entry !== key) : [...previous, key],
    );
  };

  const statusText = [
    sort
      ? l.sortedBy(
          columns.find((column) => column.key === sort.key)?.header ?? sort.key,
          sort.direction,
        )
      : null,
    l.showing(rangeStart, rangeEnd, totalRows),
  ]
    .filter(Boolean)
    .join(". ");

  const handleRowKeyDown = (event: KeyboardEvent<HTMLElement>, row: T) => {
    if (event.target !== event.currentTarget) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onRowClick?.(row);
  };

  const renderCell = (column: DataTableColumn<T>, row: T): ReactNode =>
    column.render ? column.render(row) : defaultCellContent(cellValue(column, row));

  const firstVisibleColumn = visibleColumns[0];
  const renderFirstCell = (row: T): ReactNode => {
    if (!firstVisibleColumn) return null;
    const content = renderCell(firstVisibleColumn, row);
    const href = rowHref?.(row);
    if (!href) return content;
    return (
      <a
        className={styles.cellLink}
        href={href}
        aria-label={l.openRow(String(cellValue(firstVisibleColumn, row) ?? caption))}
        onClick={(event) => event.stopPropagation()}
      >
        {content}
      </a>
    );
  };

  const tableHeader = (
    <tr>
      {visibleColumns.map((column) => {
        const sortable = isSortable(column);
        const active = sortable && sort?.key === column.key;
        const sortAnnouncement = active
          ? l.sortedBy(column.header, sort.direction)
          : l.notSorted;
        return (
          <th
            key={column.key}
            scope="col"
            className={column.align === "right" ? styles.alignRight : undefined}
            aria-sort={
              sortable
                ? active
                  ? sort.direction === "asc"
                    ? "ascending"
                    : "descending"
                  : "none"
                : undefined
            }
          >
            {sortable ? (
              <button
                type="button"
                className={styles.sortButton}
                onClick={() => toggleSort(column.key)}
                data-testid={`data-table-sort-${column.key}`}
              >
                <span>{column.header}</span>
                <span className={styles.sortIndicator} aria-hidden="true">
                  {active ? (sort.direction === "asc" ? "▲" : "▼") : "↕"}
                </span>
                <span className={styles.srOnly}>{sortAnnouncement}</span>
              </button>
            ) : (
              column.header
            )}
          </th>
        );
      })}
    </tr>
  );

  const tableBody = (
    <tbody>
      {visibleRows.map((row) => (
        <tr
          key={getRowId(row)}
          className={onRowClick ? styles.clickableRow : undefined}
          tabIndex={onRowClick ? 0 : undefined}
          onClick={onRowClick ? () => onRowClick(row) : undefined}
          onKeyDown={onRowClick ? (event) => handleRowKeyDown(event, row) : undefined}
        >
          {visibleColumns.map((column, index) => (
            <td
              key={column.key}
              className={column.align === "right" ? styles.alignRight : undefined}
            >
              {index === 0 ? renderFirstCell(row) : renderCell(column, row)}
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  );

  const skeleton = (
    <div
      className={styles.skeleton}
      aria-hidden="true"
      data-testid="data-table-skeleton"
      style={{ gridTemplateColumns: `repeat(${Math.max(visibleColumns.length, 1)}, minmax(0, 1fr))` }}
    >
      {Array.from({ length: skeletonRows }, (_, rowIndex) =>
        Array.from({ length: Math.max(visibleColumns.length, 1) }, (_, columnIndex) => (
          <Skeleton
            key={`${rowIndex}-${columnIndex}`}
            height="0.875rem"
            width={columnIndex === 0 ? "70%" : "85%"}
          />
        )),
      )}
    </div>
  );

  const paginationNav = (
    <nav className={styles.pagination} aria-label={l.pagination}>
      <button
        type="button"
        className={styles.pageButton}
        onClick={() => goToPage(1)}
        disabled={currentPage === 1}
        aria-label={l.firstPage}
      >
        ⟨⟨
      </button>
      <button
        type="button"
        className={styles.pageButton}
        onClick={() => goToPage(currentPage - 1)}
        disabled={currentPage === 1}
        aria-label={l.previousPage}
      >
        ⟨
      </button>
      <span className={styles.pageInfo}>{l.pageOf(currentPage, totalPages)}</span>
      <button
        type="button"
        className={styles.pageButton}
        onClick={() => goToPage(currentPage + 1)}
        disabled={currentPage === totalPages}
        aria-label={l.nextPage}
      >
        ⟩
      </button>
      <button
        type="button"
        className={styles.pageButton}
        onClick={() => goToPage(totalPages)}
        disabled={currentPage === totalPages}
        aria-label={l.lastPage}
      >
        ⟩⟩
      </button>
    </nav>
  );

  const isEmpty = !isLoading && visibleRows.length === 0;

  return (
    <div className={[styles.container, className].filter(Boolean).join(" ")}>
      <div className={styles.toolbar}>
        <details className={styles.columnVisibility}>
          <summary className={styles.columnVisibilitySummary}>{l.columns}</summary>
          <div className={styles.columnVisibilityPanel}>
            {columns.map((column) => (
              <label key={column.key} className={styles.columnVisibilityOption}>
                <input
                  type="checkbox"
                  checked={!hiddenKeys.includes(column.key)}
                  onChange={() => toggleColumn(column.key)}
                />
                <span>{column.header}</span>
              </label>
            ))}
          </div>
        </details>
        {showPageSize && (
          <label className={styles.pageSizeControl}>
            <span>{l.rowsPerPage}</span>
            <select
              className={styles.pageSizeSelect}
              value={pageSize}
              onChange={(event) => changePageSize(Number(event.target.value) as DataTablePageSize)}
            >
              {DATA_TABLE_PAGE_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div role="status" aria-live="polite" className={styles.status}>
        {isLoading ? l.loadingRows(skeletonRows) : statusText}
      </div>

      {isLoading ? (
        <div className={styles.scrollWrapper} aria-busy="true" aria-label={l.loading}>
          {loadingSlot ?? skeleton}
        </div>
      ) : isEmpty ? (
        <div className={styles.emptyState} data-testid="data-table-empty">
          {emptyState ?? l.empty}
        </div>
      ) : isMobile ? (
        <ul className={styles.cardList}>
          {visibleRows.map((row) => (
            <li
              key={getRowId(row)}
              className={[styles.card, onRowClick ? styles.clickableRow : undefined]
                .filter(Boolean)
                .join(" ")}
              tabIndex={onRowClick ? 0 : undefined}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              onKeyDown={onRowClick ? (event) => handleRowKeyDown(event, row) : undefined}
            >
              {visibleColumns.map((column) => (
                <div key={column.key} className={styles.cardRow}>
                  <span className={styles.cardLabel}>{column.header}</span>
                  <span className={styles.cardValue}>{renderCell(column, row)}</span>
                </div>
              ))}
            </li>
          ))}
        </ul>
      ) : (
        <div className={styles.scrollWrapper}>
          <table className={styles.table}>
            <caption className={styles.caption}>{caption}</caption>
            <thead className={styles.stickyHeader}>{tableHeader}</thead>
            {tableBody}
          </table>
        </div>
      )}

      {!isLoading && !isEmpty && paginationNav}
    </div>
  );
}
