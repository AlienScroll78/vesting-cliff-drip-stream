import { useDarkMode } from "@/hooks/useDarkMode";

export function DarkModeToggle() {
  const [dark, toggle] = useDarkMode();

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      aria-pressed={dark}
      className="btn btn-ghost dark-mode-toggle"
      title={dark ? "Light mode" : "Dark mode"}
    >
      {/*
       * The key prop forces React to remount the span on every toggle, which
       * re-triggers the CSS entry animation — giving a crisp fade+spin without
       * needing a separate animation state variable.
       */}
      <span
        key={dark ? "sun" : "moon"}
        className="dark-mode-icon"
        aria-hidden="true"
      >
        {dark ? "☀️" : "🌙"}
      </span>

      {/* Visible label next to the icon on wider viewports */}
      <span className="dark-mode-label" aria-hidden="true">
        {dark ? "Light" : "Dark"}
      </span>
    </button>
  );
}
