import "./globals.css";
import { WalletProvider } from "@/contexts/WalletContext";
import { NotificationProvider } from "@/contexts/NotificationContext";
import { I18nProvider } from "@/components/I18nProvider";
import { AnalyticsInit } from "@/components/AnalyticsInit";
import { DarkModeToggle } from "@/components/DarkModeToggle";
import { NotificationCenter } from "@/components/NotificationCenter";
import { HorizonStatusBanner } from "@/components/HorizonStatusBanner";
import { MobileBottomNav } from "@/components/MobileBottomNav";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { WalletButton } from "@/components/WalletButton";

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
        <style>{`
          /* ── Desktop top navigation (#770) ── */
          .desktop-nav {
            display: none;
          }

          @media (min-width: 768px) {
            .desktop-nav {
              display: flex;
              align-items: center;
              gap: 0.25rem;
            }

            .desktop-nav-link {
              display: inline-flex;
              align-items: center;
              padding: 0.4rem 0.75rem;
              border-radius: var(--radius, 0.5rem);
              font-size: 0.9rem;
              font-weight: 500;
              color: var(--color-text, #111827);
              text-decoration: none;
              transition: background 0.15s ease, color 0.15s ease;
              white-space: nowrap;
            }

            .desktop-nav-link:hover,
            .desktop-nav-link:focus-visible {
              background: color-mix(in srgb, var(--color-active, #1d6ae5) 10%, transparent);
              color: var(--color-active, #1d6ae5);
            }

            .desktop-nav-link[aria-current="page"] {
              color: var(--color-active, #1d6ae5);
              font-weight: 700;
              background: color-mix(in srgb, var(--color-active, #1d6ae5) 10%, transparent);
            }
          }
        `}</style>
      </head>
      <body>
        {/* #69 — skip navigation link */}
        <a href="#main-content" className="skip-nav">
          Skip to main content
        </a>
        <I18nProvider>
          <AnalyticsInit />
          {/* #278 — Horizon API status banner */}
          <HorizonStatusBanner />
          <WalletProvider>
            <NotificationProvider>
              {/*
               * #770 — Responsive navigation
               * Desktop (≥768px): top header bar with logo + nav links + wallet
               * Mobile (<768px): simplified header + MobileBottomNav tab bar
               */}
              <header
                className="header"
                style={{ maxWidth: 1080, margin: "0 auto", padding: "0 1rem" }}
              >
                {/* Logo */}
                <a
                  href="/"
                  style={{ fontWeight: 700, fontSize: "1.1rem", textDecoration: "none", color: "inherit" }}
                  aria-label="VestingStream home"
                >
                  ⚡ VestingStream
                </a>

                {/* Desktop primary nav — hidden on mobile */}
                <nav
                  aria-label="Primary navigation"
                  className="desktop-nav"
                >
                  <a href="/"             className="desktop-nav-link">Dashboard</a>
                  <a href="/sponsor"      className="desktop-nav-link">Create Stream</a>
                  <a href="/explore"      className="desktop-nav-link">Explore</a>
                </nav>

                {/* Right-side controls */}
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  {/* #382 — Notification bell */}
                  <NotificationCenter />
                  {/* #280 — Language switcher */}
                  <LanguageSwitcher />
                  <DarkModeToggle />
                  {/* Connect Wallet — desktop */}
                  <span className="desktop-nav" style={{ gap: 0 }}>
                    <WalletButton />
                  </span>
                </div>
              </header>

              {children}

              {/* #770 — Mobile bottom navigation (hidden on desktop via CSS) */}
              <MobileBottomNav />
            </NotificationProvider>
          </WalletProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
