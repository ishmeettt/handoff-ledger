"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/client";

interface Progress {
  sources: number;
  extracted: boolean;
  claims: number;
  verified: number;
  /** lead-only: claims awaiting review; null when unknown for this role */
  pending: number | null;
  /** latest published version number, null when nothing published */
  version: number | null;
  signedIn: boolean;
}

const STAGES = [
  { key: "connect", label: "Connect", href: "/", count: (p: Progress) => `${p.sources} src` },
  { key: "reconstruct", label: "Reconstruct", href: "/", count: (p: Progress) => `${p.claims} claims` },
  { key: "verify", label: "Verify", href: "/sources", count: (p: Progress) => (p.verified > 0 ? `${p.verified} verified` : "—") },
  { key: "review", label: "Review", href: "/review", count: (p: Progress) => (p.pending === null ? "" : p.pending > 0 ? `${p.pending} pending` : "done") },
  { key: "handover", label: "Handover", href: "/handover", count: (p: Progress) => (p.version ? `v${p.version}` : "—") },
];

function stageDone(key: string, p: Progress): boolean {
  switch (key) {
    case "connect": return p.sources > 0;
    case "reconstruct": return p.extracted || p.version !== null;
    case "verify": return p.verified > 0 || p.version !== null;
    case "review": return p.version !== null || (p.pending !== null && p.pending === 0 && p.claims > 0);
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
    (async () => {
      const st = await api<any>("/api/state");
      if (!alive) return;
      if (st.status === 401) return; // not signed in — render nothing
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
          pending: d.pendingUnreviewed ?? 0,
          version: d.versions?.length ? d.versions[d.versions.length - 1].version : null,
          signedIn: true,
        });
        return;
      }
      // non-lead (403): build from the endpoints every role may call
      const [sv, vw] = await Promise.all([api<any>("/api/sources"), api<any>("/api/view")]);
      if (!alive) return;
      if (sv.status === 401) return;
      const claims: any[] = vw.data?.claims ?? [];
      setP({
        sources: (sv.data?.sources ?? []).length,
        extracted: !!vw.data?.published || claims.length > 0,
        claims: claims.length,
        verified: claims.filter((c) => c.status === "verified").length,
        pending: null,
        version: vw.data?.published ? vw.data.version : null,
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
