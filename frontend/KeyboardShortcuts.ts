/**
 * KeyboardShortcuts — modal triggered by the `?` key.
 *
 * Shortcuts:
 *   ?       → open this modal
 *   n       → new stream
 *   c       → claim
 *   g s     → go to schedule
 *   g h     → go to history
 *
 * Rules:
 *   - Disabled when focus is inside any <input>, <textarea>, or [contenteditable]
 *   - Traps focus inside the modal while open
 *   - Closes on Escape or clicking the backdrop
 */

export interface ShortcutDef {
  keys: string[];  // display strings, e.g. ["g", "s"]
  label: string;
}

const SHORTCUTS: ShortcutDef[] = [
  { keys: ["?"],      label: "Show keyboard shortcuts" },
  { keys: ["n"],      label: "New stream" },
  { keys: ["c"],      label: "Claim vested tokens" },
  { keys: ["g", "s"], label: "Go to schedule" },
  { keys: ["g", "h"], label: "Go to history" },
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
      if (i < keys.length - 1) keysCell.append(" then ");
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
  onClaim?: () => void;
  onGoSchedule?: () => void;
  onGoHistory?: () => void;
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
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
      }
    });
  }

  // Global key listener
  function onKey(e: KeyboardEvent) {
    if (open && e.key === "Escape") { hide(); return; }
    if (isInputFocused()) return;

    // Handle pending "g" chord
    if (pendingG) {
      clearTimeout(pendingGTimer);
      pendingG = false;
      if (e.key === "s") { options.onGoSchedule?.(); return; }
      if (e.key === "h") { options.onGoHistory?.(); return; }
      return;
    }

    switch (e.key) {
      case "?": show(); break;
      case "n": if (!open) options.onNewStream?.(); break;
      case "c": if (!open) options.onClaim?.(); break;
      case "g":
        if (!open) {
          pendingG = true;
          pendingGTimer = window.setTimeout(() => { pendingG = false; }, 1000);
        }
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
