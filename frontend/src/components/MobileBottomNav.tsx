"use client";
/**
 * MobileBottomNav (#770)
 *
 * Redesigned mobile-optimised bottom navigation bar that appears on
 * viewports < 768 px using CSS media queries.
 *
 * Primary tabs: Dashboard (/), Create (/sponsor), Explore (/explore),
 *               Notifications (/notifications), Profile (/profile)
 *
 * Secondary links (hamburger menu): Settings, Docs, Logout
 *
 * Features:
 * - Bottom tab bar fixed to viewport bottom with iOS safe-area inset
 * - Active tab indicator with smooth CSS transition
 * - Hamburger menu (slide-up drawer) for secondary links
 * - Swipe gesture support: left/right swipe switches adjacent tabs
 * - Full keyboard nav (Tab/Shift+Tab, Enter/Space, Escape to close menu)
 * - Respects prefers-reduced-motion
 * - WCAG 2.1 AA accessible (aria-current, aria-label, focus management)
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { usePathname } from "next/navigation";

// ── Types ─────────────────────────────────────────────────────────────────────

interface NavTab {
  id: string;
  label: string;
  href: string;
  icon: React.ReactNode;
  ariaLabel: string;
}

interface SecondaryLink {
  id: string;
  label: string;
  href?: string;
  action?: () => void;
  icon: React.ReactNode;
}

interface Props {
  /** Called when the hamburger Logout item is tapped. */
  onLogout?: () => void;
}

// ── SVG Icons ─────────────────────────────────────────────────────────────────

function IconDashboard() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}

function IconCreate() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="16" />
      <line x1="8" y1="12" x2="16" y2="12" />
    </svg>
  );
}

function IconExplore() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function IconNotifications() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

function IconProfile() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function IconHamburger() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}

function IconClose() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function IconSettings() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function IconDocs() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </svg>
  );
}

function IconLogout() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

// ── Primary tabs ──────────────────────────────────────────────────────────────

const PRIMARY_TABS: NavTab[] = [
  { id: "dashboard",     label: "Dashboard",     href: "/",              icon: <IconDashboard />,     ariaLabel: "Dashboard" },
  { id: "create",        label: "Create",        href: "/sponsor",       icon: <IconCreate />,        ariaLabel: "Create stream" },
  { id: "explore",       label: "Explore",       href: "/explore",       icon: <IconExplore />,       ariaLabel: "Explore streams" },
  { id: "notifications", label: "Notifications", href: "/notifications", icon: <IconNotifications />, ariaLabel: "Notifications" },
  { id: "profile",       label: "Profile",       href: "/streams",       icon: <IconProfile />,       ariaLabel: "Profile" },
];

// ── Component ─────────────────────────────────────────────────────────────────

