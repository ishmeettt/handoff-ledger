"use client";

import { useCallback, useEffect, useState } from "react";

interface Claim {
  id: string; type: string; text: string; topic: string; status: string;
  confidence: number; statusReason: string; reviewState: string; reviewNote?: string;
  conflictingWith?: string[];
  evidence: { chunkId: string; sourceId: string; quote: string; quoteVerified: boolean }[];
}
interface State {
  claims: Claim[];
  byReview: Record<string, number>;
  sources: { id: string; name: string; accessLevel: string }[];
}

export default function ReviewBoard() {
  const [state, setState] = useState<State | null>(null);
  const [filter, setFilter] = useState("all");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/state");
    setState(await r.json());
  }, []);
  useEffect(() => { load(); }, [load]);

  async function act(claim: Claim, action: string) {
    let newText: string | undefined;
    if (action === "edited") {
      newText = prompt("Corrected claim text:", claim.text) ?? undefined;
      if (!newText) return;
    }
    setBusy(claim.id + action);
    await fetch("/api/review", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ claimId: claim.id, action, actor: "reviewer", newText }),
    });
    setBusy(null);
    load();
  }

  if (!state) return <p className="muted">Loading…</p>;

  const claims = state.claims.filter((c) => filter === "all" || c.reviewState === filter || c.status === filter);
  const srcName = (id: string) => state.sources.find((s) => s.id === id)?.name ?? id;
  const srcLevel = (id: string) => state.sources.find((s) => s.id === id)?.accessLevel ?? "?";

  if (state.claims.length === 0) {
    return (
      <>
        <h1>Review board</h1>
        <p className="subtitle">Accept, edit, reject or mark unknown — every action is logged.</p>
        <div className="panel muted">No claims yet. Import sources and run the extraction pipeline from the dashboard first.</div>
      </>
    );
  }

  return (
    <>
      <h1>Review board</h1>
      <p className="subtitle">Accept, edit, reject or mark unknown — every action is logged. Nothing reaches the handover until approved here.</p>

      <div className="row" style={{ marginBottom: "1.2rem" }}>
        {["all", "pending", "accepted", "conflicting", "missing"].map((f) => (
          <button key={f} className={filter === f ? "" : "ghost"} onClick={() => setFilter(f)}>{f} ({f === "all" ? state.claims.length : (state.byReview[f] ?? state.claims.filter((c) => c.status === f).length)})</button>
        ))}
      </div>

      {claims.map((c) => (
        <div className={`claim cl-${c.status}`} key={c.id}>
          <div className="claim-head">
            <span className={`badge ${c.status}`}>{c.status}</span>
            <span className="claim-type">{c.type}</span>
            {c.confidence > 0 && c.status === "inferred" && <span className="muted mono">conf {c.confidence}</span>}
            <span className="badge review">{c.reviewState}</span>
            {c.conflictingWith?.length ? <span className="muted">conflicts with {c.conflictingWith.length} other claim(s)</span> : null}
          </div>
          <div className="claim-text">{c.text}</div>
          {c.evidence.map((e, i) => (
            <div className="quote" key={i}>
              “{e.quote}”
              <span className="src">
                ↳ {srcName(e.sourceId)} <span className={`badge access-${srcLevel(e.sourceId)}`}>{srcLevel(e.sourceId)}</span>{" "}
                {e.quoteVerified ? "· quote exact-matched ✓" : "· QUOTE NOT FOUND ✗"}
              </span>
            </div>
          ))}
          {c.status === "missing" && <div className="quote">No quote — no evidence exists. This becomes a gap-interview question for the departing member.</div>}
          <div className="reason">{c.statusReason}</div>
          {c.reviewNote && <div className="reason">reviewer note: {c.reviewNote}</div>}
          {c.reviewState === "pending" || c.reviewState === "unknown" ? (
            <div className="actions">
              <button className="small" disabled={busy !== null} onClick={() => act(c, "accepted")}>Accept</button>
              <button className="small ghost" disabled={busy !== null} onClick={() => act(c, "edited")}>Edit</button>
              <button className="small ghost" disabled={busy !== null} onClick={() => act(c, "unknown")}>Mark unknown</button>
              <button className="small danger" disabled={busy !== null} onClick={() => act(c, "rejected")}>Reject</button>
            </div>
          ) : (
            <div className="actions"><span className="muted mono">done — {c.reviewState}</span></div>
          )}
        </div>
      ))}
    </>
  );
}
