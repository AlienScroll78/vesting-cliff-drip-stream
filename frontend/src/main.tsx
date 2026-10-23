import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "./app/globals.css";
import { I18nProvider } from "@/components/I18nProvider";
import { WalletProvider } from "@/contexts/WalletContext";
import { NotificationProvider } from "@/contexts/NotificationContext";
import Dashboard from "@/app/page";

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root element #root not found in index.html");
}

createRoot(container).render(
  <StrictMode>
    <I18nProvider>
      <WalletProvider>
        <NotificationProvider>
          <Dashboard />
        </NotificationProvider>
      </WalletProvider>
    </I18nProvider>
  </StrictMode>,
);
