"use client";

interface PrintButtonProps {
  /** Optional extra CSS class names */
  className?: string;
  /** Optional label override; defaults to "Print / Export PDF" */
  label?: string;
}

/**
 * PrintButton — triggers the browser's native print dialog.
 *
 * Before calling window.print() it stamps the current ISO timestamp on
 * document.body via data-print-date so that print.css can reference it
 * in the ::after footer content.
 *
 * The button carries both `print-btn` (for styling) and `no-print`
 * (so it is hidden inside the printed output).
 */
export function PrintButton({ className = "", label = "Print / Export PDF" }: PrintButtonProps) {
  function handlePrint() {
    document.body.setAttribute("data-print-date", new Date().toISOString());
    window.print();
  }

  return (
    <button
      type="button"
      onClick={handlePrint}
      className={`print-btn no-print${className ? ` ${className}` : ""}`}
      aria-label={label}
    >
      🖨️ {label}
    </button>
  );
}

export default PrintButton;
