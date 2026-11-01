"use client";

import { useCallback, useEffect, useState } from "react";

interface Version { version: number; publishedAt: string; publishedBy: string; note: string; claimCount: number; }

export default function PublishPage() {
  const [versions, setVersions] = useState<Version[]>([]);
  const [pending, setPending] = useState(0);
  const [accepted, setAccepted] = useState(0);
  const [missing, setMissing] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: string; text: string } | null>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/state");
    const s = await r.json();
    setVersions(s.versions);
    setPending(s.byReview.pending - s.byStatus.missing);
    setAccepted(s.byReview.accepted + s.byReview.edited + s.byReview.unknown);
    setMissing(s.byStatus.missing);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function publish() {
    setBusy(true);
    setMsg(null);
    const r = await fetch("/api/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ publishedBy: "reviewer" }),
    });
    const d = await r.json();
    setBusy(false);
    if (!r.ok) return setMsg({ kind: "err", text: d.error });
    setMsg({
      kind: d.heldBackCount > 0 ? "warn" : "ok",
      text: `Published handover v${d.version} (immutable): ${d.publishedCount} reviewed claim(s) included, ${d.heldBackCount} unreviewed claim(s) held back — the human gate.`,
    });
    load();
  }

  return (
    <>
      <h1>Publish handover</h1>
      <p className="subtitle">A published version is an immutable snapshot of approved claims. The handover view always serves the latest published version — never the live draft.</p>

      <div className="panel">
        <div className="row spread">
          <div>
            <div className="mono">{accepted + missing} publishable · {pending} unreviewed (held back)</div>
            <div className="muted" style={{ fontSize: "0.85rem", marginTop: 4 }}>
              Only reviewed claims (accepted / edited / unknown) and declared gaps are published. Unreviewed claims never reach the handover — that is the human review gate.
            </div>
          </div>
          <button onClick={publish} disabled={busy}>{busy ? "Publishing…" : "Publish immutable version →"}</button>
        </div>
      </div>

      {msg && <div className={`notice ${msg.kind}`}>{msg.text}</div>}

      <h2>Version history</h2>
      {versions.length === 0 ? (
        <div className="panel muted">No versions published yet.</div>
      ) : (
        <div className="panel" style={{ padding: 0 }}>
          <table>
            <thead><tr><th>Version</th><th>Published</th><th>By</th><th>Claims</th><th>Note</th></tr></thead>
            <tbody>
              {[...versions].reverse().map((v) => (
                <tr key={v.version}>
                  <td className="mono">v{v.version}</td>
                  <td className="muted">{new Date(v.publishedAt).toLocaleString()}</td>
                  <td>{v.publishedBy}</td>
                  <td className="mono">{v.claimCount}</td>
                  <td className="muted">{v.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt">
        <a href="/handover/successor" className="btn" style={{ background: "var(--accent)", padding: "0.5rem 1rem", borderRadius: 7, display: "inline-block" }}>
          Open the incoming member's handover view →
        </a>
      </div>
    </>
  );
}
