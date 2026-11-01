"use client";

import { useCallback, useEffect, useState } from "react";
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
  isLead?: boolean;
  viewNote?: string;
}

export default function Dashboard() {
  const [state, setState] = useState<State | null>(null);
  const [form, setForm] = useState({ name: "", kind: "meeting-notes", accessLevel: "internal", author: "", content: "", confirmedPermission: false });
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err" | "warn"; text: string } | null>(null);

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

  async function runExtract() {
    if (state && state.pendingUnreviewed > 0) {
      if (!confirm("Re-running extraction replaces all claims and clears review decisions on them. Continue?")) return;
    }
    setBusy("extract");
    setMsg(null);
    const { ok, data } = await api<any>("/api/extract", { method: "POST" });
    setBusy(null);
    if (!ok) return setMsg({ kind: "err", text: data.error ?? "Extraction failed" });
    const modes = (data.perSource ?? []).map((p: any) => `${p.name}: ${p.extractor}`).join("; ");
    setMsg({
      kind: data.errors?.length ? "warn" : "ok",
      text: `Extracted ${data.count} claims — ${modes || "done"}. Now review them.`,
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
      {state.viewNote && <div className="notice warn">{state.viewNote}</div>}

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
            {busy === "extract" ? "Extracting…" : "Run extraction pipeline"}
          </button>
          {state.extractedAt && <span className="muted mono">last extraction: {new Date(state.extractedAt).toLocaleString()}</span>}
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
              <label>Content (max 1 MB text)</label>
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
