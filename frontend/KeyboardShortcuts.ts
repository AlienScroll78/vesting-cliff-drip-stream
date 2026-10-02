/**
 * KeyboardShortcuts — keyboard-driven dashboard shortcuts with discoverable overlay.
 *
 * Shortcuts:
 *   ?           → open this modal (legacy)
 *   Shift+?     → toggle shortcuts help overlay
 *   n           → new stream
 *   C           → open create stream form
 *   R           → refresh dashboard data
 *   c           → claim vested tokens
 *   g s         → go to schedule
 *   g h         → go to history
 *   Escape      → close any open modal
 *   Arrow Up    → navigate stream cards (previous)
 *   Arrow Down  → navigate stream cards (next)
 *   Enter       → open selected stream detail
 *
 * Rules:
 *   - Disabled when focus is inside any <input>, <textarea>, or [contenteditable]
 *   - Traps focus inside the modal while open
 *   - Closes on Escape or clicking the backdrop
 *
 * @closes #270
 */

export interface ShortcutDef {
  keys: string[];  // display strings, e.g. ["g", "s"]
  label: string;
}

const SHORTCUTS: ShortcutDef[] = [
  { keys: ["Shift", "?"],  label: "Toggle shortcuts overlay" },
  { keys: ["C"],           label: "Open create stream form" },
  { keys: ["R"],           label: "Refresh dashboard data" },
  { keys: ["n"],           label: "New stream" },
  { keys: ["c"],           label: "Claim vested tokens" },
  { keys: ["g", "s"],      label: "Go to schedule" },
  { keys: ["g", "h"],      label: "Go to history" },
  { keys: ["↑"],           label: "Navigate to previous stream card" },
  { keys: ["↓"],           label: "Navigate to next stream card" },
  { keys: ["Enter"],       label: "Open selected stream detail" },
  { keys: ["Escape"],      label: "Close any open modal" },
];

// ── Modal DOM ─────────────────────────────────────────────────────────────────

function buildModal(): HTMLElement {
  const backdrop = document.createElement("div");
  backdrop.className = "ks-backdrop";
  backdrop.setAttribute("aria-hidden", "true");

  const dialog = document.createElement("div");
  dialog.className = "ks-dialog";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", "ks-title");
  dialog.tabIndex = -1;

  const header = document.createElement("div");
  header.className = "ks-header";

  const title = document.createElement("h2");
  title.id = "ks-title";
  title.textContent = "Keyboard Shortcuts";

  const closeBtn = document.createElement("button");
  closeBtn.className = "ks-close";
  closeBtn.setAttribute("aria-label", "Close keyboard shortcuts");
  closeBtn.textContent = "✕";

  header.append(title, closeBtn);

  const table = document.createElement("table");
  table.className = "ks-table";
  table.innerHTML = "<thead><tr><th>Keys</th><th>Action</th></tr></thead>";
  const tbody = document.createElement("tbody");

  SHORTCUTS.forEach(({ keys, label }) => {
    const tr = document.createElement("tr");
    const keysCell = document.createElement("td");
    keysCell.className = "ks-keys";
    keys.forEach((k, i) => {
      const kbd = document.createElement("kbd");
      kbd.textContent = k;
      keysCell.appendChild(kbd);
      if (i < keys.length - 1) keysCell.append(" + ");
    });
    const labelCell = document.createElement("td");
    labelCell.textContent = label;
    tr.append(keysCell, labelCell);
    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  dialog.append(header, table);
  backdrop.appendChild(dialog);
  return backdrop;
}

// ── Controller ────────────────────────────────────────────────────────────────

function isInputFocused(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || (el as HTMLElement).isContentEditable;
}

export function initKeyboardShortcuts(options: {
  onNewStream?: () => void;
  onCreateStream?: () => void;
  onRefresh?: () => void;
  onClaim?: () => void;
  onGoSchedule?: () => void;
  onGoHistory?: () => void;
  onNavigatePrev?: () => void;
  onNavigateNext?: () => void;
  onOpenDetail?: () => void;
  onCloseModal?: () => void;
} = {}): () => void {
  const modal = buildModal();
  let open = false;
  let pendingG = false;
  let pendingGTimer = 0;

  function show() {
    if (open) return;
    open = true;
    modal.removeAttribute("aria-hidden");
    modal.setAttribute("aria-hidden", "false");
    document.body.appendChild(modal);
    const dialog = modal.querySelector<HTMLElement>(".ks-dialog")!;
    dialog.focus();
    trapFocus(dialog);
  }

  function hide() {
    if (!open) return;
    open = false;
    modal.setAttribute("aria-hidden", "true");
    document.body.removeChild(modal);
  }

  function toggle() {
    if (open) hide(); else show();
  }

  // Close on backdrop click (not dialog click)
  modal.addEventListener("click", (e) => {
    if (e.target === modal) hide();
  });
  modal.querySelector(".ks-close")!.addEventListener("click", hide);

  // Focus trap
  function trapFocus(container: HTMLElement) {
    container.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { hide(); return; }
      if (e.key !== "Tab") return;
      const focusable = [...container.querySelectorAll<HTMLElement>(
        "button, [href], input, [tabindex]:not([tabindex='-1'])"
      )];
      if (!focusable.length) return;
      // Non-null: length guard above ensures these indices exist
      const first = focusable[0]!, last = focusable[focusable.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
      }
    });
  }

  // Global key listener
  function onKey(e: KeyboardEvent) {
    // Escape always closes any open modal
    if (e.key === "Escape") {
      if (open) { hide(); return; }
      options.onCloseModal?.();
      return;
    }

    if (isInputFocused()) return;

    // Shift+? → toggle overlay
    if (e.key === "?" && e.shiftKey) {
      toggle();
      return;
    }

    // Legacy ?  → open overlay
    if (e.key === "?") { show(); return; }

    // Handle pending "g" chord
    if (pendingG) {
      clearTimeout(pendingGTimer);
      pendingG = false;
      if (e.key === "s") { options.onGoSchedule?.(); return; }
      if (e.key === "h") { options.onGoHistory?.(); return; }
      return;
    }

    if (open) return; // Don't fire other shortcuts while overlay is open

    switch (e.key) {
      case "n": options.onNewStream?.(); break;
      case "C": options.onCreateStream?.(); break;
      case "R": options.onRefresh?.(); break;
      case "c": options.onClaim?.(); break;
      case "ArrowUp":
        e.preventDefault();
        options.onNavigatePrev?.();
        break;
      case "ArrowDown":
        e.preventDefault();
        options.onNavigateNext?.();
        break;
      case "Enter": options.onOpenDetail?.(); break;
      case "g":
        pendingG = true;
        pendingGTimer = window.setTimeout(() => { pendingG = false; }, 1000);
        break;
    }
  }

  document.addEventListener("keydown", onKey);

  // Return cleanup function
  return () => {
    document.removeEventListener("keydown", onKey);
    if (open) hide();
  };
}
