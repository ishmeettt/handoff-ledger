"use client";

import { useCallback, useEffect, useState } from "react";

interface Src {
  id: string; name: string; kind: string; accessLevel: string;
  author: string; importedAt: string; chunks: number;
}
interface State {
  projectName: string; extractedAt: string | null; sources: Src[];
  byStatus: Record<string, number>; byReview: Record<string, number>;
  citationValidity: { valid: number; total: number };
  audit: { id: string; at: string; actor: string; action: string; detail: string }[];
}

export default function Dashboard() {
  const [state, setState] = useState<State | null>(null);
  const [form, setForm] = useState({ name: "", kind: "meeting-notes", accessLevel: "internal", author: "", content: "", confirmedPermission: false });
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err" | "warn"; text: string } | null>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/state");
    setState(await r.json());
  }, []);
  useEffect(() => { load(); }, [load]);

  async function importSource(e: React.FormEvent) {
    e.preventDefault();
    setBusy("import");
    setMsg(null);
    const r = await fetch("/api/sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await r.json();
    setBusy(null);
    if (!r.ok) return setMsg({ kind: "err", text: data.error ?? "Import failed" });
    setMsg({ kind: "ok", text: `Imported with ${data.chunks} chunks. Run extraction to turn it into claims.` });
    setForm({ ...form, name: "", content: "", confirmedPermission: false });
    load();
  }

  async function runExtract() {
    if (state && state.byReview && Object.values(state.byReview).reduce((a, b) => a + b, 0) > state.byReview.pending) {
      if (!confirm("Re-running extraction replaces all claims and clears review decisions on them. Continue?")) return;
    }
    setBusy("extract");
    setMsg(null);
    const r = await fetch("/api/extract", { method: "POST" });
    const data = await r.json();
    setBusy(null);
    if (!r.ok) return setMsg({ kind: "err", text: data.error ?? "Extraction failed" });
    setMsg({
      kind: data.mode === "groq" ? "ok" : "warn",
      text: `Extracted ${data.count} claims via ${data.mode === "groq" ? "Groq LLM" : "deterministic heuristic (no GROQ_API_KEY set)"}${data.errors?.length ? ` — fallbacks: ${data.errors.join("; ")}` : ""}. Now review them.`,
    });
    load();
  }

  if (!state) return <p className="muted">Loading…</p>;
  const total = state.byStatus.verified + state.byStatus.inferred + state.byStatus.conflicting + state.byStatus.missing;

  return (
    <>
      <h1>{state.projectName}</h1>
      <p className="subtitle">
        Every statement is a claim backed by a verbatim quote and a source. Uncertainty is shown, never hidden.
      </p>

      <div className="grid grid-stats">
        <div className="stat"><div className="num">{total}</div><div className="lbl">Claims</div></div>
        <div className="stat verified"><div className="num">{state.byStatus.verified}</div><div className="lbl">Verified</div></div>
        <div className="stat inferred"><div className="num">{state.byStatus.inferred}</div><div className="lbl">Inferred</div></div>
        <div className="stat conflicting"><div className="num">{state.byStatus.conflicting}</div><div className="lbl">Conflicting</div></div>
        <div className="stat missing"><div className="num">{state.byStatus.missing}</div><div className="lbl">Missing</div></div>
        <div className="stat"><div className="num">{state.byReview.pending}</div><div className="lbl">Awaiting review</div></div>
        <div className="stat">
          <div className="num" style={{ color: state.citationValidity.total > 0 && state.citationValidity.valid === state.citationValidity.total ? "var(--verified)" : "var(--inferred)" }}>
            {state.citationValidity.total > 0 ? Math.round((state.citationValidity.valid / state.citationValidity.total) * 100) + "%" : "—"}
          </div>
          <div className="lbl">Citation validity</div>
        </div>
      </div>

      {msg && <div className={`notice ${msg.kind}`}>{msg.text}</div>}

      <h2>Sources ({state.sources.length})</h2>
      {state.sources.length === 0 ? (
        <div className="panel muted">No sources yet. Import one below — the seeded demo sources appear after the first extraction run, or import your own.</div>
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
      <div className="row mt">
        <button onClick={runExtract} disabled={busy !== null || state.sources.length === 0}>
          {busy === "extract" ? "Extracting…" : "Run extraction pipeline"}
        </button>
        {state.extractedAt && <span className="muted mono">last extraction: {new Date(state.extractedAt).toLocaleString()}</span>}
      </div>

      <div className="grid grid-2 mt">
        <div>
          <h2 style={{ marginTop: 0 }}>Import a source</h2>
          <form className="panel" onSubmit={importSource}>
            <div className="field">
              <label>Name</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Standup notes — April" required />
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
              <input value={form.author} onChange={(e) => setForm({ ...form, author: e.target.value })} placeholder="who wrote this" />
            </div>
            <div className="field">
              <label>Content</label>
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
    </>
  );
}
