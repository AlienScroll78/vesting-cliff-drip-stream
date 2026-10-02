"use client";
/**
 * LazyRouter — lazy loading and code splitting for route bundles (#771)
 *
 * All route pages are loaded via React.lazy + Suspense so they are excluded
 * from the initial bundle and only fetched when the user navigates to them.
 * Each route shows a skeleton screen while its chunk is loading.
 *
 * Route matching is intentionally minimal (no third-party router needed):
 *   /                  → Dashboard (page.tsx)
 *   /streams           → Streams page
 *   /sponsor           → Sponsor dashboard
 *   /history           → Transaction history
 *   /notifications     → Notifications
 *   /admin             → Admin (lazy, separate chunk)
 *   /view/:recipient   → Recipient view
 */

import React, { lazy, Suspense, useEffect, useState } from "react";
import { RouteErrorBoundary, useRouteResetKey } from "@/components/ErrorBoundary";
import {
  DashboardSkeleton,
  StreamListSkeleton,
  FullPageSkeleton,
} from "@/components/Skeletons";

// ── Lazy page imports ─────────────────────────────────────────────────────────

const DashboardPage = lazy(() => import("@/app/page"));
const StreamsPage = lazy(() => import("@/app/streams/page"));
const SponsorPage = lazy(() => import("@/app/sponsor/page"));
const HistoryPage = lazy(() => import("@/app/history/page"));
const NotificationsPage = lazy(() => import("@/app/notifications/page"));
// Admin is a separate manual chunk (rarely visited)
const AdminPage = lazy(() => import("@/app/admin/page"));
const ViewPageClient = lazy(() => import("@/app/view/[recipient]/ViewPageClient"));

// ── Simple path helpers ───────────────────────────────────────────────────────

function getPathname(): string {
  return typeof window !== "undefined" ? window.location.pathname : "/";
}

function usePathname(): string {
  const [pathname, setPathname] = useState(getPathname);

  useEffect(() => {
    function handleChange() {
      setPathname(window.location.pathname);
    }

    window.addEventListener("popstate", handleChange);

    // Patch history API so programmatic pushState triggers a re-render
    const origPush = history.pushState.bind(history);
    const origReplace = history.replaceState.bind(history);

    history.pushState = function (...args) {
      origPush(...args);
      handleChange();
    };
    history.replaceState = function (...args) {
      origReplace(...args);
      handleChange();
    };

    return () => {
      window.removeEventListener("popstate", handleChange);
      history.pushState = origPush;
      history.replaceState = origReplace;
    };
  }, []);

  return pathname;
}

// ── Route matching ────────────────────────────────────────────────────────────

type RouteMatch =
  | { route: "dashboard" }
  | { route: "streams" }
  | { route: "sponsor" }
  | { route: "history" }
  | { route: "notifications" }
  | { route: "admin" }
  | { route: "view"; recipient: string }
  | { route: "not-found" };

function matchRoute(pathname: string): RouteMatch {
  const clean = pathname.replace(/\/$/, "") || "/";

  if (clean === "/") return { route: "dashboard" };
  if (clean === "/streams") return { route: "streams" };
  if (clean === "/sponsor") return { route: "sponsor" };
  if (clean === "/history") return { route: "history" };
  if (clean === "/notifications") return { route: "notifications" };
  if (clean === "/admin") return { route: "admin" };

  const viewMatch = clean.match(/^\/view\/([^/]+)$/);
  if (viewMatch) return { route: "view", recipient: decodeURIComponent(viewMatch[1]!) };

  return { route: "not-found" };
}

// ── Skeleton fallbacks per route ──────────────────────────────────────────────

function routeSkeleton(route: string): React.ReactElement {
  switch (route) {
    case "dashboard":
      return <DashboardSkeleton />;
    case "streams":
    case "sponsor":
      return <StreamListSkeleton />;
    default:
      return <FullPageSkeleton />;
  }
}

// ── Router component ──────────────────────────────────────────────────────────

/**
 * LazyRouter renders the correct page component for the current URL, wrapping
 * each in a RouteErrorBoundary and Suspense with appropriate skeleton fallback.
 *
 * Preloads the streams chunk once the wallet context mounts (dashboard users
 * are very likely to visit /streams next).
 */
export function LazyRouter() {
  const pathname = usePathname();
  const routeKey = useRouteResetKey();
  const match = matchRoute(pathname);

  // Preload the streams chunk on first render (anticipate next navigation)
  useEffect(() => {
    // Fire-and-forget — ignore errors (chunk may already be cached)
    void import("@/app/streams/page").catch(() => {});
  }, []);

  return (
    <RouteErrorBoundary routeKey={routeKey}>
      <Suspense fallback={routeSkeleton(match.route)}>
        <RouteContent match={match} />
      </Suspense>
    </RouteErrorBoundary>
  );
}

// ── Route content ─────────────────────────────────────────────────────────────

function RouteContent({ match }: { match: RouteMatch }) {
  switch (match.route) {
    case "dashboard":
      return <DashboardPage />;
    case "streams":
      return <StreamsPage />;
    case "sponsor":
      return <SponsorPage />;
    case "history":
      return <HistoryPage />;
    case "notifications":
      return <NotificationsPage />;
    case "admin":
      return <AdminPage />;
    case "view":
      return <ViewPageClient recipient={match.recipient} />;
    case "not-found":
    default:
      return <NotFound />;
  }
}

// ── 404 page ──────────────────────────────────────────────────────────────────

function NotFound() {
  return (
    <main
      role="main"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "60vh",
        gap: "1rem",
        padding: "2rem",
        textAlign: "center",
      }}
    >
      <span aria-hidden="true" style={{ fontSize: "3rem", lineHeight: 1 }}>
        🔍
      </span>
      <h1 style={{ fontSize: "1.5rem", fontWeight: 700, margin: 0 }}>
        Page not found
      </h1>
      <p style={{ color: "var(--color-text-muted, #6b7280)", maxWidth: 360 }}>
        The page you are looking for does not exist.
      </p>
      <a
        href="/"
        style={{
          color: "var(--color-active, #1d6ae5)",
          fontWeight: 600,
          textDecoration: "underline",
        }}
      >
        Go to dashboard
      </a>
    </main>
  );
}

export default LazyRouter;
