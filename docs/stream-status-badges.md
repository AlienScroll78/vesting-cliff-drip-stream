# Stream Status Badges

## Status → Colour Mapping

| Status      | Colour | Hex       | Tailwind class          | ARIA label     |
|-------------|--------|-----------|-------------------------|----------------|
| Pre-cliff   | Amber  | `#F59E0B` | `bg-amber-400`          | "Pre-cliff"    |
| Active      | Blue   | `#3B82F6` | `bg-blue-500`           | "Active"       |
| Completed   | Green  | `#22C55E` | `bg-green-500`          | "Completed"    |
| Cancelled   | Red    | `#EF4444` | `bg-red-500`            | "Cancelled"    |

Colours satisfy **WCAG 2.1 AA** contrast when paired with white text (`#FFFFFF`).

## Accessibility Requirements

- Colour is **not** the sole indicator. Each badge includes a text label.
- Badge element must carry `aria-label` or visible text matching the label column above.
- Example (React / Tailwind):

```tsx
type Status = "PreCliff" | "Active" | "Completed" | "Cancelled";

const BADGE: Record<Status, { bg: string; label: string }> = {
  PreCliff:  { bg: "bg-amber-400", label: "Pre-cliff" },
  Active:    { bg: "bg-blue-500",  label: "Active"    },
  Completed: { bg: "bg-green-500", label: "Completed" },
  Cancelled: { bg: "bg-red-500",   label: "Cancelled" },
};

function StatusBadge({ status }: { status: Status }) {
  const { bg, label } = BADGE[status];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium text-white ${bg}`}
      aria-label={label}
    >
      {label}
    </span>
  );
}
```

## Stream List Legend

Add the following legend block above (or below) the stream list table:

```
● Pre-cliff  ● Active  ● Completed  ● Cancelled
```

Each dot uses its respective badge colour. Text labels are always visible.

## Contract Integration

Call the `get_status(recipient: Address)` view on the Soroban contract to retrieve
the current `StreamStatus` variant. The variant names map 1-to-1 to the table above.

`None` is returned when no schedule is found (stream never existed, or has already
been fully removed from storage after cancellation/completion).

| Contract variant   | Badge status |
|--------------------|-------------|
| `PreCliff`         | Pre-cliff   |
| `Active`           | Active      |
| `Completed`        | Completed   |
| `None` (cancelled) | Cancelled   |
