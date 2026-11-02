"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client";
import { buildPlan, PlanAction } from "@/lib/plan";

interface Me { name: string; role: string }

function ClaimCard({ c }: { c: any }) {
  return (
    <div className={`claim cl-${c.status}`} id={`claim-${c.id}`}>
      <div className="claim-head">
        <span className={`badge ${c.status}`}>{c.status}</span>
        <span className="claim-type">{c.type}</span>
        {c.evidence?.length > 0 && c.evidence.every((e: any) => e.quoteVerified) && (
          <span className="badge verified" title="Every cited quote exists verbatim in its source">
            quote found ✓
          </span>
        )}
        <span
          className={`badge ${c.supported === "yes" ? "verified" : c.supported === "no" ? "conflicting" : "review"}`}
          title="Does the quote actually state the claim?"
        >
          support: {c.supported === "not-checked" ? "not checked" : c.supported}
        </span>
        <span className="badge review">{c.reviewState}</span>
        {(c.reviewState === "accepted" || c.reviewState === "edited") && (
          <span className="badge verified" title="A reviewer confirmed or rewrote this claim">
            confirmed by reviewer
          </span>
        )}
        {c.status === "inferred" && (
          <span className="badge" title="Not yet confirmed by a support check or reviewer">
            inferred — confirm
          </span>
        )}
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
  );
}

function StartItem({ a, n }: { a: PlanAction; n: number }) {
  return (
    <li style={{ marginBottom: "0.7rem" }}>
      <a href={`#claim-${a.claimId}`} style={{ fontWeight: 600 }}>
        {a.action}
      </a>
      {a.inferred && (
        <span className="muted" style={{ fontSize: "0.8rem", marginLeft: "0.5rem" }}>
          Inferred — confirm before relying on it
        </span>
      )}
      <span className="muted mono" style={{ fontSize: "0.75rem", marginLeft: "0.5rem" }}>
        #{n + 1}
      </span>
    </li>
  );
}

export default function HandoverPage() {
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [me, setMe] = useState<Me | null>(null);

  const load = useCallback(async (as?: string) => {
    setErr(null);
    const qs = as ? `?as=${as}` : "";
    const { ok, data: d } = await api<any>(`/api/view${qs}`);
    if (!ok) {
      setData(null);
      setErr(d.error ?? "Failed to load");
      return;
    }
    setData(d);
  }, []);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((m) => {
        setMe(m);
        load();
      });
  }, [load]);

  const isLead = me?.role === "lead";
  const plan = data?.claims ? buildPlan(data.claims) : null;

  return (
    <>
      <h1>Handover view</h1>
      <p className="subtitle">
        {data
          ? `${data.projectName} — published v${data.version} on ${new Date(data.publishedAt).toLocaleString()} by ${data.publishedBy}`
          : "What the incoming person sees. Role comes from your signed session — the URL cannot change it."}
      </p>

      {me && (
        <div className="role-tabs">
          {isLead ? (
            // Lead may PREVIEW subordinate views — the payload is still filtered
            <>
              <button className={!data?.preview ? "active-tab" : "ghost-tab"} onClick={() => load()}>
                My view (lead)
              </button>
              <button className={data?.preview && data?.role === "successor" ? "active-tab" : "ghost-tab"} onClick={() => load("successor")}>
                Preview: successor
              </button>
              <button className={data?.preview && data?.role === "junior" ? "active-tab" : "ghost-tab"} onClick={() => load("junior")}>
                Preview: junior
              </button>
            </>
          ) : (
            <span className="muted" style={{ fontSize: "0.9rem" }}>
              Signed in as <strong>{me.name}</strong> — this is your role-filtered view.
              {me.role === "successor" && " You see public + internal sources."}
              {me.role === "junior" && " You see public sources only."}
            </span>
          )}
        </div>
      )}

      {data?.preview && (
        <div className="notice warn">
          Preview mode: you are a lead viewing the <strong>{data.role}</strong> perspective. Every claim below is filtered exactly as that role would receive it.
        </div>
      )}

      {err && <div className="notice err">{err}</div>}

      {data && (
        <>
          {data.excludedCount > 0 && (
            <div className="excluded-banner">
              🔒 {data.excludedCount} of {data.publishedTotal} published claim(s) were excluded before this view was built — your role is not permitted to see them, and their content never entered this response.
            </div>
          )}

          {data.claims.length === 0 ? (
            <div className="panel muted">
              Nothing published for your role yet. Once a lead publishes a handover
              from the Publish page, your role-filtered plan will appear here.
            </div>
          ) : (
            <>
              {/* ---- Start here: day-one actions, most urgent first ---- */}
              {plan && plan.startHere.length > 0 && (
                <div className="panel" style={{ marginBottom: "1.4rem", borderColor: "var(--accent)" }}>
                  <h2 style={{ marginTop: 0 }}>🚀 Start here</h2>
                  <p className="muted" style={{ marginTop: 0 }}>
                    The first things to do with this handover, generated from the published claims
                    your role can see.
                  </p>
                  <ol style={{ paddingLeft: "1.2rem", marginBottom: 0 }}>
                    {plan.startHere.map((a, i) => (
                      <StartItem key={a.claimId} a={a} n={i} />
                    ))}
                  </ol>
                </div>
              )}

              {/* ---- Grouped sections, collapsible with counts ---- */}
              {plan?.sections.map((s) => (
                <details key={s.key} open style={{ marginBottom: "1rem" }}>
                  <summary style={{ cursor: "pointer", fontWeight: 700 }}>
                    {s.label} ({s.claims.length})
                  </summary>
                  <div style={{ marginTop: "0.8rem" }}>
                    {s.claims.map((c: any) => (
                      <ClaimCard key={c.id} c={c} />
                    ))}
                  </div>
                </details>
              ))}
            </>
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
