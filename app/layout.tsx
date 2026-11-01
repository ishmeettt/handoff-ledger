import type { Metadata } from "next";
import Link from "next/link";
import TopNav from "@/components/TopNav";
import "./globals.css";

export const metadata: Metadata = {
  title: "Handoff Ledger",
  description: "Prevent critical knowledge from leaving with people. Every claim carries its source, its status and its permission.",
};

// Set the theme before first paint so there is no light/dark flash. The
// server renders data-theme="dark" (the default), so the script only mutates
// the attribute when the visitor actually wants light — no hydration mismatch
// for the default case.
const themeInit = `(function(){try{var t=localStorage.getItem('hl-theme')||(window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark');if(t==='light')document.documentElement.setAttribute('data-theme','light');}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark">
      <head>
        {/* Fonts loaded in <head> so they fetch in parallel with the
            stylesheet (Adminator pattern) — no render-blocking CSS hop. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body>
        <header className="topbar">
          <div className="topbar-inner">
            <Link href="/" className="brand">
              <span className="brand-mark">HL</span>
              Handoff&nbsp;Ledger
            </Link>
            <TopNav />
          </div>
        </header>
        <main className="container">{children}</main>
        <footer className="footer">
          Handoff Ledger — Round 2 build. All demonstration data is synthetic.
        </footer>
      </body>
    </html>
  );
}
