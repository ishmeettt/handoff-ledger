"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client";
import LeadOnly from "@/components/LeadOnly";

interface Evidence {
  sourceId: string; quote: string; quoteVerified: boolean;
  matchType: "exact" | "normalized" | "none";
}
interface Claim {
  id: string; type: string; text: string; originalText?: string; status: string;
  supported: "yes" | "partial" | "no" | "not-checked";
  supportReason?: string;
  extractedBy: "groq" | "heuristic";
  statusReason: string; reviewState: string; reviewNote?: string;
  stale?: boolean;
  conflictingWith?: string[];
  evidence: Evidence[];
}
interface State {
  claims: Claim[];
  byReview: Record<string, number>;
  byStatus: Record<string, number>;
  sources: { id: string; name: string; accessLevel: string }[];
}

const SUPPORT_LABEL: Record<string, string> = {
  yes: "support: ✓ states this",
  partial: "support: partial",
  no: "support: ✗ quote does not state this",
  "not-checked": "support: not checked",
};

export default function ReviewBoard() {
  const [state, setState] = useState<State | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [filter, setFilter] = useState("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState("");

  const load = useCallback(async () => {
    const { status, data } = await api<State>("/api/state");
    // /api/state is lead-only by design (S1-1) — explain, never dereference
    // the 403 body (that crashed the page for successor/junior sessions).
    if (status === 403) { setForbidden(true); return; }
    setForbidden(false);
    setState(data);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function act(claim: Claim, action: string, newText?: string) {
    setBusy(claim.id + action);
    await api("/api/review", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ claimId: claim.id, action, newText }),
    });
    setBusy(null);
    setEditing(null);
    load();
  }

  if (forbidden) return <LeadOnly page="Review board" />;
  if (!state) return <p className="muted">Loading…</p>;

  const claims = state.claims.filter(
    (c) => filter === "all" || c.reviewState === filter || c.status === filter
  );
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
      <p className="subtitle">
        Accept, edit, reject or mark unknown — every action is logged with before/after text.
        Reviewer confirmation is shown as its own badge; it never rewrites the evidence status.
      </p>

      <div className="row" style={{ marginBottom: "1.2rem" }}>
        {(["all", "pending", "accepted", "conflicting", "missing"] as const).map((f) => {
          const count =
            f === "all"
              ? state.claims.length
              : f === "conflicting" || f === "missing"
              ? state.claims.filter((c) => c.status === f).length
              : state.claims.filter((c) => c.reviewState === f).length;
          return (
            <button key={f} className={filter === f ? "" : "ghost"} onClick={() => setFilter(f)}>
              {f} ({count})
            </button>
          );
        })}
      </div>

      {claims.map((c) => (
        <div className={`claim cl-${c.status}`} key={c.id}>
          <div className="claim-head">
            <span className={`badge ${c.status}`}>{c.status}</span>
            <span className="claim-type">{c.type}</span>
            {c.extractedBy === "groq" && <span className="badge review">llm</span>}
            {c.extractedBy === "heuristic" && <span className="badge review">pattern</span>}
            <span className={`badge ${c.supported === "yes" ? "verified" : c.supported === "no" ? "conflicting" : "review"}`}>
              {SUPPORT_LABEL[c.supported]}
            </span>
            <span className="badge review">{c.reviewState}</span>
            {c.reviewState === "accepted" && (
              <span className="badge verified" title="Reviewer confirmed this claim. Evidence status unchanged.">confirmed by reviewer</span>
            )}
            {c.conflictingWith?.length ? <span className="muted">conflicts with {c.conflictingWith.length} other claim(s)</span> : null}
          </div>

          {c.originalText && (
            <div className="reason" style={{ marginBottom: 4 }}>
              original: “{c.originalText}”
            </div>
          )}

          {editing === c.id ? (
            <div>
              <div className="quote" style={{ marginBottom: 6 }}>
                evidence quote: “{c.evidence[0]?.quote ?? "(no quote — gap)"}”
              </div>
              <textarea
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                style={{ minHeight: 70, width: "100%" }}
              />
              <div className="actions">
                <button className="small" disabled={busy !== null} onClick={() => act(c, "edited", editText)}>Save edit</button>
                <button className="small ghost" onClick={() => setEditing(null)}>Cancel</button>
                <span className="muted" style={{ fontSize: "0.8rem" }}>Editing sets the claim back to Inferred — new text isn't checked against the quote.</span>
              </div>
            </div>
          ) : (
            <>
              <div className="claim-text">{c.text}</div>
              {c.evidence.map((e, i) => (
                <div className="quote" key={i}>
                  “{e.quote}”
                  <span className="src">
                    ↳ {srcName(e.sourceId)} <span className={`badge access-${srcLevel(e.sourceId)}`}>{srcLevel(e.sourceId)}</span>{" "}
                    {e.quoteVerified
                      ? e.matchType === "exact"
                        ? "· quote found (exact) ✓"
                        : "· quote found (ignoring case/spacing) ✓"
                      : "· QUOTE NOT FOUND ✗"}
                  </span>
                </div>
              ))}
              {c.status === "missing" && (
                <div className="quote">No quote — no evidence exists. This becomes a gap-interview question for the departing member.</div>
              )}
              <div className="reason">{c.statusReason}</div>
              {c.supportReason && <div className="reason">support check: {c.supportReason}</div>}
              {c.reviewNote && <div className="reason">reviewer note: {c.reviewNote}</div>}
              {c.status === "conflicting" && c.reviewState === "pending" && (
                <div className="actions">
                  <button className="small" disabled={busy !== null} onClick={() => act(c, "resolve")}>
                    ✓ This side is correct — resolve conflict
                  </button>
                  <span className="muted" style={{ alignSelf: "center", fontSize: "0.85rem" }}>
                    The other side is rejected automatically and both actions are logged.
                  </span>
                </div>
              )}
              {c.reviewState === "pending" || c.reviewState === "unknown" ? (
                <div className="actions">
                  <button className="small" disabled={busy !== null} onClick={() => act(c, "accepted")}>Accept</button>
                  <button
                    className="small ghost"
                    disabled={busy !== null}
                    onClick={() => { setEditing(c.id); setEditText(c.text); }}
                  >
                    Edit
                  </button>
                  <button className="small ghost" disabled={busy !== null} onClick={() => act(c, "unknown")}>Mark unknown</button>
                  <button className="small danger" disabled={busy !== null} onClick={() => act(c, "rejected")}>Reject</button>
                </div>
              ) : (
                <div className="actions"><span className="muted mono">done — {c.reviewState}</span></div>
              )}
            </>
          )}
        </div>
      )      )}
    </>
  );
}
