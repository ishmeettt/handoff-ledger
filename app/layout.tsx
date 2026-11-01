import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Handoff Ledger",
  description: "Prevent critical knowledge from leaving with people. Every claim carries its source, its status and its permission.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <div className="topbar-inner">
            <Link href="/" className="brand">
              <span className="brand-mark">HL</span> Handoff&nbsp;Ledger
            </Link>
            <nav>
              <Link href="/">Dashboard</Link>
              <Link href="/sources">Evidence</Link>
              <Link href="/timeline">Timeline</Link>
              <Link href="/review">Review&nbsp;board</Link>
              <Link href="/publish">Publish</Link>
              <Link href="/handover/successor" className="nav-cta">
                Handover&nbsp;view&nbsp;→
              </Link>
            </nav>
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
