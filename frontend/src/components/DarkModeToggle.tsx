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
      {dark ? "☀️" : "🌙"}
    </button>
  );
}
