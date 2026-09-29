"use client";
import { useNotificationContext } from "@/contexts/NotificationContext";
import { NotificationEventType } from "@/hooks/useNotifications";

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

  return (
    <main id="main-content" className="page">
      <header style={{ marginBottom: "1.5rem" }}>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 700 }}>Notification Preferences</h1>
        <p style={{ marginTop: "0.4rem", color: "#6b7280", fontSize: "0.9rem" }}>
          Choose which in-app events you want to be notified about.
          Preferences are saved to this browser.
        </p>
      </header>

      <section aria-label="Notification preferences">
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
