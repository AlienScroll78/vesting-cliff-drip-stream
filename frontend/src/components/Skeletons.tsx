// Skeleton loading components — animated pulse, no layout shift.

function SkeletonBox({ width = "100%", height = "1rem", radius = "0.25rem" }: {
  width?: string; height?: string; radius?: string;
}) {
  return (
    <span
      className="skeleton"
      style={{ width, height, borderRadius: radius, display: "block" }}
      aria-hidden="true"
    />
  );
}

/** Skeleton matching a stream-card */
export function StreamCardSkeleton() {
  return (
    <li className="stream-card" style={{ flexDirection: "column", gap: "0.75rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", width: "100%" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", flex: 1 }}>
          <SkeletonBox width="60%" height="0.85rem" />
          <SkeletonBox width="3.5rem" height="1.4rem" radius="9999px" />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", alignItems: "flex-end" }}>
          <SkeletonBox width="5rem" height="1rem" />
          <SkeletonBox width="4rem" height="1.8rem" radius="0.5rem" />
        </div>
      </div>
      {/* progress bar row */}
      <SkeletonBox height="0.5rem" radius="9999px" />
    </li>
  );
}

/** Skeleton for the stats row at the top of the page */
export function StatsRowSkeleton() {
  return (
    <div style={{ display: "flex", gap: "1rem", marginBottom: "1rem" }} aria-busy="true" aria-label="Loading stats">
      {[1, 2, 3].map((i) => (
        <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", gap: "0.4rem" }}>
          <SkeletonBox width="50%" height="0.75rem" />
          <SkeletonBox width="70%" height="1.5rem" />
        </div>
      ))}
    </div>
  );
}

/** Wraps a list of StreamCardSkeletons with aria-busy */
export function StreamListSkeleton({ count = 3 }: { count?: number }) {
  return (
    <ul
      className="stream-list"
      style={{ marginTop: "1rem" }}
      aria-busy="true"
      aria-label="Loading streams"
    >
      {Array.from({ length: count }).map((_, i) => (
        <StreamCardSkeleton key={i} />
      ))}
    </ul>
  );
}
