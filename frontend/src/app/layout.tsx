import "./globals.css";
import { WalletProvider } from "@/contexts/WalletContext";
import { I18nProvider } from "@/components/I18nProvider";
import { AnalyticsInit } from "@/components/AnalyticsInit";
import { DarkModeToggle } from "@/components/DarkModeToggle";

// Inline script run before paint to prevent flash of unstyled content
const noFoucScript = `(function(){try{var d=localStorage.getItem('vesting-dark-mode');if(d==='true'||(d===null&&window.matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.classList.add('dark')}}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* eslint-disable-next-line react/no-danger */}
        <script dangerouslySetInnerHTML={{ __html: noFoucScript }} />
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
          <WalletProvider>
            <header className="header" style={{ maxWidth: 720, margin: "0 auto", padding: "0 1rem" }}>
              <span style={{ fontWeight: 700, fontSize: "1.1rem" }}>⚡ VestingStream</span>
              <DarkModeToggle />
            </header>
            {children}
          </WalletProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
