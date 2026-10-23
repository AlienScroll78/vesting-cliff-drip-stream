"use client";

import { useEffect, useRef, useState } from "react";
import { useNotificationContext } from "@/contexts/NotificationContext";
import { trapFocus } from "@/utils/focusTrap";
import { CreateStreamWizard } from "@/wizard/CreateStreamWizard";

type TabId = "streams" | "create" | "activity" | "settings";

function getActiveTab(pathname: string | null): TabId | null {
  if (pathname === "/" || pathname?.startsWith("/dashboard") || pathname?.startsWith("/streams")) {
    return "streams";
  }
  if (pathname?.startsWith("/history")) return "activity";
  if (pathname?.startsWith("/notifications")) return "settings";
  return null;
}

function NavIcon({ name }: { name: TabId | "quick-actions" }) {
  const paths: Record<typeof name, React.ReactNode> = {
    streams: <><path d="M4 7h16M4 12h16M4 17h10" /><circle cx="18" cy="17" r="3" /></>,
    create: <><path d="M12 5v14M5 12h14" /></>,
    activity: <><path d="M3 12h4l3-8 4 16 3-8h4" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.7a7.8 7.8 0 0 1-1.7 1l-.3 1.8h-2.8l-.3-1.8a7.8 7.8 0 0 1-1.7-1l-1.7.7-1.4-2.4L7.3 15a8 8 0 0 1 0-2l-1.4-1.1 1.4-2.4 1.7.7a7.8 7.8 0 0 1 1.7-1l.3-1.8h2.8l.3 1.8a7.8 7.8 0 0 1 1.7 1l1.7-.7 1.4 2.4-1.4 1.1a8 8 0 0 1-.1 2Z" /></>,
    "quick-actions": <><path d="M12 5v14M5 12h14" /></>,
  };

  return (
    <svg
      aria-hidden="true"
      className="mobile-nav-svg"
      fill="none"
      height="24"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
      width="24"
    >
      {paths[name]}
    </svg>
  );
}

