"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client";

interface Version { version: number; publishedAt: string; publishedBy: string; note: string; claimCount: number; }
interface State {
  versions: Version[];
  pendingUnreviewed: number;
  byReview: Record<string, number>;
  byStatus: Record<string, number>;
}

export default function PublishPage() {
  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: string; text: string } | null>(null);

  const load = useCallback(async () => {
    const { data } = await api<State>("/api/state");
    setState(data);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function publish() {
    setBusy(true);
    setMsg(null);
    const { ok, data: d } = await api<any>("/api/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    setBusy(false);
    if (!ok) return setMsg({ kind: "err", text: d.error });
    const extras: string[] = [];
    if (d.unresolvedConflicts > 0) extras.push(`${d.unresolvedConflicts} unresolved conflict(s) published`);
    if (d.unconfirmed > 0) extras.push(`${d.unconfirmed} unconfirmed inference(s) published`);
    setMsg({
      kind: d.heldBackCount > 0 || d.unresolvedConflicts > 0 ? "warn" : "ok",
      text:
        `Published handover v${d.version} (immutable): ${d.publishedCount} reviewed claim(s) included, ` +
        `${d.heldBackCount} unreviewed claim(s) held back.` +
        (extras.length ? ` Warning: ${extras.join(", ")}.` : ""),
    });
    load();
  }

  if (!state) return <p className="muted">Loading…</p>;

  const publishable = state.byReview.accepted + state.byReview.edited + state.byReview.unknown + state.byStatus.missing;
  const unresolvedConflicts = state.byStatus.conflicting;

  return (
    <>
      <h1>Publish handover</h1>
      <p className="subtitle">
        A published version is an immutable snapshot of approved claims. The handover view always
        serves the latest published version — never the live draft.
      </p>

      <div className="panel">
        <div className="row spread">
          <div>
            <div className="mono">
              {publishable} publishable · {state.pendingUnreviewed} unreviewed (held back)
            </div>
            <div className="muted" style={{ fontSize: "0.85rem", marginTop: 4 }}>
              Reviewed claims (accepted / edited / unknown) and declared gaps publish. Unreviewed
              claims never reach the handover — that is the human review gate.
            </div>
          </div>
          <button onClick={publish} disabled={busy}>{busy ? "Publishing…" : "Publish immutable version →"}</button>
        </div>

        {/* publish checklist (review S2-8) */}
        {(unresolvedConflicts > 0 || state.byStatus.missing > 0) && (
          <div className="notice warn" style={{ marginBottom: 0 }}>
            Checklist before publishing:{" "}
            {unresolvedConflicts > 0 && (
              <span>⚠ {unresolvedConflicts} conflict(s) still unresolved — accept one side and reject the other.{" "}</span>
            )}
            {state.byStatus.missing > 0 && (
              <span>ℹ {state.byStatus.missing} declared gap(s) publish as-is (they assert nothing).</span>
            )}
          </div>
        )}
      </div>

      {msg && <div className={`notice ${msg.kind}`}>{msg.text}</div>}

      <h2>Version history</h2>
      {state.versions.length === 0 ? (
        <div className="panel muted">No versions published yet.</div>
      ) : (
        <div className="panel" style={{ padding: 0 }}>
          <table>
            <thead><tr><th>Version</th><th>Published</th><th>By</th><th>Claims</th><th>Note</th></tr></thead>
            <tbody>
              {[...state.versions].reverse().map((v) => (
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
        <a href="/handover" className="btn" style={{ background: "var(--accent)", padding: "0.5rem 1rem", borderRadius: 7, display: "inline-block" }}>
          Open the incoming member's handover view →
        </a>
      </div>
    </>
  );
}
