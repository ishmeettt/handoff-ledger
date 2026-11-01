// Timeline: orders claims by dates found in their evidence quotes.
// Year inference (review S2-3): the year is the most recent occurrence of that
// month-day ON OR BEFORE the source's referenceDate (when the notes were
// written), and is labelled "year inferred" — never silently guessed.
// Undated claims go to a visible "No date in source" lane in source order.

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
  date: string | null; // YYYY-MM-DD when parsed, null when undated
  yearInferred: boolean;
  dateEvidence: string | null; // the date phrase itself, verbatim
}

/** Most recent occurrence of month/day at or before the reference date. */
function inferYear(month: number, day: number, reference: Date): number {
  const refYear = reference.getFullYear();
  const candidate = (y: number) => new Date(y, month - 1, day);
  // prefer the latest occurrence ≤ reference; if the date this year is still
  // in the future relative to the reference, use last year's
  return candidate(refYear) <= reference ? refYear : refYear - 1;
}

function parseDate(
  text: string,
  reference: Date
): { date: string; phrase: string; yearInferred: boolean } | null {
  for (const re of DATE_RES) {
    const m = text.match(re);
    if (!m) continue;
    const month = MONTHS[m[1].toLowerCase().slice(0, 3)];
    if (!month) continue;
    const day = parseInt(m[2], 10);
    if (day < 1 || day > 31) continue;
    // explicit 4-digit year in the phrase? use it as-is
    const yearMatch = text.match(new RegExp(`\\b(19\\d{2}|20\\d{2})\\b`));
    const explicit = yearMatch ? parseInt(yearMatch[1], 10) : null;
    const year = explicit ?? inferYear(month, day, reference);
    const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return { date: iso, phrase: m[0], yearInferred: explicit === null };
  }
  return null;
}

export function buildTimeline(claims: Claim[], sources: Source[]): TimelineEvent[] {
  const sourceById = new Map(sources.map((s) => [s.id, s]));
  const sourceOrder = new Map(sources.map((s, i) => [s.id, i]));
  const events: TimelineEvent[] = [];
  const seen = new Set<string>(); // dedupe by claim id (review S2-2)

  for (const cl of claims) {
    if (cl.reviewState === "rejected" || seen.has(cl.id)) continue;
    seen.add(cl.id);
    let date: string | null = null;
    let phrase: string | null = null;
    let yearInferred = false;
    for (const ev of cl.evidence) {
      const src = sourceById.get(ev.sourceId);
      const ref = new Date(src?.referenceDate ?? src?.importedAt ?? Date.now());
      const parsed = parseDate(ev.quote, ref) ?? (src ? parseDate(src.name, ref) : null);
      if (parsed) {
        date = parsed.date;
        phrase = parsed.phrase;
        yearInferred = parsed.yearInferred;
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
      yearInferred,
      dateEvidence: phrase,
    });
  }

  events.sort((a, b) => {
    if (a.date && b.date) return a.date.localeCompare(b.date);
    if (a.date) return -1;
    if (b.date) return 1;
    return (
      (sourceOrder.get(sources.find((s) => s.name === a.sourceName)?.id ?? "") ?? 0) -
      (sourceOrder.get(sources.find((s) => s.name === b.sourceName)?.id ?? "") ?? 0)
    );
  });
  return events;
}
