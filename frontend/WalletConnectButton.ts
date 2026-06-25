/**
 * WalletConnectButton — three states: disconnected | connecting | connected
 * Dropdown: copy address, view on Explorer, disconnect
 * Compatible with Freighter and Albedo wallet adapters.
 */

export type WalletState = "disconnected" | "connecting" | "connected";

export interface WalletConnectButtonProps {
  state: WalletState;
  address?: string;          // full public key when connected
  avatarUrl?: string;
  onConnect: () => void;
  onDisconnect: () => void;
}

// ── Utility ──────────────────────────────────────────────────────────────────

function truncate(addr: string): string {
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

function explorerUrl(addr: string): string {
  return `https://stellar.expert/explorer/testnet/account/${addr}`;
}

// ── Component (framework-free, returns a DOM node) ────────────────────────────

export function createWalletConnectButton(
  props: WalletConnectButtonProps
): HTMLElement {
  const root = document.createElement("div");
  root.className = "wcb-root";

  switch (props.state) {
    case "disconnected":
      root.appendChild(renderDisconnected(props));
      break;
    case "connecting":
      root.appendChild(renderConnecting());
      break;
    case "connected":
      root.appendChild(renderConnected(props));
      break;
  }

  return root;
}

// ── State renderers ───────────────────────────────────────────────────────────

function renderDisconnected(props: WalletConnectButtonProps): HTMLElement {
  const btn = document.createElement("button");
  btn.className = "wcb-btn wcb-btn--primary";
  btn.textContent = "Connect Wallet";
  btn.setAttribute("aria-label", "Connect your wallet");
  btn.addEventListener("click", props.onConnect);
  return btn;
}

function renderConnecting(): HTMLElement {
  const btn = document.createElement("button");
  btn.className = "wcb-btn wcb-btn--connecting";
  btn.disabled = true;
  btn.setAttribute("aria-label", "Connecting to wallet");
  btn.setAttribute("aria-busy", "true");

  const spinner = document.createElement("span");
  spinner.className = "wcb-spinner";
  spinner.setAttribute("aria-hidden", "true");

  btn.append(spinner, " Connecting…");
  return btn;
}

function renderConnected(props: WalletConnectButtonProps): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "wcb-connected";
  wrapper.style.position = "relative";

  const btn = document.createElement("button");
  btn.className = "wcb-btn wcb-btn--connected";
  btn.setAttribute("aria-haspopup", "true");
  btn.setAttribute("aria-expanded", "false");
  btn.setAttribute("aria-label", `Wallet connected: ${props.address}. Open wallet menu`);

  if (props.avatarUrl) {
    const img = document.createElement("img");
    img.src = props.avatarUrl;
    img.alt = "";
    img.className = "wcb-avatar";
    img.setAttribute("aria-hidden", "true");
    btn.appendChild(img);
  }

  const addrSpan = document.createElement("span");
  addrSpan.className = "wcb-address";
  addrSpan.textContent = truncate(props.address!);
  btn.appendChild(addrSpan);

  const chevron = document.createElement("span");
  chevron.className = "wcb-chevron";
  chevron.setAttribute("aria-hidden", "true");
  chevron.textContent = "▾";
  btn.appendChild(chevron);

  // Dropdown
  const dropdown = buildDropdown(props, btn);
  dropdown.hidden = true;

  btn.addEventListener("click", () => {
    const open = !dropdown.hidden;
    dropdown.hidden = open;
    btn.setAttribute("aria-expanded", String(!open));
    if (!open) (dropdown.querySelector("a,button") as HTMLElement)?.focus();
  });

  // Close on outside click
  document.addEventListener("click", (e) => {
    if (!wrapper.contains(e.target as Node)) {
      dropdown.hidden = true;
      btn.setAttribute("aria-expanded", "false");
    }
  });

  wrapper.append(btn, dropdown);
  return wrapper;
}

function buildDropdown(
  props: WalletConnectButtonProps,
  triggerBtn: HTMLButtonElement
): HTMLElement {
  const menu = document.createElement("ul");
  menu.className = "wcb-dropdown";
  menu.setAttribute("role", "menu");

  const items: Array<{ label: string; action: () => void }> = [
    {
      label: "Copy address",
      action: () => {
        navigator.clipboard.writeText(props.address!);
        close();
      },
    },
    {
      label: "View on Explorer",
      action: () => {
        window.open(explorerUrl(props.address!), "_blank", "noopener");
        close();
      },
    },
    {
      label: "Disconnect",
      action: () => {
        props.onDisconnect();
        close();
      },
    },
  ];

  function close() {
    menu.hidden = true;
    triggerBtn.setAttribute("aria-expanded", "false");
    triggerBtn.focus();
  }

  items.forEach(({ label, action }, i) => {
    const li = document.createElement("li");
    li.setAttribute("role", "none");

    const btn = document.createElement("button");
    btn.className = "wcb-dropdown__item";
    btn.setAttribute("role", "menuitem");
    btn.textContent = label;
    btn.addEventListener("click", action);

    // Arrow-key navigation
    btn.addEventListener("keydown", (e) => {
      const btns = [...menu.querySelectorAll<HTMLButtonElement>("[role=menuitem]")];
      if (e.key === "ArrowDown") { e.preventDefault(); btns[(i + 1) % btns.length].focus(); }
      if (e.key === "ArrowUp")   { e.preventDefault(); btns[(i - 1 + btns.length) % btns.length].focus(); }
      if (e.key === "Escape")    { close(); }
    });

    li.appendChild(btn);
    menu.appendChild(li);
  });

  return menu;
}
