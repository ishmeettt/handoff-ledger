"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import UserBar from "./UserBar";

const LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/sources", label: "Evidence" },
  { href: "/timeline", label: "Timeline" },
  { href: "/review", label: "Review board" },
  { href: "/publish", label: "Publish" },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

function ThemeToggle() {
  // Theme is set by the inline head script before first paint; this button
  // flips it and persists the choice.
  const [theme, setTheme] = useState<string | null>(null);
  useEffect(() => {
    setTheme(document.documentElement.getAttribute("data-theme"));
  }, []);
  function flip() {
    const next = theme === "light" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("hl-theme", next);
    } catch {}
    setTheme(next);
  }
  return (
    <button
      className="theme-toggle"
      onClick={flip}
      aria-label={`Switch to ${theme === "light" ? "dark" : "light"} theme`}
      title={`Switch to ${theme === "light" ? "dark" : "light"} theme`}
    >
      {theme === "light" ? "☾" : "☀"}
    </button>
  );
}

// Sticky header nav with per-route active states (never derived from data).
export default function TopNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Main">
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} className={isActive(pathname, l.href) ? "active" : undefined}>
          {l.label}
        </Link>
      ))}
      <Link href="/handover" className="nav-cta">
        Handover&nbsp;view&nbsp;→
      </Link>
      <ThemeToggle />
      <UserBar />
    </nav>
  );
}
