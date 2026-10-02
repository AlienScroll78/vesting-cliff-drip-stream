"use client";
import { useState } from "react";
import { isOptedOut, optIn, optOut } from "@/analytics";

export function AnalyticsOptOut() {
  const [opted, setOpted] = useState(() => isOptedOut());

  const toggle = () => {
    if (opted) { optIn(); setOpted(false); }
    else { optOut(); setOpted(true); }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={opted}
      style={{ fontSize: "0.75rem", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}
    >
      {opted ? "Enable analytics" : "Disable analytics"}
    </button>
  );
}
