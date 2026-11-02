"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

// Raw fetch on purpose: the shared api() helper BOUNCES to /login on 401,
// which would loop forever when this decorative component renders on the
// login page itself. A stepper must never redirect anyone.
async function safeJson(path: string): Promise<{ status: number; data: any } | null> {
  try {
    const r = await fetch(path);
    const data = await r.json().catch(() => ({}));
    return { status: r.status, data };
  } catch {
    return null;
  }
}

interface Progress {
  sources: number;
  extracted: boolean;
  claims: number;
  verified: number;
  /** lead-only: quotes found in source (honest verify metric) */
  quotes: { found: number; total: number } | null;
  /** lead-only: claims awaiting review; null when unknown for this role */
  pending: number | null;
  /** latest published version number, null when nothing published */
  version: number | null;
  signedIn: boolean;
}

const STAGES = [
  { key: "connect", label: "Connect", href: "/", count: (p: Progress) => `${p.sources} src` },
  { key: "reconstruct", label: "Reconstruct", href: "/", count: (p: Progress) => `${p.claims} claims` },
  {
    key: "verify", label: "Verify", href: "/sources",
    count: (p: Progress) =>
      p.quotes && p.quotes.total > 0
        ? `${p.quotes.found}/${p.quotes.total} quotes`
        : p.verified > 0 ? `${p.verified} verified` : "—",
  },
  {
    key: "review", label: "Review", href: "/review",
    count: (p: Progress) =>
      p.pending === null
        ? p.version !== null ? "published" : "—"
        : p.pending > 0 ? `${p.pending} pending` : "done",
  },
  { key: "handover", label: "Handover", href: "/handover", count: (p: Progress) => (p.version ? `v${p.version}` : "—") },
];

function stageDone(key: string, p: Progress): boolean {
  switch (key) {
    case "connect": return p.sources > 0;
    case "reconstruct": return p.extracted || p.version !== null;
    case "verify":
      return !!(p.quotes && p.quotes.total > 0) || p.verified > 0 || p.version !== null;
    case "review":
      // lead: done only when NOTHING is pending; other roles: the lead's
      // review gate is invisible to them, so a published handover counts
      return p.pending === null
        ? p.version !== null
        : p.pending === 0 && p.claims > 0;
    case "handover": return p.version !== null;
    default: return false;
  }
}

/**
 * Workflow stepper in the header (fixes-only #11):
 * Connect → Reconstruct → Verify → Review → Handover.
 * Counts come from /api/state for leads; other roles fall back to
 * /api/sources + /api/view so no role is shown another role's numbers.
 */
export default function WorkflowStepper() {
  const [p, setP] = useState<Progress | null>(null);

  useEffect(() => {
    let alive = true;
    if (window.location.pathname === "/login") return; // nothing to show, no probe
    (async () => {
      const st = await safeJson("/api/state");
      if (!alive) return;
      if (!st || st.status === 401) return; // not signed in — render nothing
      if (st.status === 200 && st.data) {
        const d = st.data;
        const byStatus = d.byStatus ?? {};
        setP({
          sources: (d.sources ?? []).length,
          extracted: !!d.extractedAt,
          claims:
            (byStatus.verified ?? 0) + (byStatus.inferred ?? 0) +
            (byStatus.conflicting ?? 0) + (byStatus.missing ?? 0),
          verified: byStatus.verified ?? 0,
          quotes: d.quotesFound ?? null,
          pending: d.pendingUnreviewed ?? 0,
          version: d.versions?.length ? d.versions[d.versions.length - 1].version : null,
          signedIn: true,
        });
        return;
      }
      // non-lead (403): build from the endpoints every role may call
      const [sv, vw] = await Promise.all([safeJson("/api/sources"), safeJson("/api/view")]);
      if (!alive) return;
      if (!sv || sv.status === 401) return;
      const claims: any[] = vw?.data?.claims ?? [];
      const withEv = claims.filter((c) => (c.evidence ?? []).length > 0);
      setP({
        sources: (sv.data?.sources ?? []).length,
        extracted: !!vw?.data?.published || claims.length > 0,
        claims: claims.length,
        verified: claims.filter((c) => c.status === "verified").length,
        quotes: {
          found: withEv.filter((c) => c.evidence.every((e: any) => e.quoteVerified)).length,
          total: withEv.length,
        },
        pending: null,
        version: vw?.data?.published ? vw.data.version : null,
        signedIn: true,
      });
    })();
    return () => { alive = false; };
  }, []);

  if (!p || !p.signedIn) return null;
  const firstPending = STAGES.find((s) => !stageDone(s.key, p))?.key ?? null;

  return (
    <nav className="stepper" aria-label="Handover workflow progress">
      {STAGES.map((s, i) => {
        const done = stageDone(s.key, p);
        const current = s.key === firstPending;
        return (
          <span key={s.key} className="stepper-stage-wrap">
            {i > 0 && <span className="stepper-connector" aria-hidden="true">›</span>}
            <Link
              href={s.href}
              className={`stepper-stage${done ? " done" : current ? " current" : ""}`}
              aria-current={current ? "step" : undefined}
              title={`${s.label} — ${s.count(p)}`}
            >
              <span className="stepper-label">{done ? "✓ " : ""}{s.label}</span>
              <span className="stepper-count">{s.count(p)}</span>
            </Link>
          </span>
        );
      })}
    </nav>
  );
}
