"use client";
import { useWallet } from "@/contexts/WalletContext";

export function AdminNavigation() {
  const { address } = useWallet();
  const adminAddress = import.meta.env.VITE_ADMIN_ADDRESS;

  if (!address || !adminAddress || address !== adminAddress) return null;

  return (
    <a href="/admin" aria-label="Contract administration" title="Contract administration" style={{ color: "#176b60", fontSize: ".85rem", fontWeight: 700, textDecoration: "none" }}>
      Admin
    </a>
  );
}