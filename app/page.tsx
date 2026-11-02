"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/client";

interface Src {
  id: string; name: string; kind: string; accessLevel: string;
  author: string; importedAt: string; chunks: number; preview: string;
}
interface State {
  projectName: string; extractedAt: string | null; sources: Src[];
  byStatus: Record<string, number>; byReview: Record<string, number>;
  pendingUnreviewed: number;
  quotesFound: { found: number; total: number };
  supportCounts: Record<string, number>;
  audit: { id: string; at: string; actor: string; action: string; detail: string }[];
  versions?: { version: number }[];
  isLead?: boolean;
  viewNote?: string;
}

export default function Dashboard() {
  const [state, setState] = useState<State | null>(null);
  const [form, setForm] = useState({ name: "", kind: "meeting-notes", accessLevel: "internal", author: "", content: "", confirmedPermission: false });
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err" | "warn"; text: string } | null>(null);
  const [elapsed, setElapsed] = useState<number | null>(null); // live seconds while extracting
  const [extractLog, setExtractLog] = useState<{
    steps: { label: string; detail?: string; atMs: number }[];
    durationMs: number;
    summary: string;
  } | null>(null);

  const load = useCallback(async () => {
    const { status, data } = await api<State>("/api/state");
    if (status === 403) {
      // Non-lead: reviewer state is off-limits (S1-1) — build a
      // role-appropriate dashboard from the endpoints every role may call,
      // instead of dereferencing the 403 body (which crashed the page).
      const [sv, vw] = await Promise.all([api<any>("/api/sources"), api<any>("/api/view")]);
      const sources: Src[] = sv.data.sources ?? [];
      const claims: any[] = vw.data.claims ?? [];
      const byStatus: Record<string, number> = { verified: 0, inferred: 0, conflicting: 0, missing: 0 };
      for (const c of claims) if (byStatus[c.status] !== undefined) byStatus[c.status]++;
      const withEv = claims.filter((c) => (c.evidence ?? []).length > 0);
      setState({
        projectName: vw.data.published ? vw.data.projectName : "Handover",
        extractedAt: vw.data.publishedAt ?? null,
        sources,
        byStatus,
        byReview: { pending: 0, accepted: 0, edited: 0, rejected: 0, unknown: 0 },
        pendingUnreviewed: 0,
        quotesFound: {
          found: withEv.filter((c) => c.evidence.every((e: any) => e.quoteVerified)).length,
          total: withEv.length,
        },
        supportCounts: {},
        audit: [],
        isLead: false,
        viewNote: vw.data.published
          ? `Published handover v${vw.data.version} — ${vw.data.excludedCount} claim(s) excluded for your role. Import, extraction and the audit log are lead-only.`
          : "No published handover yet — a reviewer must publish before role views exist. Import, extraction and the audit log on this page are lead-only.",
      });
      return;
    }
    setState({ ...data, isLead: true });
  }, []);
  useEffect(() => { load(); }, [load]);

  async function importSource(e: React.FormEvent) {
    e.preventDefault();
    setBusy("import");
    setMsg(null);
    const { ok, data } = await api<any>("/api/sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setBusy(null);
    if (!ok) return setMsg({ kind: "err", text: data.error ?? "Import failed" });
    setMsg({ kind: "ok", text: `Imported with ${data.chunks} chunks. Run extraction to turn it into claims.` });
    setForm({ ...form, name: "", content: "", confirmedPermission: false });
    load();
  }

  async function runReset() {
    if (!confirm("Reset the demo? This re-seeds the synthetic project, re-extracts claims (all unreviewed) and publishes a fresh baseline v1. Anything another visitor added will be removed.")) return;
    setBusy("reset");
    setMsg(null);
    const { ok, data } = await api<any>("/api/reset", { method: "POST" });
    setBusy(null);
    if (!ok) return setMsg({ kind: "err", text: data.error ?? "Reset failed" });
    setMsg({
      kind: "ok",
      text: `Demo restored: ${data.sources} sources, ${data.claims} claims (all pending review), baseline v${data.baselineVersion} published with ${data.baselineClaims} claims.`,
    });
    load();
  }

  async function runExtract() {
    if (state && state.pendingUnreviewed > 0) {
      if (!confirm("Re-running extraction replaces all claims. Reviews on claims that still exist are KEPT; reviews on changed or removed claims are dropped. Continue?")) return;
    }
    setBusy("extract");
    setMsg(null);
    setExtractLog(null);
    setElapsed(0);
    const iv = setInterval(() => setElapsed((e) => (e ?? 0) + 1), 1000);
    const { ok, data } = await api<any>("/api/extract", { method: "POST" });
    clearInterval(iv);
    setElapsed(null);
    setBusy(null);
    if (!ok) return setMsg({ kind: "err", text: data.error ?? "Extraction failed" });
    const secs = ((data.durationMs ?? 0) / 1000).toFixed(1);
    setExtractLog({
      steps: data.steps ?? [],
      durationMs: data.durationMs ?? 0,
      summary: data.extractorSummary ?? "unknown",
    });
    const keptNote =
      data.reviewsKept !== undefined
        ? ` ${data.reviewsKept} review(s) kept, ${data.newToReview} new to review, ${data.noLongerFound} no longer found.`
        : "";
    setMsg({
      kind: data.errors?.length ? "warn" : "ok",
      text: `Extracted ${data.count} claims in ${secs}s with: ${data.extractorSummary ?? "unknown"}.${keptNote} Now review them.`,
    });
    load();
  }

  if (!state) return <p className="muted">Loading…</p>;
  const isLead = state.isLead !== false;
  const total = state.byStatus.verified + state.byStatus.inferred + state.byStatus.conflicting + state.byStatus.missing;

  return (
    <>
      <h1>{state.projectName}</h1>
      <p className="subtitle">
        Every statement is a claim backed by a verbatim quote and a source. Uncertainty is shown, never hidden.
      </p>

      <div className="grid grid-stats">
        <div className="stat"><div className="num">{total}</div><div className="lbl">Claims</div></div>
        <div className="stat verified"><div className="num">{state.byStatus.verified}</div><div className="lbl">Verified (quote+support)</div></div>
        <div className="stat inferred"><div className="num">{state.byStatus.inferred}</div><div className="lbl">Inferred</div></div>
        <div className="stat conflicting"><div className="num">{state.byStatus.conflicting}</div><div className="lbl">Conflicting</div></div>
        <div className="stat missing"><div className="num">{state.byStatus.missing}</div><div className="lbl">Missing</div></div>
        {isLead && <div className="stat"><div className="num">{state.pendingUnreviewed}</div><div className="lbl">Awaiting review</div></div>}
        <div className="stat">
          <div className="num" style={{ fontSize: "1.3rem" }}>
            {state.quotesFound.total > 0 ? `${state.quotesFound.found}/${state.quotesFound.total}` : "—"}
          </div>
          <div className="lbl">Quotes found in source</div>
        </div>
      </div>

      {msg && (
        <div className={`notice ${msg.kind}`} role={msg.kind === "err" ? "alert" : "status"}>
          {msg.text}
        </div>
      )}
      <div className="notice warn" role="status">
        🧪 Shared demo with synthetic data — other visitors may change it.
        {isLead && (
          <button
            className="ghost"
            style={{ marginLeft: "0.8rem", padding: "0.2rem 0.7rem", fontSize: "0.85rem" }}
            onClick={runReset}
            disabled={busy !== null}
          >
            {busy === "reset" ? "Resetting…" : "Reset demo data"}
          </button>
        )}
      </div>
      {state.viewNote && <div className="notice warn">{state.viewNote}</div>}

      {/* One primary next step (fixes-only #11) */}
      <div style={{ margin: "0 0 1.6rem" }}>
        {isLead ? (
          state.pendingUnreviewed > 0 ? (
            <Link href="/review" className="btn" style={{ background: "var(--accent)", padding: "0.55rem 1.1rem", borderRadius: 7, display: "inline-block", fontWeight: 700 }}>
              Review {state.pendingUnreviewed} claim{state.pendingUnreviewed === 1 ? "" : "s"} →
            </Link>
          ) : !(state.versions?.length) ? (
            <Link href="/publish" className="btn" style={{ background: "var(--accent)", padding: "0.55rem 1.1rem", borderRadius: 7, display: "inline-block", fontWeight: 700 }}>
              Publish the handover →
            </Link>
          ) : (
            <Link href="/handover" className="btn" style={{ background: "var(--accent)", padding: "0.55rem 1.1rem", borderRadius: 7, display: "inline-block", fontWeight: 700 }}>
              Open the handover plan →
            </Link>
          )
        ) : (
          <Link href="/handover" className="btn" style={{ background: "var(--accent)", padding: "0.55rem 1.1rem", borderRadius: 7, display: "inline-block", fontWeight: 700 }}>
            Open your handover view →
          </Link>
        )}
      </div>

      <h2>Sources ({state.sources.length})</h2>
      {state.sources.length === 0 ? (
        <div className="panel muted">No sources visible to your role. Import one below (lead only).</div>
      ) : (
        <div className="panel" style={{ padding: 0 }}>
          <table>
            <thead><tr><th>Name</th><th>Kind</th><th>Access</th><th>Author</th><th>Chunks</th></tr></thead>
            <tbody>
              {state.sources.map((s) => (
                <tr key={s.id}>
                  <td>{s.name}</td>
                  <td className="muted">{s.kind}</td>
                  <td><span className={`badge access-${s.accessLevel}`}>{s.accessLevel}</span></td>
                  <td className="muted">{s.author}</td>
                  <td className="mono muted">{s.chunks}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {isLead && (
        <div className="row mt">
          <button onClick={runExtract} disabled={busy !== null || state.sources.length === 0}>
            {busy === "extract" ? `Extracting… ${elapsed ?? 0}s` : "Run extraction pipeline"}
          </button>
          {busy === "extract" && (
            <span className="muted" role="status">
              reading sources → model extraction → quote checks → conflicts (rate-limited calls take 30–90s)
            </span>
          )}
          {state.extractedAt && <span className="muted mono">last extraction: {new Date(state.extractedAt).toLocaleString()}</span>}
        </div>
      )}

      {isLead && extractLog && (
        <div className="panel mt" aria-label="Extraction step log">
          <div style={{ marginBottom: "0.5rem" }}>
            <strong>Extracted with:</strong> {extractLog.summary}
            {" · "}<span className="mono">{(extractLog.durationMs / 1000).toFixed(1)}s total</span>
          </div>
          <ol style={{ paddingLeft: "1.2rem", margin: 0, fontSize: "0.9rem" }}>
            {extractLog.steps.map((s, i) => (
              <li key={i} style={{ marginBottom: "0.25rem" }}>
                <span className="mono muted">{(s.atMs / 1000).toFixed(1)}s</span>{" "}
                {s.label}
                {s.detail && <span className="muted"> — {s.detail}</span>}
              </li>
            ))}
          </ol>
        </div>
      )}

      {isLead && (
      <div className="grid grid-2 mt">
        <div>
          <h2 style={{ marginTop: 0 }}>Import a source</h2>
          <form className="panel" onSubmit={importSource}>
            <div className="field">
              <label>Name</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Standup notes — April" required maxLength={120} />
            </div>
            <div className="grid grid-2" style={{ gap: "0.7rem" }}>
              <div className="field">
                <label>Kind</label>
                <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                  <option value="meeting-notes">Meeting notes</option>
                  <option value="chat-export">Chat export</option>
                  <option value="task-board">Task board</option>
                  <option value="doc">Document</option>
                </select>
              </div>
              <div className="field">
                <label>Access level</label>
                <select value={form.accessLevel} onChange={(e) => setForm({ ...form, accessLevel: e.target.value })}>
                  <option value="public">Public</option>
                  <option value="internal">Internal</option>
                  <option value="restricted">Restricted</option>
                </select>
              </div>
            </div>
            <div className="field">
              <label>Author</label>
              <input value={form.author} onChange={(e) => setForm({ ...form, author: e.target.value })} placeholder="who wrote this" maxLength={120} />
            </div>
            <div className="field">
              <label>Content (max 200k–1 MB text, deployment-dependent)</label>
              <textarea value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} placeholder="Paste meeting notes, a chat export or a task board…" required />
            </div>
            <div className="field">
              <label className="checkbox">
                <input type="checkbox" checked={form.confirmedPermission} onChange={(e) => setForm({ ...form, confirmedPermission: e.target.checked })} />
                <span>I confirm I am authorised to import this source and its access level is correct.</span>
              </label>
            </div>
            <button disabled={busy === "import"}>{busy === "import" ? "Importing…" : "Import source"}</button>
          </form>
        </div>
        <div>
          <h2 style={{ marginTop: 0 }}>Audit log</h2>
          <div className="panel" style={{ maxHeight: 420, overflowY: "auto" }}>
            {state.audit.length === 0 ? <span className="muted">No actions yet.</span> : (
              <div className="timeline">
                {[...state.audit].reverse().map((a) => (
                  <div className="timeline-item" key={a.id}>
                    <div className="when">{new Date(a.at).toLocaleString()} · {a.actor}</div>
                    <div><span className="mono" style={{ color: "var(--accent)" }}>{a.action}</span> — {a.detail}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      )}
    </>
  );
}
