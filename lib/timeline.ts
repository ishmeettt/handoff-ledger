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
  /** date is after the source's referenceDate (a forward-looking item) */
  upcoming: boolean;
  dateEvidence: string | null; // the date phrase itself, verbatim
}

// Words that make a date forward-looking: "token expires Apr 30" means the
// NEXT occurrence of Apr 30, not the last one (fixes-only #2).
const FUTURE =
  /\b(expires?|expiry|due|deadline|renew\w*|by|until|before|next|scheduled|will)\b/i;

/**
 * Year for a month/day:
 * - forward-looking sentence ("expires Apr 30"): the upcoming occurrence
 *   (this year if it is still ahead of the reference, else next year);
 * - otherwise: the most recent occurrence on or before the reference date.
 */
function inferYear(month: number, day: number, reference: Date, sentence: string): number {
  const y = reference.getFullYear();
  const sameYear = new Date(y, month - 1, day);
  if (FUTURE.test(sentence)) return sameYear >= reference ? y : y + 1;
  return sameYear <= reference ? y : y - 1;
}

function parseDate(
  text: string,
  reference: Date,
  sentence: string
): { date: string; phrase: string; yearInferred: boolean } | null {
  for (const re of DATE_RES) {
    const m = text.match(re);
    if (!m) continue;
    const month = MONTHS[m[1].toLowerCase().slice(0, 3)];
    if (!month) continue;
    const day = parseInt(m[2], 10);
    if (day < 1 || day > 31) continue;
    // explicit year ONLY immediately after the matched phrase ("Apr 30, 2026")
    // — an unrelated year elsewhere in the sentence must not override it
    const after = text.slice((m.index ?? 0) + m[0].length);
    const yearMatch = after.match(/^[\s,]*(19\d{2}|20\d{2})\b/);
    const explicit = yearMatch ? parseInt(yearMatch[1], 10) : null;
    const year = explicit ?? inferYear(month, day, reference, sentence);
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
    // gaps assert nothing and rejected claims are out — neither belongs on a
    // timeline of things that happened (fixes-only #2)
    if (cl.status === "missing" || cl.reviewState === "rejected" || seen.has(cl.id)) continue;
    seen.add(cl.id);
    let date: string | null = null;
    let phrase: string | null = null;
    let yearInferred = false;
    let refMs = Date.now();
    for (const ev of cl.evidence) {
      const src = sourceById.get(ev.sourceId);
      const ref = new Date(src?.referenceDate ?? src?.importedAt ?? Date.now());
      refMs = ref.getTime();
      // year words ("expires", "due") can sit outside the quote — pass the
      // full claim sentence as context
      const sentence = `${cl.text} ${ev.quote}`;
      const parsed =
        parseDate(ev.quote, ref, sentence) ?? (src ? parseDate(src.name, ref, sentence) : null);
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
      upcoming: !!date && new Date(`${date}T00:00:00Z`).getTime() > refMs,
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
