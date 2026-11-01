"use client";

import { useEffect, useState } from "react";

interface Ev {
  claimId: string; type: string; status: string; reviewState: string;
  text: string; sourceName: string; date: string | null;
  datePrecision: "day" | "none"; dateEvidence: string | null;
}

const TYPE_ICON: Record<string, string> = {
  decision: "⚖️", owner: "👤", risk: "⚠️", dependency: "🔗",
  "open-question": "❓", contact: "📞",
};

export default function TimelinePage() {
  const [events, setEvents] = useState<Ev[] | null>(null);
  const [onlyKey, setOnlyKey] = useState(false);

  useEffect(() => {
    fetch("/api/timeline").then((r) => r.json()).then((d) => setEvents(d.events ?? []));
  }, []);

  if (!events) return <p className="muted">Loading…</p>;
  if (events.length === 0)
    return (
      <>
        <h1>Timeline</h1>
        <div className="panel muted mt">No claims yet — run the extraction pipeline from the dashboard first.</div>
      </>
    );

  const KEY_TYPES = new Set(["decision", "risk", "open-question", "dependency"]);
  const shown = onlyKey ? events.filter((e) => KEY_TYPES.has(e.type)) : events;

  // group by date, undated last
  const groups: { label: string; date: string | null; items: Ev[] }[] = [];
  for (const e of shown) {
    const key = e.date ?? "__undated";
    const g = groups.find((x) => (x.date ?? "__undated") === key);
    if (g) g.items.push(e);
    else groups.push({ label: e.date ? new Date(e.date + "T00:00:00").toLocaleDateString(undefined, { month: "long", day: "numeric" }) : "Undated (source order)", date: e.date, items: [e] });
  }

  return (
    <>
      <h1>Timeline</h1>
      <p className="subtitle">
        Key decisions, risks and unresolved discussions in order. Dates are parsed verbatim from the
        sources and shown with the phrase they came from — undated claims are honestly labelled, never guessed.
      </p>

      <div className="row" style={{ marginBottom: "1.4rem" }}>
        <button className={onlyKey ? "ghost" : ""} onClick={() => setOnlyKey(false)}>All events ({events.length})</button>
        <button className={onlyKey ? "" : "ghost"} onClick={() => setOnlyKey(true)}>Key events only ({events.filter((e) => KEY_TYPES.has(e.type)).length})</button>
      </div>

      {groups.map((g, gi) => (
        <div key={gi} style={{ marginBottom: "1.6rem" }}>
          <div className="mono" style={{ color: "var(--accent)", fontWeight: 700, marginBottom: "0.6rem" }}>
            {g.label}
            {g.date && <span className="muted" style={{ fontWeight: 400 }}> · parsed from source text</span>}
          </div>
          <div className="timeline">
            {g.items.map((e) => (
              <div className={`timeline-item claim cl-${e.status}`} key={e.claimId} style={{ marginBottom: "0.8rem" }}>
                <div className="claim-head">
                  <span>{TYPE_ICON[e.type] ?? "•"}</span>
                  <span className={`badge ${e.status}`}>{e.status}</span>
                  <span className="claim-type">{e.type}</span>
                  <span className="badge review">{e.reviewState}</span>
                  <span className="muted" style={{ fontSize: "0.8rem" }}>↳ {e.sourceName}</span>
                </div>
                <div className="claim-text" style={{ marginBottom: 0 }}>{e.text}</div>
                {e.dateEvidence && <div className="reason">date evidence: “{e.dateEvidence}”</div>}
              </div>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}
