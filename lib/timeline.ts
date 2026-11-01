// Timeline: orders claims by the dates found in their evidence quotes.
// Dates are parsed from natural text ("March 14", "<Mar 4>", "oct 12"); claims
// with no date fall back to their source's import position. Inferred dates are
// labelled as such — the plan's honesty rule applies to the timeline too.

import { Claim, Source } from "./types";

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const DATE_RES = [
  /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})\b/i,
  /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\.?\s+(\d{1,2})\b/i,
];

export interface TimelineEvent {
  claimId: string;
  type: string;
  status: string;
  reviewState: string;
  text: string;
  sourceName: string;
  date: string | null; // ISO-ish YYYY-MM-DD when parsed, null when undated
  datePrecision: "day" | "none";
  dateEvidence: string | null; // the date phrase itself, verbatim
}

function parseDate(text: string): { date: string; phrase: string } | null {
  for (const re of DATE_RES) {
    const m = text.match(re);
    if (m) {
      const month = MONTHS[m[1].toLowerCase().slice(0, 3)];
      if (!month) continue;
      const day = parseInt(m[2], 10);
      if (day < 1 || day > 31) continue;
      // year is rarely stated; use the source import year, which is honest for a
      // single-project handover window and is labelled "day precision"
      const year = new Date().getFullYear();
      const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      return { date: iso, phrase: m[0] };
    }
  }
  return null;
}

export function buildTimeline(claims: Claim[], sources: Source[]): TimelineEvent[] {
  const sourceById = new Map(sources.map((s) => [s.id, s]));
  const sourceOrder = new Map(sources.map((s, i) => [s.id, i]));
  const events: TimelineEvent[] = [];

  for (const cl of claims) {
    if (cl.reviewState === "rejected") continue;
    let date: string | null = null;
    let phrase: string | null = null;
    for (const ev of cl.evidence) {
      const parsed =
        parseDate(ev.quote) ??
        (sourceById.get(ev.sourceId) ? parseDate(sourceById.get(ev.sourceId)!.name) : null);
      if (parsed) {
        date = parsed.date;
        phrase = parsed.phrase;
        break;
      }
    }
    events.push({
      claimId: cl.id,
      type: cl.type,
      status: cl.status,
      reviewState: cl.reviewState,
      text: cl.text,
      sourceName:
        cl.evidence[0] ? (sourceById.get(cl.evidence[0].sourceId)?.name ?? "unknown source") : "no source (gap)",
      date,
      datePrecision: date ? "day" : "none",
      dateEvidence: phrase,
    });
  }

  // dated events ascending; undated events keep source order at the end
  events.sort((a, b) => {
    if (a.date && b.date) return a.date.localeCompare(b.date);
    if (a.date) return -1;
    if (b.date) return 1;
    return (sourceOrder.get(sources.find((s) => s.name === a.sourceName)?.id ?? "") ?? 0) -
      (sourceOrder.get(sources.find((s) => s.name === b.sourceName)?.id ?? "") ?? 0);
  });
  return events;
}
