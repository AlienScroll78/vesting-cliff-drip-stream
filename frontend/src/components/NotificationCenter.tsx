"use client";
import { useEffect, useRef, useState } from "react";
import { useNotificationContext } from "@/contexts/NotificationContext";
import { AppNotification, NotificationEventType } from "@/hooks/useNotifications";
import { trapFocus } from "@/utils/focusTrap";

// ── Event type metadata ────────────────────────────────────────────────────────

const EVENT_META: Record<
  NotificationEventType,
  { icon: string; label: string; color: string }
> = {
  cliff_reached:    { icon: "🏔️", label: "Cliff Reached",    color: "var(--color-active)" },
  expiring_soon:    { icon: "⏳", label: "Expiring Soon",    color: "var(--color-pre-cliff)" },
  claim_available:  { icon: "💸", label: "Claim Available",  color: "var(--color-completed)" },
  stream_cancelled: { icon: "🛑", label: "Stream Cancelled", color: "var(--color-cancelled)" },
};

// ── Relative time helper ───────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// ── Notification item ──────────────────────────────────────────────────────────

function NotificationItem({
  notification,
  onRead,
}: {
  notification: AppNotification;
  onRead: (id: string) => void;
}) {
  const meta = EVENT_META[notification.type];
  return (
    <div
      role="listitem"
      data-testid={`notification-${notification.id}`}
      onClick={() => onRead(notification.id)}
      style={{
        display: "flex",
        gap: "0.75rem",
        padding: "0.875rem 1rem",
        borderBottom: "1px solid var(--color-border)",
        cursor: notification.read ? "default" : "pointer",
        background: notification.read ? "transparent" : "var(--color-bg)",
        transition: "background 0.15s",
      }}
    >
      {/* Unread dot */}
      <div style={{ flexShrink: 0, paddingTop: "0.2rem" }}>
        {!notification.read && (
          <span
            aria-label="Unread"
            style={{
              display: "block",
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "var(--color-active)",
            }}
          />
        )}
        {notification.read && <span style={{ display: "block", width: 8 }} />}
      </div>

      {/* Icon + content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginBottom: "0.2rem" }}>
          <span aria-hidden="true">{meta.icon}</span>
          <span style={{ fontSize: "0.75rem", fontWeight: 600, color: meta.color }}>
            {meta.label}
          </span>
          <span style={{ marginLeft: "auto", fontSize: "0.72rem", color: "#9ca3af", whiteSpace: "nowrap" }}>
            {relativeTime(notification.timestamp)}
          </span>
        </div>
        <p style={{ fontWeight: notification.read ? 400 : 600, fontSize: "0.875rem", margin: 0, lineHeight: 1.4 }}>
          {notification.title}
        </p>
        <p style={{ fontSize: "0.8rem", color: "#6b7280", margin: "0.15rem 0 0", lineHeight: 1.4 }}>
          {notification.message}
        </p>
      </div>
    </div>
  );
}

// ── Preferences panel ──────────────────────────────────────────────────────────

function PreferencesPanel() {
  const { preferences, setPreference } = useNotificationContext();
  return (
    <div style={{ padding: "1rem" }}>
      <h3 style={{ fontSize: "0.875rem", fontWeight: 700, marginBottom: "0.75rem" }}>
        Notification Preferences
      </h3>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        {(Object.entries(EVENT_META) as [NotificationEventType, typeof EVENT_META[NotificationEventType]][]).map(
          ([type, meta]) => (
            <label
              key={type}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.75rem",
                cursor: "pointer",
                fontSize: "0.875rem",
              }}
            >
              <input
                type="checkbox"
                checked={preferences[type]}
                onChange={(e) => setPreference(type, e.target.checked)}
                style={{ width: 16, height: 16, cursor: "pointer" }}
                aria-label={`Enable ${meta.label} notifications`}
              />
              <span aria-hidden="true">{meta.icon}</span>
              <span>{meta.label}</span>
            </label>
          )
        )}
      </div>
    </div>
  );
}

// ── Main NotificationCenter ────────────────────────────────────────────────────

export function NotificationCenter() {
  const { notifications, unreadCount, markRead, markAllRead } = useNotificationContext();
  const [open, setOpen] = useState(false);
  const [showPrefs, setShowPrefs] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);
  const titleId = "notification-drawer-title";

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  // Focus trap while open
  useEffect(() => {
    if (!open || !drawerRef.current) return;
    const cleanup = trapFocus(drawerRef.current);
    // Move focus into drawer
    const firstFocusable = drawerRef.current.querySelector<HTMLElement>(
      'button,input,[tabindex]:not([tabindex="-1"])'
    );
    firstFocusable?.focus();
    return cleanup;
  }, [open]);

  function handleBackdropClick(e: React.MouseEvent) {
    if (e.target === e.currentTarget) setOpen(false);
  }

  return (
    <>
      {/* ── Bell button ── */}
      <button
        type="button"
        className="btn btn-ghost"
        onClick={() => { setOpen(true); setShowPrefs(false); }}
        aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ""}`}
        data-testid="notification-bell"
        style={{ position: "relative", padding: "0.35rem 0.5rem", minWidth: "auto" }}
      >
        <BellIcon />
        {unreadCount > 0 && (
          <span
            aria-hidden="true"
            data-testid="notification-badge"
            style={{
              position: "absolute",
              top: 2,
              right: 2,
              minWidth: 16,
              height: 16,
              borderRadius: "9999px",
              background: "var(--color-cancelled)",
              color: "#fff",
              fontSize: "0.65rem",
              fontWeight: 700,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "0 3px",
              lineHeight: 1,
            }}
          >
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {/* ── Backdrop + Drawer ── */}
      {open && (
        <div
          onClick={handleBackdropClick}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 200,
            background: "rgba(0,0,0,0.3)",
            display: "flex",
            justifyContent: "flex-end",
          }}
          aria-hidden="false"
        >
          <div
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            data-testid="notification-drawer"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(380px, 100vw)",
              height: "100dvh",
              background: "var(--color-surface)",
              borderLeft: "1px solid var(--color-border)",
              display: "flex",
              flexDirection: "column",
              boxShadow: "-4px 0 24px rgba(0,0,0,0.12)",
              animation: "slideInRight 0.22s ease-out",
            }}
          >
            {/* Header */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "1rem",
                borderBottom: "1px solid var(--color-border)",
                flexShrink: 0,
              }}
            >
              <h2 id={titleId} style={{ fontSize: "1rem", fontWeight: 700, margin: 0 }}>
                Notifications
                {unreadCount > 0 && (
                  <span
                    style={{
                      marginLeft: "0.5rem",
                      fontSize: "0.75rem",
                      background: "var(--color-active)",
                      color: "#fff",
                      borderRadius: "9999px",
                      padding: "0.1rem 0.4rem",
                    }}
                  >
                    {unreadCount}
                  </span>
                )}
              </h2>
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                {unreadCount > 0 && (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{ fontSize: "0.75rem", padding: "0.25rem 0.5rem", minWidth: "auto" }}
                    onClick={markAllRead}
                    data-testid="mark-all-read"
                  >
                    Mark all read
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ padding: "0.25rem 0.4rem", minWidth: "auto" }}
                  onClick={() => setShowPrefs((v) => !v)}
                  aria-pressed={showPrefs}
                  aria-label="Toggle notification preferences"
                  data-testid="notification-prefs-toggle"
                >
                  ⚙️
                </button>
                <a
                  href="/notifications"
                  className="btn btn-ghost"
                  style={{ padding: "0.25rem 0.4rem", minWidth: "auto", fontSize: "0.75rem" }}
                  aria-label="Open notification preferences page"
                  data-testid="notification-prefs-link"
                  onClick={() => setOpen(false)}
                >
                  Preferences
                </a>
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ padding: "0.25rem 0.4rem", minWidth: "auto", fontSize: "1.1rem" }}
                  onClick={() => setOpen(false)}
                  aria-label="Close notifications"
                  data-testid="notification-close"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Preferences panel */}
            {showPrefs && (
              <div style={{ borderBottom: "1px solid var(--color-border)", flexShrink: 0 }}>
                <PreferencesPanel />
              </div>
            )}

            {/* Notification list */}
            <div
              role="list"
              aria-label="Notifications list"
              style={{ flex: 1, overflowY: "auto" }}
            >
              {notifications.length === 0 ? (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    height: "100%",
                    gap: "0.75rem",
                    padding: "2rem",
                    textAlign: "center",
                    color: "#9ca3af",
                  }}
                >
                  <span style={{ fontSize: "2.5rem" }} aria-hidden="true">🔔</span>
                  <p style={{ fontWeight: 600, color: "var(--color-text)", margin: 0 }}>
                    No notifications yet
                  </p>
                  <p style={{ fontSize: "0.85rem", margin: 0 }}>
                    You'll be notified when your cliff is reached, tokens are claimable, or a stream
                    is about to expire.
                  </p>
                </div>
              ) : (
                notifications.map((n) => (
                  <NotificationItem key={n.id} notification={n} onRead={markRead} />
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Slide-in animation */}
      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
      `}</style>
    </>
  );
}

// ── Bell SVG icon ──────────────────────────────────────────────────────────────

function BellIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}
