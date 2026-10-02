"use client";
import { useNotificationContext } from "@/contexts/NotificationContext";
import { NotificationEventType } from "@/hooks/useNotifications";
import { useBrowserPush } from "@/hooks/useBrowserPush";

// ── Event type metadata ────────────────────────────────────────────────────────

const EVENT_META: Record<
  NotificationEventType,
  { icon: string; label: string; description: string }
> = {
  cliff_reached: {
    icon: "🏔️",
    label: "Cliff Reached",
    description: "Notified when your vesting cliff is reached and tokens become claimable.",
  },
  expiring_soon: {
    icon: "⏳",
    label: "Expiring Soon",
    description: "Notified 7 days before a stream is set to expire.",
  },
  claim_available: {
    icon: "💸",
    label: "Claim Available",
    description: "Notified when new tokens are available to claim.",
  },
  stream_cancelled: {
    icon: "🛑",
    label: "Stream Cancelled",
    description: "Notified when one of your vesting streams is cancelled.",
  },
};

/**
 * /notifications — Notification preferences page (#382).
 * Lets users enable or disable each notification event type.
 */
export default function NotificationPreferencesPage() {
  const { preferences, setPreference } = useNotificationContext();
  const { permission, requestPermission } = useBrowserPush();

  const permissionStatusText =
    permission === "granted"
      ? "Enabled"
      : permission === "denied"
      ? "Blocked"
      : "Not enabled";

  const permissionColor =
    permission === "granted"
      ? "var(--color-completed)"
      : permission === "denied"
      ? "var(--color-cancelled)"
      : "#9ca3af";

  return (
    <main id="main-content" className="page">
      <header style={{ marginBottom: "1.5rem" }}>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 700 }}>Notification Preferences</h1>
        <p style={{ marginTop: "0.4rem", color: "#6b7280", fontSize: "0.9rem" }}>
          Choose which in-app events you want to be notified about.
          Preferences are saved to this browser.
        </p>
      </header>

      {/* Browser Push Notifications Section */}
      <section aria-label="Browser push notifications" style={{ marginBottom: "2rem" }}>
        <h2 style={{ fontSize: "1.1rem", fontWeight: 600, marginBottom: "0.75rem" }}>
          Browser Push Notifications
        </h2>
        <div
          style={{
            background: "var(--color-surface)",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius)",
            padding: "1.25rem",
            display: "flex",
            alignItems: "center",
            gap: "1rem",
          }}
        >
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: "0.95rem", marginBottom: "0.25rem" }}>
              Background Notifications
            </div>
            <div style={{ fontSize: "0.82rem", color: "#6b7280", marginBottom: "0.5rem" }}>
              Receive notifications even when the app is closed or in the background.
            </div>
            <div style={{ fontSize: "0.85rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span style={{ fontWeight: 600 }}>Status:</span>
              <span style={{ color: permissionColor, fontWeight: 600 }}>
                {permissionStatusText}
              </span>
            </div>
          </div>
          {permission !== "granted" && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void requestPermission()}
              disabled={permission === "denied"}
              style={{ fontSize: "0.875rem", flexShrink: 0 }}
              data-testid="enable-push-button"
            >
              {permission === "denied" ? "Blocked by browser" : "Enable"}
            </button>
          )}
          {permission === "granted" && (
            <span
              aria-label="Push notifications enabled"
              style={{ fontSize: "1.5rem", flexShrink: 0 }}
            >
              ✅
            </span>
          )}
        </div>
        {permission === "denied" && (
          <p
            style={{
              fontSize: "0.8rem",
              color: "#9ca3af",
              marginTop: "0.5rem",
              lineHeight: 1.5,
            }}
          >
            Push notifications are blocked by your browser. To enable them, you
            must update your browser's site settings and allow notifications for
            this site.
          </p>
        )}
      </section>

      {/* In-App Event Preferences Section */}
      <section aria-label="Notification preferences">
        <h2 style={{ fontSize: "1.1rem", fontWeight: 600, marginBottom: "0.75rem" }}>
          In-App Event Preferences
        </h2>
        <ul
          style={{
            listStyle: "none",
            display: "flex",
            flexDirection: "column",
            gap: "0",
            background: "var(--color-surface)",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius)",
            overflow: "hidden",
          }}
        >
          {(
            Object.entries(EVENT_META) as [
              NotificationEventType,
              (typeof EVENT_META)[NotificationEventType]
            ][]
          ).map(([type, meta], idx, arr) => (
            <li
              key={type}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "1rem",
                padding: "1rem 1.25rem",
                borderBottom:
                  idx < arr.length - 1
                    ? "1px solid var(--color-border)"
                    : "none",
              }}
            >
              {/* Icon */}
              <span
                aria-hidden="true"
                style={{ fontSize: "1.5rem", flexShrink: 0 }}
              >
                {meta.icon}
              </span>

              {/* Text */}
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: "0.95rem" }}>
                  {meta.label}
                </div>
                <div style={{ fontSize: "0.82rem", color: "#6b7280", marginTop: "0.15rem" }}>
                  {meta.description}
                </div>
              </div>

              {/* Toggle */}
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  cursor: "pointer",
                  flexShrink: 0,
                }}
                aria-label={`${preferences[type] ? "Disable" : "Enable"} ${meta.label} notifications`}
              >
                <input
                  type="checkbox"
                  checked={preferences[type]}
                  onChange={(e) => setPreference(type, e.target.checked)}
                  data-testid={`pref-toggle-${type}`}
                  style={{
                    width: 18,
                    height: 18,
                    cursor: "pointer",
                    accentColor: "var(--color-active)",
                  }}
                />
                <span
                  style={{
                    fontSize: "0.85rem",
                    color: preferences[type]
                      ? "var(--color-completed)"
                      : "#9ca3af",
                    fontWeight: 600,
                    minWidth: "3rem",
                  }}
                >
                  {preferences[type] ? "On" : "Off"}
                </span>
              </label>
            </li>
          ))}
        </ul>
      </section>

      <div style={{ marginTop: "1.5rem" }}>
        <a href="/" className="btn btn-outline" style={{ fontSize: "0.875rem" }}>
          ← Back to Dashboard
        </a>
      </div>
    </main>
  );
}
