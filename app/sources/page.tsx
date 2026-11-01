"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client";

interface Src {
  id: string; name: string; kind: string; accessLevel: string; author: string;
  importedAt: string; chunks: number; content: string;
}
interface Claim {
  id: string; type: string; text: string; status: string;
  evidence: { sourceId: string; quote: string; quoteVerified: boolean }[];
}

// Evidence inspector: shows the raw source with every cited quote highlighted,
// so a judge can check any claim against its origin in one click.
export default function SourcesPage() {
  const [sources, setSources] = useState<Src[]>([]);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data: s } = await api<any>("/api/sources?withContent=1");
    setSources(s.sources ?? []);
    const { data: st } = await api<any>("/api/state");
    setClaims(st.claims ?? []);
    if ((s.sources ?? []).length > 0 && !selected) setSelected(s.sources[0].id);
  }, [selected]);
  useEffect(() => { load(); }, [load]);

  const src = sources.find((s) => s.id === selected);
  const citedQuotes = src
    ? claims
        .flatMap((c) => c.evidence.filter((e) => e.sourceId === src.id).map((e) => ({ ...e, claim: c })))
    : [];

  return (
    <>
      <h1>Evidence inspector</h1>
      <p className="subtitle">
        Every claim must be checkable. Select a source: each quote cited by a claim is highlighted in the
        raw text, with the claim it supports.
      </p>

      <div className="grid" style={{ gridTemplateColumns: "280px 1fr", alignItems: "start" }}>
        <div className="panel" style={{ padding: "0.6rem" }}>
          {sources.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSelected(s.id)}
              className={`src-item${s.id === selected ? " selected" : ""}`}
              aria-pressed={s.id === selected}
            >
              <div style={{ fontSize: "0.9rem", fontWeight: 600 }}>{s.name}</div>
              <div style={{ marginTop: 4 }}>
                <span className={`badge access-${s.accessLevel}`}>{s.accessLevel}</span>{" "}
                <span className="muted mono" style={{ fontSize: "0.75rem" }}>{s.chunks} chunks</span>
              </div>
            </button>
          ))}
        </div>

        <div>
          {!src ? (
            <div className="panel muted">Import sources on the dashboard to inspect them here.</div>
          ) : (
            <>
              <div className="panel" style={{ marginBottom: "1rem" }}>
                <div className="row spread">
                  <div>
                    <strong>{src.name}</strong>
                    <div className="muted" style={{ fontSize: "0.83rem" }}>
                      {src.kind} · by {src.author} · imported {new Date(src.importedAt).toLocaleString()}
                    </div>
                  </div>
                  <span className={`badge access-${src.accessLevel}`}>{src.accessLevel}</span>
                </div>
              </div>
              <div className="panel">
                <div className="mono" style={{ whiteSpace: "pre-wrap", fontSize: "0.83rem", lineHeight: 1.7 }}>
                  {renderHighlighted(src.content, citedQuotes)}
                </div>
              </div>
              <h2>Cited by {citedQuotes.length} claim quote(s)</h2>
              {citedQuotes.length === 0 ? (
                <div className="panel muted" style={{ fontSize: "0.88rem" }}>
                  No claim currently cites this source.
                </div>
              ) : (
                citedQuotes.map((e, i) => (
                  <div className={`claim cl-${e.claim.status}`} key={i}>
                    <div className="claim-head">
                      <span className={`badge ${e.claim.status}`}>{e.claim.status}</span>
                      <span className="claim-type">{e.claim.type}</span>
                      {!e.quoteVerified && <span className="badge conflicting">quote unverified</span>}
                    </div>
                    <div className="claim-text">{e.claim.text}</div>
                  </div>
                ))
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}

// Split content so every cited quote renders as a highlighted <mark>.
function renderHighlighted(content: string, cites: { quote: string; claim: Claim }[]) {
  const points: { start: number; end: number; claim: Claim }[] = [];
  for (const c of cites) {
    const idx = content.indexOf(c.quote);
    if (idx === -1) continue;
    if (points.some((p) => idx >= p.start && idx < p.end)) continue; // overlapping highlight
    points.push({ start: idx, end: idx + c.quote.length, claim: c.claim });
  }
  points.sort((a, b) => a.start - b.start);
  const out: React.ReactNode[] = [];
  let pos = 0;
  for (const p of points) {
    if (p.start > pos) out.push(content.slice(pos, p.start));
    out.push(
      <mark
        key={p.start}
        title={`Claim (${p.claim.status}): ${p.claim.text}`}
      >
        {content.slice(p.start, p.end)}
      </mark>
    );
    pos = p.end;
  }
  out.push(content.slice(pos));
  return out;
}
