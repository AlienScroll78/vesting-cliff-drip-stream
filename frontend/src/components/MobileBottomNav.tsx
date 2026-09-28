"use client";
/**
 * MobileBottomNav (#279)
 *
 * Mobile-optimised bottom navigation bar that appears on viewports < 768 px.
 * Uses CSS media queries to hide itself on desktop.
 *
 * Tabs: Dashboard (/), Create (opens modal via callback), History (/history), Settings
 *
 * Accessibility:
 * - nav landmark with aria-label
 * - Each tab button has aria-current="page" when active
 * - Keyboard-navigable (tab / shift+tab between items, Enter/Space to activate)
 * - Safe-area insets via env(safe-area-inset-bottom) for notched iPhones
 */

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

// ── Types ─────────────────────────────────────────────────────────────────────

interface NavTab {
  id: string;
  label: string;
  icon: string;
  href?: string;
  action?: () => void;
  ariaLabel?: string;
}

interface Props {
  /** Called when the Create tab is tapped. */
  onCreateStream?: () => void;
  /** Called when the Settings tab is tapped (no route yet). */
  onSettings?: () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function MobileBottomNav({ onCreateStream, onSettings }: Props) {
  const pathname = usePathname();

  // Determine active tab based on current route
  function getActiveTab() {
    if (pathname === "/") return "dashboard";
    if (pathname?.startsWith("/history")) return "history";
    if (pathname?.startsWith("/streams")) return "dashboard"; // sponsor streams ≈ dashboard
    return "";
  }

  const [activeTab, setActiveTab] = useState(getActiveTab);

  useEffect(() => {
    setActiveTab(getActiveTab());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  const tabs: NavTab[] = [
    { id: "dashboard", label: "Dashboard", icon: "🏠", href: "/" },
    {
      id: "create",
      label: "Create",
      icon: "＋",
      action: onCreateStream,
      ariaLabel: "Create new stream",
    },
    { id: "history", label: "History", icon: "📋", href: "/history" },
    {
      id: "settings",
      label: "Settings",
      icon: "⚙️",
      action: onSettings,
      ariaLabel: "Open settings",
    },
  ];

  return (
    <>
      {/* Bottom safe-area padding so page content isn't hidden under the nav bar */}
      <div aria-hidden="true" className="mobile-nav-spacer" />

      <nav
        aria-label="Mobile navigation"
        className="mobile-bottom-nav"
        data-testid="mobile-bottom-nav"
      >
        {tabs.map((tab) => {
          const isCurrent = activeTab === tab.id;
          const commonProps = {
            "aria-current": (isCurrent ? "page" : undefined) as "page" | undefined,
            "aria-label": tab.ariaLabel ?? tab.label,
            "data-testid": `mobile-nav-${tab.id}`,
            className: `mobile-nav-tab${isCurrent ? " mobile-nav-tab--active" : ""}`,
          };

          if (tab.href) {
            return (
              <a
                key={tab.id}
                href={tab.href}
                {...commonProps}
                onClick={() => setActiveTab(tab.id)}
              >
                <span className="mobile-nav-icon" aria-hidden="true">
                  {tab.icon}
                </span>
                <span className="mobile-nav-label">{tab.label}</span>
              </a>
            );
          }

          return (
            <button
              key={tab.id}
              type="button"
              {...commonProps}
              onClick={() => {
                setActiveTab(tab.id);
                tab.action?.();
              }}
            >
              <span className="mobile-nav-icon" aria-hidden="true">
                {tab.icon}
              </span>
              <span className="mobile-nav-label">{tab.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Inline styles — kept alongside component for portability */}
      <style>{`
        /* ── Mobile bottom nav ────────────────────────────────────────────── */
        /* Only visible on small screens */
        .mobile-bottom-nav {
          display: none;
        }

        @media (max-width: 767px) {
          .mobile-bottom-nav {
            display: flex;
            position: fixed;
            bottom: 0;
            left: 0;
            right: 0;
            z-index: 90;
            background: var(--color-surface, #fff);
            border-top: 1px solid var(--color-border, #e5e7eb);
            /* iOS notch / home-indicator safe area */
            padding-bottom: env(safe-area-inset-bottom, 0px);
            box-shadow: 0 -2px 8px rgba(0,0,0,0.08);
          }

          .mobile-nav-spacer {
            display: block;
            height: calc(64px + env(safe-area-inset-bottom, 0px));
          }

          .mobile-nav-tab {
            flex: 1;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 0.5rem 0.25rem;
            min-height: 56px;
            border: none;
            background: transparent;
            cursor: pointer;
            color: #6b7280;
            text-decoration: none;
            transition: color 0.15s;
            /* 44 px minimum touch target (flex fills the 25% width) */
            min-width: 44px;
          }

          .mobile-nav-tab:hover,
          .mobile-nav-tab:focus-visible {
            color: var(--color-active, #1d6ae5);
            background: #eff6ff;
            outline: 2px solid var(--color-active, #1d6ae5);
            outline-offset: -2px;
          }

          .mobile-nav-tab--active {
            color: var(--color-active, #1d6ae5);
            font-weight: 700;
          }

          .mobile-nav-icon {
            font-size: 1.35rem;
            line-height: 1;
            display: block;
          }

          .mobile-nav-label {
            font-size: 0.7rem;
            margin-top: 0.2rem;
            font-weight: inherit;
          }
        }

        /* Hide spacer on desktop */
        @media (min-width: 768px) {
          .mobile-nav-spacer {
            display: none;
          }
        }

        /* ── 250 ms slide-up animation ────────────────────────────────────── */
        @media (max-width: 767px) {
          .mobile-bottom-nav {
            animation: mobileNavSlideUp 0.25s ease-out both;
          }
        }

        @keyframes mobileNavSlideUp {
          from { transform: translateY(100%); opacity: 0; }
          to   { transform: translateY(0);    opacity: 1; }
        }

        @media (prefers-reduced-motion: reduce) {
          .mobile-bottom-nav {
            animation: none !important;
          }
        }
      `}</style>
    </>
  );
}