function QuickActionsSheet({ onClose }: { onClose: () => void }) {
  const sheetRef = useRef<HTMLElement>(null);
  const startY = useRef<number | null>(null);
  const [translateY, setTranslateY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    if (!sheetRef.current) return;
    const restoreFocus = trapFocus(sheetRef.current);
    sheetRef.current.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      restoreFocus();
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  function handleTouchStart(event: React.TouchEvent<HTMLElement>) {
    const touch = event.touches[0];
    const sheet = sheetRef.current;
    if (!touch || !sheet || touch.clientY - sheet.getBoundingClientRect().top > 56) return;
    startY.current = touch.clientY;
    setIsDragging(true);
  }

  function handleTouchMove(event: React.TouchEvent<HTMLElement>) {
    if (startY.current === null || !isDragging) return;
    setTranslateY(Math.max(0, event.touches[0]!.clientY - startY.current));
  }

  function handleTouchEnd() {
    if (!isDragging) return;
    setIsDragging(false);
    if (translateY > 120) onClose();
    else setTranslateY(0);
    startY.current = null;
  }

  return (
    <div
      className="mobile-actions-backdrop"
      data-testid="mobile-quick-actions-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={sheetRef}
        aria-labelledby="mobile-actions-title"
        aria-modal="true"
        className="mobile-actions-sheet"
        id="mobile-quick-actions-sheet"
        onClick={(event) => event.stopPropagation()}
        onTouchEnd={handleTouchEnd}
        onTouchMove={handleTouchMove}
        onTouchStart={handleTouchStart}
        role="dialog"
        style={{
          transform: `translateY(${translateY}px)`,
          transition: isDragging ? "none" : undefined,
        }}
        tabIndex={-1}
      >
        <div className="mobile-actions-handle" aria-hidden="true" />
        <h2 id="mobile-actions-title">Quick actions</h2>
        <p>Choose an action to continue with your streams.</p>
        <a className="mobile-action-link" href="/dashboard" onClick={onClose}>
          <span className="mobile-action-icon" aria-hidden="true">↓</span>
          <span>
            <strong>Claim tokens</strong>
            <small>Review your claimable stream balance</small>
          </span>
          <span aria-hidden="true">›</span>
        </a>
        <a className="mobile-action-link" href="/sponsor" onClick={onClose}>
          <span className="mobile-action-icon mobile-action-icon--cancel" aria-hidden="true">×</span>
          <span>
            <strong>Cancel a stream</strong>
            <small>Manage and cancel a sponsored stream</small>
          </span>
          <span aria-hidden="true">›</span>
        </a>
        <button className="mobile-actions-dismiss" type="button" onClick={onClose}>
          Close
        </button>
      </section>

      <style>{`
        .mobile-actions-backdrop {
          position: fixed;
          inset: 0;
          z-index: 110;
          display: flex;
          align-items: flex-end;
          background: rgb(15 23 42 / 0.48);
          animation: mobileSheetFadeIn 180ms ease-out both;
        }

        .mobile-actions-sheet {
          width: 100%;
          max-height: min(80dvh, 34rem);
          overflow-y: auto;
          padding: 0.7rem 1.25rem calc(1rem + env(safe-area-inset-bottom, 0px));
          background: var(--color-surface, #fff);
          color: var(--color-text, #111827);
          border-radius: 1.25rem 1.25rem 0 0;
          box-shadow: 0 -8px 32px rgb(15 23 42 / 0.2);
          animation: mobileSheetSlideUp 240ms cubic-bezier(0.2, 0, 0, 1) both;
          touch-action: pan-y;
        }

        .mobile-actions-sheet h2 {
          margin: 0.9rem 0 0.3rem;
          font-size: 1.15rem;
        }

        .mobile-actions-sheet > p {
          margin: 0 0 1rem;
          color: #6b7280;
          font-size: 0.875rem;
        }

        .mobile-actions-handle {
          width: 2rem;
          height: 0.25rem;
          margin: 0 auto;
          border-radius: 999px;
          background: #9ca3af;
        }

        .mobile-action-link {
          display: flex;
          align-items: center;
          gap: 0.8rem;
          min-height: 4rem;
          padding: 0.7rem 0.25rem;
          border-top: 1px solid var(--color-border, #e5e7eb);
          color: inherit;
          text-decoration: none;
        }

        .mobile-action-link > span:nth-child(2) { flex: 1; }
        .mobile-action-link strong,
        .mobile-action-link small { display: block; }
        .mobile-action-link small { margin-top: 0.2rem; color: #6b7280; }

        .mobile-action-icon {
          display: grid;
          width: 2.5rem;
          height: 2.5rem;
          place-items: center;
          border-radius: 50%;
          background: color-mix(in srgb, var(--color-active, #1d6ae5) 12%, transparent);
          color: var(--color-active, #1d6ae5);
          font-size: 1.4rem;
          font-weight: 700;
        }

        .mobile-action-icon--cancel {
          background: color-mix(in srgb, var(--color-cancelled, #b91c1c) 10%, transparent);
          color: var(--color-cancelled, #b91c1c);
        }

        .mobile-actions-dismiss {
          display: block;
          width: 100%;
          min-height: 44px;
          margin-top: 0.5rem;
          border: 0;
          background: transparent;
          color: var(--color-active, #1d6ae5);
          font: inherit;
          font-weight: 600;
        }

        @keyframes mobileSheetFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        @keyframes mobileSheetSlideUp {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }

        @media (prefers-reduced-motion: reduce) {
          .mobile-actions-backdrop,
          .mobile-actions-sheet { animation: none; }
        }
      `}</style>
    </div>
  );
}

interface Props {
  onCreateStream?: () => void;
  onSettings?: () => void;
}

export function MobileBottomNav({ onCreateStream, onSettings }: Props) {
  const [pathname, setPathname] = useState<string | null>(null);
  const { notifications } = useNotificationContext();
  const [createOpen, setCreateOpen] = useState(false);
  const [quickActionsOpen, setQuickActionsOpen] = useState(false);
  const quickActionsButtonRef = useRef<HTMLButtonElement>(null);
  const activeTab = createOpen ? "create" : getActiveTab(pathname);
  const newClaimableCount = notifications.filter(
    (notification) => notification.type === "claim_available" && !notification.read
  ).length;

  useEffect(() => {
    const syncPathname = () => setPathname(window.location.pathname);
    syncPathname();
    window.addEventListener("popstate", syncPathname);
    return () => window.removeEventListener("popstate", syncPathname);
  }, []);

  function closeQuickActions() {
    setQuickActionsOpen(false);
    quickActionsButtonRef.current?.focus();
  }

  const tabs: Array<{
    id: TabId;
    label: string;
    href?: string;
    ariaLabel?: string;
    action?: () => void;
  }> = [
    { id: "streams", label: "Streams", href: "/dashboard" },
    {
      id: "create",
      label: "Create",
      ariaLabel: "Create new stream",
      action: () => {
        if (onCreateStream) onCreateStream();
        else setCreateOpen(true);
      },
    },
    { id: "activity", label: "Activity", href: "/history" },
    {
      id: "settings",
      label: "Settings",
      href: onSettings ? undefined : "/notifications",
      ariaLabel: "Open settings",
      action: onSettings,
    },
  ];

  return (
    <>
      <div aria-hidden="true" className="mobile-nav-spacer" />

      <button
        ref={quickActionsButtonRef}
        aria-controls="mobile-quick-actions-sheet"
        aria-expanded={quickActionsOpen}
        aria-haspopup="dialog"
        aria-label="Quick actions"
        className="mobile-quick-actions-button"
        data-testid="mobile-quick-actions-button"
        onClick={() => setQuickActionsOpen(true)}
        type="button"
      >
        <NavIcon name="quick-actions" />
        <span>Quick actions</span>
      </button>

      <nav
        aria-label="Mobile navigation"
        className="mobile-bottom-nav"
        data-testid="mobile-bottom-nav"
      >
        {tabs.map((tab) => {
          const isCurrent = activeTab === tab.id;
          const badgeLabel = `${newClaimableCount} new claimable token${newClaimableCount === 1 ? "" : "s"}`;
          const commonProps = {
            "aria-current": isCurrent ? "page" as const : undefined,
            "aria-label": tab.ariaLabel ?? tab.label,
            "data-testid": `mobile-nav-${tab.id}`,
            className: `mobile-nav-tab${isCurrent ? " mobile-nav-tab--active" : ""}`,
            onClick: tab.href ? () => setPathname(tab.href ?? null) : tab.action,
          };

          const content = (
            <>
              <span className="mobile-nav-icon">
                <NavIcon name={tab.id} />
                {tab.id === "streams" && newClaimableCount > 0 && (
                  <span
                    aria-label={badgeLabel}
                    aria-live="polite"
                    className="mobile-nav-badge"
                    data-testid="mobile-nav-claimable-badge"
                    role="status"
                  >
                    {newClaimableCount > 9 ? "9+" : newClaimableCount}
                  </span>
                )}
              </span>
              <span className="mobile-nav-label">{tab.label}</span>
            </>
          );

          return tab.href ? (
            <a key={tab.id} href={tab.href} {...commonProps}>
              {content}
            </a>
          ) : (
            <button key={tab.id} type="button" {...commonProps}>
              {content}
            </button>
          );
        })}
      </nav>

      {quickActionsOpen && <QuickActionsSheet onClose={closeQuickActions} />}
      {createOpen && <CreateStreamWizard onClose={() => setCreateOpen(false)} />}

      <style>{`
        .mobile-bottom-nav,
        .mobile-nav-spacer,
        .mobile-quick-actions-button {
          display: none;
        }

        @media (max-width: 767px) {
          .mobile-bottom-nav {
            display: flex;
            position: fixed;
            inset: auto 0 0;
            z-index: 90;
            background: var(--color-surface, #fff);
            border-top: 1px solid var(--color-border, #e5e7eb);
            padding-bottom: env(safe-area-inset-bottom, 0px);
            box-shadow: 0 -2px 8px rgb(0 0 0 / 0.08);
            animation: mobileNavSlideUp 220ms cubic-bezier(0.2, 0, 0, 1) both;
          }

          .mobile-nav-spacer {
            display: block;
            height: calc(68px + env(safe-area-inset-bottom, 0px));
          }

          .mobile-quick-actions-button {
            display: inline-flex;
            align-items: center;
            gap: 0.45rem;
            position: fixed;
            right: 1rem;
            bottom: calc(78px + env(safe-area-inset-bottom, 0px));
            z-index: 89;
            min-height: 44px;
            padding: 0.55rem 0.8rem;
            border: 0;
            border-radius: 999px;
            background: var(--color-active, #1d6ae5);
            color: #fff;
            box-shadow: 0 4px 14px rgb(15 23 42 / 0.2);
            font: inherit;
            font-size: 0.8rem;
            font-weight: 700;
            cursor: pointer;
            transition: transform 160ms ease-out, box-shadow 160ms ease-out;
          }

          .mobile-quick-actions-button:active { transform: scale(0.96); }

          .mobile-nav-tab {
            position: relative;
            flex: 1;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 0.2rem;
            min-width: 44px;
            min-height: 60px;
            padding: 0.45rem 0.2rem;
            border: 0;
            background: transparent;
            color: #6b7280;
            text-decoration: none;
            font: inherit;
            cursor: pointer;
            transition: color 160ms ease-out, background-color 160ms ease-out;
          }

          .mobile-nav-tab::before {
            content: "";
            position: absolute;
            top: 0;
            left: 50%;
            width: 2rem;
            height: 2px;
            border-radius: 0 0 2px 2px;
            background: currentColor;
            opacity: 0;
            transform: translateX(-50%) scaleX(0.5);
            transition: opacity 160ms ease-out, transform 160ms ease-out;
          }

          .mobile-nav-tab:hover,
          .mobile-nav-tab:focus-visible {
            color: var(--color-active, #1d6ae5);
            outline: 2px solid var(--color-active, #1d6ae5);
            outline-offset: -2px;
          }

          .mobile-nav-tab--active {
            color: var(--color-active, #1d6ae5);
            font-weight: 700;
          }

          .mobile-nav-tab--active::before {
            opacity: 1;
            transform: translateX(-50%) scaleX(1);
          }

          .mobile-nav-icon {
            position: relative;
            display: block;
            line-height: 1;
            transform: scale(1);
            transition: transform 160ms cubic-bezier(0.2, 0, 0, 1);
          }

          .mobile-nav-tab--active .mobile-nav-icon { transform: scale(1.06); }
          .mobile-nav-svg { display: block; width: 23px; height: 23px; }

          .mobile-nav-label {
            font-size: 0.69rem;
            line-height: 1.15;
            font-weight: inherit;
          }

          .mobile-nav-badge {
            position: absolute;
            top: -0.35rem;
            right: -0.6rem;
            display: grid;
            min-width: 1.05rem;
            height: 1.05rem;
            padding: 0 0.2rem;
            place-items: center;
            border: 2px solid var(--color-surface, #fff);
            border-radius: 999px;
            background: #dc2626;
            color: #fff;
            font-size: 0.58rem;
            font-weight: 700;
            line-height: 1;
          }
        }

        @keyframes mobileNavSlideUp {
          from { transform: translateY(100%); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }

        @media (prefers-reduced-motion: reduce) {
          .mobile-bottom-nav { animation: none; }
          .mobile-nav-tab,
          .mobile-nav-tab::before,
          .mobile-nav-icon,
          .mobile-quick-actions-button { transition: none; }
        }
      `}</style>
    </>
  );
}
