"use client";
import { useState } from "react";
import { useWallet } from "@/contexts/WalletContext";

const ADMIN_ADDRESS = import.meta.env.VITE_ADMIN_ADDRESS ?? "";
const initialAllowedTokens: string[] = (import.meta.env.VITE_ALLOWED_TOKENS ?? "")
  .split(",")
  .map((token: string) => token.trim())
  .filter(Boolean);

interface AdminAction {
  action: string;
  time: string;
  address: string;
}

export default function AdminPage() {
  const { address, openModal } = useWallet();
  const [minDeposit, setMinDeposit] = useState(import.meta.env.VITE_MIN_DEPOSIT ?? "300000");
  const [newMinDeposit, setNewMinDeposit] = useState("");
  const [allowedTokens, setAllowedTokens] = useState(initialAllowedTokens);
  const [newToken, setNewToken] = useState("");
  const [pendingAction, setPendingAction] = useState<AdminAction | null>(null);
  const [notice, setNotice] = useState("");
  const [audit, setAudit] = useState<AdminAction[]>([]);

  if (!address) {
    return <AccessState title="Admin access" detail="Connect the contract administrator wallet to continue." action={openModal} />;
  }
  if (!ADMIN_ADDRESS || address !== ADMIN_ADDRESS) {
    return <AccessState title="Access restricted" detail="This connected wallet is not configured as the contract administrator." />;
  }

  const stageAction = (action: string) => {
    setNotice("");
    setPendingAction({ action, time: new Date().toLocaleString(), address });
  };

  const confirmPreview = () => {
    if (!pendingAction) return;
    setAudit((current) => [pendingAction, ...current]);
    setNotice("Preview recorded. No contract transaction was submitted.");
    setPendingAction(null);
  };

  return (
    <main style={{ maxWidth: 1000, margin: "0 auto", padding: "2rem 1rem 5rem", color: "#182d35" }}>
      <header style={{ display: "flex", flexWrap: "wrap", alignItems: "end", justifyContent: "space-between", gap: "1rem", borderBottom: "1px solid #cbd8d5", paddingBottom: "1rem" }}>
        <div>
          <p style={{ margin: 0, color: "#147768", fontSize: ".72rem", fontWeight: 700, letterSpacing: ".1em" }}>CONTRACT CONTROL</p>
          <h1 style={{ margin: ".35rem 0 0", fontSize: "1.8rem" }}>Administration</h1>
        </div>
        <p style={{ margin: 0, maxWidth: "100%", overflowWrap: "anywhere", fontFamily: "monospace", fontSize: ".78rem", color: "#53686e" }}>{address}</p>
      </header>

      <p role="status" style={{ margin: "1rem 0", padding: ".7rem .85rem", background: "#fff5dc", borderLeft: "3px solid #c28318", color: "#684b17", fontSize: ".85rem" }}>
        Dashboard preview. Administrative actions are not connected to contract transactions.
      </p>

      <section aria-label="Contract statistics" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: ".75rem", margin: "1.5rem 0 2rem" }}>
        <Metric label="Active streams" value={import.meta.env.VITE_ADMIN_ACTIVE_STREAMS ?? "Not connected"} />
        <Metric label="Tokens locked" value={import.meta.env.VITE_ADMIN_TOKENS_LOCKED ?? "Not connected"} />
        <Metric label="Tokens claimed" value={import.meta.env.VITE_ADMIN_TOKENS_CLAIMED ?? "Not connected"} />
      </section>

      <section style={{ borderTop: "1px solid #cbd8d5", padding: "1.25rem 0" }}>
        <h2 style={{ margin: "0 0 .35rem", fontSize: "1.1rem" }}>Minimum deposit</h2>
        <p style={{ margin: "0 0 1rem", color: "#53686e", fontSize: ".85rem" }}>Current configured value: <strong>{Number(minDeposit).toLocaleString()}</strong></p>
        <form onSubmit={(event) => { event.preventDefault(); if (Number(newMinDeposit) > 0) stageAction(`Set minimum deposit to ${Number(newMinDeposit).toLocaleString()}`); }} style={{ display: "flex", flexWrap: "wrap", gap: ".6rem" }}>
          <label htmlFor="admin-min-deposit" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0,0,0,0)" }}>New minimum deposit</label>
          <input id="admin-min-deposit" inputMode="numeric" pattern="[0-9]+" min="1" required value={newMinDeposit} onChange={(event) => setNewMinDeposit(event.target.value)} placeholder="Enter new amount" style={inputStyle} />
          <button className="btn btn-primary" type="submit">Review change</button>
        </form>
      </section>

      <section style={{ borderTop: "1px solid #cbd8d5", padding: "1.25rem 0" }}>
        <h2 style={{ margin: "0 0 .35rem", fontSize: "1.1rem" }}>Token allowlist</h2>
        <p style={{ margin: "0 0 1rem", color: "#53686e", fontSize: ".85rem" }}>Accepted token contracts for new streams.</p>
        <form onSubmit={(event) => { event.preventDefault(); if (newToken.trim()) stageAction(`Add token ${newToken.trim()}`); }} style={{ display: "flex", flexWrap: "wrap", gap: ".6rem", marginBottom: "1rem" }}>
          <label htmlFor="admin-token-address" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0,0,0,0)" }}>Token contract address</label>
          <input id="admin-token-address" value={newToken} onChange={(event) => setNewToken(event.target.value)} placeholder="C… token contract address" style={{ ...inputStyle, flex: "1 1 280px" }} />
          <button className="btn btn-outline" type="submit">Review addition</button>
        </form>
        {allowedTokens.length ? allowedTokens.map((token) => (
          <div key={token} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: ".5rem", padding: ".65rem 0", borderTop: "1px solid #e0e8e5" }}>
            <code style={{ overflowWrap: "anywhere" }}>{token}</code>
            <button type="button" className="btn btn-outline" onClick={() => stageAction(`Remove token ${token}`)}>Review removal</button>
          </div>
        )) : <p style={{ color: "#53686e", fontSize: ".85rem" }}>No token addresses configured for this preview.</p>}
      </section>

      <section style={{ borderTop: "1px solid #cbd8d5", padding: "1.25rem 0" }}>
        <h2 style={{ margin: "0 0 .75rem", fontSize: "1.1rem" }}>Admin activity</h2>
        {audit.length ? audit.map((entry, index) => <div key={`${entry.time}-${index}`} style={{ display: "grid", gridTemplateColumns: "minmax(160px, 1fr) minmax(0, 2fr)", gap: ".5rem", padding: ".65rem 0", borderTop: "1px solid #e0e8e5", fontSize: ".82rem" }}><time>{entry.time}</time><span>{entry.action} <em>(preview only)</em></span></div>) : <p style={{ color: "#53686e", fontSize: ".85rem" }}>No actions recorded in this session.</p>}
      </section>

      {notice && <p role="status" style={{ color: "#175e51", fontWeight: 700 }}>{notice}</p>}
      {pendingAction && <div role="presentation" style={dialogBackdrop}>
        <section role="dialog" aria-modal="true" aria-labelledby="confirm-admin-action" style={dialogStyle}>
          <h2 id="confirm-admin-action" style={{ marginTop: 0, fontSize: "1.15rem" }}>Review administrator action</h2>
          <p>{pendingAction.action}</p>
          <p style={{ color: "#815416", fontSize: ".85rem" }}>This preview does not submit a transaction or change the contract.</p>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: ".5rem" }}>
            <button className="btn btn-outline" type="button" onClick={() => setPendingAction(null)}>Cancel</button>
            <button className="btn btn-primary" type="button" onClick={confirmPreview}>Record preview</button>
          </div>
        </section>
      </div>}
    </main>
  );
}