export function MobileBottomNav({ onLogout }: Props) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const hamburgerBtnRef = useRef<HTMLButtonElement>(null);

  // Touch swipe state
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);

  // ── Active tab detection ───────────────────────────────────────────────────

  function resolveActiveTab(path: string | null): string {
    if (!path || path === "/") return "dashboard";
    if (path.startsWith("/sponsor"))       return "create";
    if (path.startsWith("/explore"))       return "explore";
    if (path.startsWith("/notifications")) return "notifications";
    if (path.startsWith("/streams"))       return "profile";
    if (path.startsWith("/history"))       return "dashboard";
    if (path.startsWith("/view"))          return "explore";
    return "dashboard";
  }

  const activeTab = resolveActiveTab(pathname);

  // ── Hamburger menu close on outside click / Escape ────────────────────────

  const closeMenu = useCallback(() => {
    setMenuOpen(false);
    // Return focus to the hamburger button when menu closes
    requestAnimationFrame(() => hamburgerBtnRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!menuOpen) return;

    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeMenu();
    }
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        closeMenu();
      }
    }

    document.addEventListener("keydown", handleKey);
    document.addEventListener("mousedown", handleClick);
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.removeEventListener("mousedown", handleClick);
    };
  }, [menuOpen, closeMenu]);

  // Focus first item when menu opens
  useEffect(() => {
    if (menuOpen) {
      requestAnimationFrame(() => {
        const firstItem = menuRef.current?.querySelector<HTMLElement>(
          "a[href], button:not([disabled])"
        );
        firstItem?.focus();
      });
    }
  }, [menuOpen]);

  // ── Swipe gesture: navigate between adjacent tabs ─────────────────────────

  function handleTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  }

  function handleTouchEnd(e: React.TouchEvent) {
    if (touchStartX.current === null || touchStartY.current === null) return;

    const dx = e.changedTouches[0].clientX - touchStartX.current;
    const dy = e.changedTouches[0].clientY - touchStartY.current;

    // Only treat as a horizontal swipe if the horizontal delta is dominant
    if (Math.abs(dx) < 50 || Math.abs(dy) > Math.abs(dx) * 0.8) {
      touchStartX.current = null;
      touchStartY.current = null;
      return;
    }

    const currentIdx = PRIMARY_TABS.findIndex((t) => t.id === activeTab);
    const nextIdx = dx < 0
      ? Math.min(currentIdx + 1, PRIMARY_TABS.length - 1) // swipe left → next tab
      : Math.max(currentIdx - 1, 0);                       // swipe right → prev tab

    if (nextIdx !== currentIdx) {
      // Use Next.js router push if available; fall back to location assign
      const href = PRIMARY_TABS[nextIdx].href;
      window.location.assign(href);
    }

    touchStartX.current = null;
    touchStartY.current = null;
  }

  // ── Secondary links ────────────────────────────────────────────────────────

  const secondaryLinks: SecondaryLink[] = [
    {
      id: "settings",
      label: "Settings",
      href: "/admin",
      icon: <IconSettings />,
    },
    {
      id: "docs",
      label: "Documentation",
      href: "https://github.com/DevKiji/vesting-cliff-drip-stream",
      icon: <IconDocs />,
    },
    {
      id: "logout",
      label: "Logout",
      action: () => { closeMenu(); onLogout?.(); },
      icon: <IconLogout />,
    },
  ];

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Spacer so page content is not hidden behind the fixed bar */}
      <div aria-hidden="true" className="mobile-nav-spacer" />

      {/* ── Hamburger secondary menu (slide-up drawer) ── */}
      {menuOpen && (
        <div
          className="mobile-menu-backdrop"
          aria-hidden="true"
          onClick={closeMenu}
        />
      )}

      <div
        ref={menuRef}
        role="dialog"
        aria-modal="true"
        aria-label="Secondary navigation"
        className={`mobile-secondary-menu${menuOpen ? " mobile-secondary-menu--open" : ""}`}
        hidden={!menuOpen}
      >
        <div className="mobile-secondary-menu-header">
          <span className="mobile-secondary-menu-title">More</span>
          <button
            type="button"
            className="mobile-menu-close-btn"
            aria-label="Close menu"
            onClick={closeMenu}
          >
            <IconClose />
          </button>
        </div>

        <ul role="list" className="mobile-secondary-links">
          {secondaryLinks.map((link) => (
            <li key={link.id}>
              {link.href ? (
                <a
                  href={link.href}
                  className="mobile-secondary-link"
                  onClick={closeMenu}
                  target={link.href.startsWith("http") ? "_blank" : undefined}
                  rel={link.href.startsWith("http") ? "noopener noreferrer" : undefined}
                >
                  <span className="mobile-secondary-link-icon">{link.icon}</span>
                  {link.label}
                </a>
              ) : (
                <button
                  type="button"
                  className="mobile-secondary-link"
                  onClick={link.action}
                >
                  <span className="mobile-secondary-link-icon">{link.icon}</span>
                  {link.label}
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>

      {/* ── Bottom tab bar ── */}
      <nav
        aria-label="Mobile navigation"
        className="mobile-bottom-nav"
        data-testid="mobile-bottom-nav"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {/* Primary tabs */}
        {PRIMARY_TABS.map((tab) => {
          const isCurrent = activeTab === tab.id;
          return (
            <a
              key={tab.id}
              href={tab.href}
              aria-current={isCurrent ? "page" : undefined}
              aria-label={tab.ariaLabel}
              data-testid={`mobile-nav-${tab.id}`}
              className={`mobile-nav-tab${isCurrent ? " mobile-nav-tab--active" : ""}`}
            >
              {/* Active indicator pip */}
              <span className="mobile-nav-indicator" aria-hidden="true" />
              <span className="mobile-nav-icon">{tab.icon}</span>
              <span className="mobile-nav-label">{tab.label}</span>
            </a>
          );
        })}

        {/* Hamburger button (secondary nav) */}
        <button
          ref={hamburgerBtnRef}
          type="button"
          aria-label={menuOpen ? "Close menu" : "More options"}
          aria-expanded={menuOpen}
          aria-controls="mobile-secondary-nav"
          data-testid="mobile-nav-hamburger"
          className={`mobile-nav-tab${menuOpen ? " mobile-nav-tab--active" : ""}`}
          onClick={() => setMenuOpen((o) => !o)}
        >
          <span className="mobile-nav-indicator" aria-hidden="true" />
          <span className="mobile-nav-icon">
            {menuOpen ? <IconClose /> : <IconHamburger />}
          </span>
          <span className="mobile-nav-label">More</span>
        </button>
      </nav>

      <style>{`
        /* ═══════════════════════════════════════════════════════════
           Mobile bottom navigation – hidden on desktop by default
           ═══════════════════════════════════════════════════════════ */

        .mobile-bottom-nav {
          display: none;
        }

        @media (max-width: 767px) {

          /* ── Tab bar ── */
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
            box-shadow: 0 -2px 12px rgba(0, 0, 0, 0.08);
            animation: mobileNavSlideUp 0.25s ease-out both;
          }

          .mobile-nav-spacer {
            display: block;
            height: calc(64px + env(safe-area-inset-bottom, 0px));
          }

          /* ── Individual tab ── */
          .mobile-nav-tab {
            flex: 1;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 0.4rem 0.2rem 0.5rem;
            min-height: 56px;
            border: none;
            background: transparent;
            cursor: pointer;
            color: #6b7280;
            text-decoration: none;
            transition: color 0.18s ease;
            /* Touch target ≥ 44 px ensured by flex fill */
            min-width: 44px;
            position: relative;
          }

          .mobile-nav-tab:hover,
          .mobile-nav-tab:focus-visible {
            color: var(--color-active, #1d6ae5);
            outline: 2px solid var(--color-active, #1d6ae5);
            outline-offset: -2px;
            background: color-mix(in srgb, var(--color-active, #1d6ae5) 8%, transparent);
          }

          /* ── Active state ── */
          .mobile-nav-tab--active {
            color: var(--color-active, #1d6ae5);
          }

          /* ── Active indicator pip (slides in from below) ── */
          .mobile-nav-indicator {
            position: absolute;
            top: 0;
            left: 50%;
            transform: translateX(-50%) scaleX(0);
            width: 28px;
            height: 3px;
            border-radius: 0 0 3px 3px;
            background: var(--color-active, #1d6ae5);
            transition: transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1);
          }

          .mobile-nav-tab--active .mobile-nav-indicator {
            transform: translateX(-50%) scaleX(1);
          }

          /* ── Icon & label ── */
          .mobile-nav-icon {
            display: flex;
            align-items: center;
            justify-content: center;
            line-height: 1;
            transition: transform 0.18s ease;
          }

          .mobile-nav-tab--active .mobile-nav-icon {
            transform: translateY(-1px);
          }

          .mobile-nav-label {
            font-size: 0.65rem;
            margin-top: 0.15rem;
            font-weight: 500;
            letter-spacing: 0.01em;
            transition: font-weight 0.18s ease;
          }

          .mobile-nav-tab--active .mobile-nav-label {
            font-weight: 700;
          }

          /* ── Slide-up entrance animation ── */
          @keyframes mobileNavSlideUp {
            from { transform: translateY(100%); opacity: 0; }
            to   { transform: translateY(0);    opacity: 1; }
          }
        }

        /* Hide spacer on desktop */
        @media (min-width: 768px) {
          .mobile-nav-spacer {
            display: none;
          }
          .mobile-secondary-menu,
          .mobile-menu-backdrop {
            display: none !important;
          }
        }

        /* ═══════════════════════════════════════════════════════════
           Hamburger secondary menu (slide-up sheet)
           ═══════════════════════════════════════════════════════════ */

        @media (max-width: 767px) {

          .mobile-menu-backdrop {
            position: fixed;
            inset: 0;
            background: rgba(0, 0, 0, 0.4);
            z-index: 88;
            animation: fadeIn 0.2s ease both;
          }

          @keyframes fadeIn {
            from { opacity: 0; }
            to   { opacity: 1; }
          }

          .mobile-secondary-menu {
            position: fixed;
            bottom: calc(64px + env(safe-area-inset-bottom, 0px));
            left: 0;
            right: 0;
            z-index: 89;
            background: var(--color-surface, #fff);
            border: 1px solid var(--color-border, #e5e7eb);
            border-bottom: none;
            border-radius: 1rem 1rem 0 0;
            padding: 1rem;
            box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.12);
            transform: translateY(100%);
            opacity: 0;
            transition: transform 0.25s cubic-bezier(0.32, 0.72, 0, 1), opacity 0.2s ease;
          }

          .mobile-secondary-menu--open {
            transform: translateY(0);
            opacity: 1;
          }

          .mobile-secondary-menu[hidden] {
            /* Prevent CSS transitions on initial hidden state */
            display: none !important;
          }

          /* Remove hidden attr effect when open — let CSS handle visibility */
          .mobile-secondary-menu--open {
            display: block !important;
          }

          .mobile-secondary-menu-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 0.75rem;
          }

          .mobile-secondary-menu-title {
            font-size: 1rem;
            font-weight: 700;
            color: var(--color-text, #111827);
          }

          .mobile-menu-close-btn {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 36px;
            height: 36px;
            border: none;
            background: transparent;
            cursor: pointer;
            color: #6b7280;
            border-radius: 0.5rem;
          }

          .mobile-menu-close-btn:hover,
          .mobile-menu-close-btn:focus-visible {
            color: var(--color-active, #1d6ae5);
            background: color-mix(in srgb, var(--color-active, #1d6ae5) 8%, transparent);
            outline: 2px solid var(--color-active, #1d6ae5);
          }

          .mobile-secondary-links {
            list-style: none;
            display: flex;
            flex-direction: column;
            gap: 0.25rem;
          }

          .mobile-secondary-link {
            display: flex;
            align-items: center;
            gap: 0.75rem;
            width: 100%;
            padding: 0.75rem 0.5rem;
            border: none;
            background: transparent;
            cursor: pointer;
            color: var(--color-text, #111827);
            font-size: 0.95rem;
            font-weight: 500;
            text-decoration: none;
            border-radius: 0.5rem;
            transition: background 0.15s ease, color 0.15s ease;
            text-align: left;
          }

          .mobile-secondary-link:hover,
          .mobile-secondary-link:focus-visible {
            background: color-mix(in srgb, var(--color-active, #1d6ae5) 8%, transparent);
            color: var(--color-active, #1d6ae5);
            outline: 2px solid var(--color-active, #1d6ae5);
          }

          .mobile-secondary-link-icon {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 24px;
            flex-shrink: 0;
            color: #6b7280;
          }

          .mobile-secondary-link:hover .mobile-secondary-link-icon,
          .mobile-secondary-link:focus-visible .mobile-secondary-link-icon {
            color: var(--color-active, #1d6ae5);
          }
        }

        /* ═══════════════════════════════════════════════════════════
           Reduced motion overrides
           ═══════════════════════════════════════════════════════════ */

        @media (prefers-reduced-motion: reduce) {
          .mobile-bottom-nav,
          .mobile-nav-tab,
          .mobile-nav-indicator,
          .mobile-nav-icon,
          .mobile-nav-label,
          .mobile-secondary-menu,
          .mobile-menu-backdrop {
            animation: none !important;
            transition-duration: 0.001ms !important;
          }
        }
      `}</style>
    </>
  );
}
