"use client";

import { use, useCallback, useEffect, useState } from "react";

const ROLES = [
  { key: "lead", label: "Lead" },
  { key: "successor", label: "Successor" },
  { key: "junior", label: "Junior (restricted)" },
];

export default function HandoverPage({ params }: { params: Promise<{ role: string }> }) {
  const { role } = use(params);
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    const r = await fetch(`/api/view?role=${role}`);
    const d = await r.json();
    if (!r.ok) {
      setData(null);
      setErr(d.error ?? "Failed to load");
      return;
    }
    setData(d);
  }, [role]);
  useEffect(() => { load(); }, [load]);

  return (
    <>
      <h1>Handover view</h1>
      <p className="subtitle">
        {data
          ? `${data.projectName} — published v${data.version} on ${new Date(data.publishedAt).toLocaleString()} by ${data.publishedBy}`
          : "What the incoming person sees. Only published, approved and role-permitted claims appear here."}
      </p>

      <div className="role-tabs">
        {ROLES.map((r) => (
          <a key={r.key} href={`/handover/${r.key}`} className={r.key === role ? "active" : ""}>
            {r.label}
          </a>
        ))}
      </div>

      {err && <div className="notice err">{err}</div>}

      {data && (
        <>
          {data.excludedCount > 0 && (
            <div className="excluded-banner">
              🔒 {data.excludedCount} claim(s) from restricted sources were excluded before generation — you do not have access to them, and they never entered this view.
            </div>
          )}
          {data.claims.length === 0 ? (
            <div className="panel muted">No claims visible to this role.</div>
          ) : (
            data.claims.map((c: any) => (
              <div className={`claim cl-${c.status}`} key={c.id}>
                <div className="claim-head">
                  <span className={`badge ${c.status}`}>{c.status}</span>
                  <span className="claim-type">{c.type}</span>
                  <span className="badge review">{c.reviewState}</span>
                </div>
                <div className="claim-text">{c.text}</div>
                {c.evidence.map((e: any, i: number) => (
                  <div className="quote" key={i}>
                    “{e.quote}”
                    <span className="src">↳ source: {e.sourceName}</span>
                  </div>
                ))}
                <div className="reason">{c.statusReason}</div>
              </div>
            ))
          )}
          <h2>Version history</h2>
          <div className="panel" style={{ padding: 0 }}>
            <table>
              <thead><tr><th>Version</th><th>Published</th><th>Note</th></tr></thead>
              <tbody>
                {data.versions.map((v: any) => (
                  <tr key={v.version}>
                    <td className="mono">v{v.version}</td>
                    <td className="muted">{new Date(v.publishedAt).toLocaleString()}</td>
                    <td className="muted">{v.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