function AccessState({ title, detail, action }: { title: string; detail: string; action?: () => void }) {
  return <main style={{ maxWidth: 520, margin: "4rem auto", padding: "1rem" }}><h1>{title}</h1><p style={{ color: "#53686e" }}>{detail}</p>{action && <button className="btn btn-primary" type="button" onClick={action}>Connect wallet</button>}</main>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div style={{ padding: "1rem", borderTop: "3px solid #176b60", background: "#edf4f1" }}><div style={{ color: "#53686e", fontSize: ".78rem" }}>{label}</div><strong style={{ display: "block", marginTop: ".5rem", fontSize: "1.15rem" }}>{value}</strong></div>;
}

const inputStyle: React.CSSProperties = { minHeight: "2.5rem", flex: "1 1 220px", padding: ".5rem .65rem", border: "1px solid #9fb2ad", borderRadius: "4px", background: "white" };
const dialogBackdrop: React.CSSProperties = { position: "fixed", inset: 0, zIndex: 1000, display: "grid", placeItems: "center", padding: "1rem", background: "rgb(10 24 32 / 58%)" };
const dialogStyle: React.CSSProperties = { width: "min(100%, 440px)", padding: "1.25rem", background: "#f8fbfa", border: "1px solid #cbd9d5", borderRadius: "6px" };
