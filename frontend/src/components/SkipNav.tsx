/**
 * SkipNav — hidden skip navigation link (#389)
 *
 * Appears on :focus-visible and jumps to #main-content.
 * Must be rendered as the first focusable element in the DOM.
 * Styling lives in globals.css (.skip-nav / .skip-nav:focus-visible).
 */
export function SkipNav() {
  return (
    <a href="#main-content" className="skip-nav">
      Skip to main content
    </a>
  );
}
