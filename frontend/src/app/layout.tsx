import "./globals.css";
import { WalletProvider } from "@/contexts/WalletContext";
import { I18nProvider } from "@/components/I18nProvider";
import { AnalyticsInit } from "@/components/AnalyticsInit";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <title>Vesting Stream</title>
        <meta name="description" content="Cliff + drip vesting on Stellar" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body>
        {/* #69 — skip navigation link */}
        <a href="#main-content" className="skip-nav">
          Skip to main content
        </a>
        <I18nProvider>
          <AnalyticsInit />
          <WalletProvider>{children}</WalletProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
