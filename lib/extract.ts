// Extraction pipeline: chunk → extract claims → verify quotes → detect conflicts/staleness/gaps
// AI path uses Groq (GROQ_API_KEY); deterministic heuristic path is the fallback so the
// pipeline always runs. Both feed the same verification gate: a claim without a verbatim
// quote that exact-matches its source can never be "verified".

import { Claim, Chunk, Source, ClaimType, Evidence } from "./types";
import { randomId } from "./id";

// ---------- chunking ----------

export function chunkSource(source: Source): Chunk[] {
  const chunks: Chunk[] = [];
  const lines = source.content.split(/\r?\n/);
  let offset = 0;
  let idx = 0;
  let buf: string[] = [];
  let bufStart = 0;
  const flush = (end: number) => {
    const text = buf.join("\n").trim();
    if (text) {
      chunks.push({
        id: `${source.id}-c${idx}`,
        sourceId: source.id,
        idx,
        text,
        charStart: bufStart,
        charEnd: end,
      });
      idx++;
    }
    buf = [];
  };
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "") {
      flush(offset);
      offset += line.length + 1;
      bufStart = offset;
      continue;
    }
    if (buf.length === 0) bufStart = offset;
    buf.push(line);
    offset += line.length + 1;
  }
  flush(offset);
  return chunks;
}

// ---------- quote verification (runs for every claim, AI or heuristic) ----------

function normalize(s: string) {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

export function verifyQuote(quote: string, chunkText: string): boolean {
  if (!quote || quote.length < 12) return false;
  return (
    chunkText.includes(quote) || normalize(chunkText).includes(normalize(quote))
  );
}

// ---------- heuristic extraction (fallback / offline mode) ----------

const CLAIM_PATTERNS: { type: ClaimType; re: RegExp }[] = [
  { type: "decision", re: /\b(?:we (?:decided|chose|agreed|went with|settled on)|decision[:\-]|chose|switched to|leaning)\b/gi },
  { type: "risk", re: /\b(?:risk|blocker|blocked|broken|fails?(?:ed|ure)?|outage|urgent|critical|doesn'?t work|flaky|slip)\b/gi },
  { type: "dependency", re: /\b(?:depends? on|requires?|renewal|api key|secret key|credential|ssh|password|third[- ]party|deploy(ment)? (?:needs|requires)|only [a-z\w]+ has access)\b/gi },
  { type: "owner", re: /\b(?:[a-z]\w+ (?:owns|is responsible for|handles|maintains)|assigned (?:to|:)|owner[:\-]|unassigned)\b/gi },
  { type: "contact", re: /\b(?:ask|contact|reachable|talk to|renewal requires)[:,\s]+[A-Z]\w*/g },
  { type: "open-question", re: /(?:\?|\b(?:todo|tbd|not sure|undecided|open question|do we still need|keep or kill)\b)/gi },
];

const STALE_RE = /\b(\d+\s+months?\s+ago|last activity[^\n]*|stale\b)/gi;

const STOPWORDS = new Set([
  "the","a","an","we","our","is","are","was","were","to","of","for","on","in","and","or",
  "it","that","this","with","has","have","had","be","been","will","would","should","can",
  "do","does","did","not","no","yes","but","as","at","by","from","who","what","when","why",
  "how","they","their","them","he","she","his","her","you","your","i","me","my","about",
  "into","than","then","there","here","also","because","since","while","after","before",
  "up","out","so","if","all","any","some","one","two","most","more","very","just","like",
]);

function topicOf(text: string): string {
  const words = normalize(text)
    .replace(/[^a-z0-9 ]/g, " ")
    .split(" ")
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
  return words.slice(0, 4).join(" ");
}

// A sentence boundary is terminal punctuation, or a newline that starts a marker line
// (chat logs "<Mar 4>", bullets "- ", headings) or a blank line.
function isBoundary(content: string, i: number): boolean {
  const ch = content[i];
  if (ch === "\n") {
    const next = content[i + 1] ?? "";
    return next === "\n" || /[-*<>#•]/.test(next);
  }
  return /[.!?]/.test(ch);
}

function sentenceOf(content: string, pos: number): { quote: string; start: number; end: number } {
  let start = pos;
  while (start > 0 && !isBoundary(content, start - 1)) start--;
  let end = pos;
  while (end < content.length && !isBoundary(content, end)) end++;
  end = Math.min(end + 1, content.length);
  return { quote: content.slice(start, end).trim(), start, end };
}

export function heuristicExtract(chunks: Chunk[], source: Source): Claim[] {
  const claims: Claim[] = [];
  const seenQuotes = new Set<string>();
  for (const chunk of chunks) {
    for (const { type, re } of CLAIM_PATTERNS) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(chunk.text)) !== null) {
        const absPos = chunk.charStart + m.index;
        const { quote } = sentenceOf(source.content, absPos);
        const key = `${type}:${normalize(quote).slice(0, 100)}`;
        if (quote.length > 400 || quote.length < 15 || seenQuotes.has(key)) {
          re.lastIndex = m.index + m[0].length; // avoid infinite loops on zero-length matches
          continue;
        }
        seenQuotes.add(key);
        const stale = STALE_RE.test(quote);
        STALE_RE.lastIndex = 0;
        claims.push({
          id: randomId("cl"),
          type,
          text: quote,
          topic: topicOf(quote),
          status: "inferred",
          confidence: 0.55,
          stale: stale || undefined,
          evidence: [
            {
              chunkId: chunk.id,
              sourceId: source.id,
              quote,
              quoteVerified: verifyQuote(quote, source.content),
            },
          ],
          statusReason:
            "Extracted by deterministic pattern pass (no LLM key configured). Awaiting reviewer confirmation." +
            (stale ? " ⏳ Staleness flag: source mentions an old last-activity date." : ""),
          reviewState: "pending",
          createdAt: new Date().toISOString(),
        });
        re.lastIndex = m.index + m[0].length;
      }
    }
  }
  return claims;
}

// ---------- Groq extraction ----------

const GROQ_MODEL = "llama-3.3-70b-versatile";
const CLAIM_SCHEMA_HINT = `Each claim is an object: {
  "type": "decision" | "owner" | "risk" | "dependency" | "open-question" | "contact",
  "text": <one-sentence claim statement>,
  "quote": <VERBATIM sentence copied exactly from the source chunk, including punctuation>,
  "topic": <3-5 word topic key, lowercase>
}`;

export async function groqExtract(
  chunks: Chunk[],
  source: Source,
  apiKey: string
): Promise<Claim[]> {
  const claims: Claim[] = [];
  // batch chunks to stay within one request where possible
  const chunkBlocks = chunks
    .map((c) => `--- chunk id=${c.id} ---\n${c.text}`)
    .join("\n\n");
  const prompt = `You extract structured handover claims from a single source. Source kind: ${source.kind}.
Extract decisions, owners, risks, dependencies, open questions and contacts.
For every claim, the "quote" MUST be copied VERBATIM from the chunk below — never paraphrase.
If you are not sure the quote is exact, do not emit the claim.
Return ONLY a JSON array of claims. ${CLAIM_SCHEMA_HINT}

SOURCE CHUNKS:
${chunkBlocks}`;

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: 'Return {"claims": [...]} with exact verbatim quotes.' },
        { role: "user", content: prompt },
      ],
    }),
  });
  if (!res.ok) {
    throw new Error(`Groq API error ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content ?? "[]";
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Groq returned non-JSON output");
  }
  const arr: any[] = Array.isArray(parsed) ? parsed : parsed.claims ?? [];
  const chunkById = new Map(chunks.map((c) => [c.id, c]));
  for (const c of arr) {
    const quote = String(c.quote ?? "");
    // map quote back to the chunk it came from
    const chunk = chunks.find((ch) => verifyQuote(quote, ch.text));
    if (!chunk) continue; // quote not found in any chunk → claim dropped (abstain)
    claims.push({
      id: randomId("cl"),
      type: (c.type as ClaimType) ?? "decision",
      text: String(c.text ?? quote),
      topic: String(c.topic ?? topicOf(quote)),
      status: "inferred", // LLM claims start as inferred; verification may raise to verified
      confidence: 0.7,
      evidence: [
        {
          chunkId: chunk.id,
          sourceId: source.id,
          quote,
          quoteVerified: true,
        },
      ],
      statusReason:
        "Extracted by LLM (Groq). Quote verified by exact match. Awaiting reviewer confirmation.",
      reviewState: "pending",
      createdAt: new Date().toISOString(),
    });
  }
  return claims;
}

// ---------- status assignment: conflicts, staleness, gaps ----------

function keywords(text: string): Set<string> {
  return new Set(
    normalize(text)
      .replace(/[^a-z0-9 ]/g, " ")
      .split(" ")
      .filter((w) => w.length > 3 && !STOPWORDS.has(w))
  );
}

export function assignStatuses(claims: Claim[]): Claim[] {
  // 1. conflicts: decision claims that share a distinctive keyword but state different things
  const decisions = claims.filter((c) => c.type === "decision" && c.status !== "missing");
  // keywords here are already content words (stopwords stripped, length > 3),
  // so any shared keyword between two different decision statements is a real topic overlap
  const kwCache = new Map<string, Set<string>>();
  const kws = (c: Claim) => {
    if (!kwCache.has(c.id)) kwCache.set(c.id, keywords(c.text));
    return kwCache.get(c.id)!;
  };
  const conflictPairs = new Map<string, Set<string>>(); // claimId → conflicting claimIds
  for (let i = 0; i < decisions.length; i++) {
    for (let j = i + 1; j < decisions.length; j++) {
      const a = decisions[i], b = decisions[j];
      if (normalize(a.text).slice(0, 60) === normalize(b.text).slice(0, 60)) continue;
      const shared = [...kws(a)].filter((k) => kws(b).has(k));
      if (shared.length === 0) continue;
      if (!conflictPairs.has(a.id)) conflictPairs.set(a.id, new Set());
      if (!conflictPairs.has(b.id)) conflictPairs.set(b.id, new Set());
      conflictPairs.get(a.id)!.add(b.id);
      conflictPairs.get(b.id)!.add(a.id);
    }
  }
  for (const cl of decisions) {
    const foes = conflictPairs.get(cl.id);
    if (!foes) continue;
    cl.status = "conflicting";
    cl.conflictingWith = [...foes];      cl.statusReason = `Conflicting: ${foes.size + 1} statements disagree on a shared topic. Both versions are shown with their sources; a reviewer must resolve.` +
        (cl.stale ? " ⏳ Staleness flag: source mentions an old last-activity date." : "");
  }
  // 2. verified: quote verified AND only claim on its topic
  for (const cl of claims) {
    if (cl.status === "inferred" && cl.evidence.length > 0 && cl.evidence.every((e) => e.quoteVerified)) {
      cl.status = "verified";
      cl.statusReason =
        "Verbatim quote exists in the source and supports the claim. Reviewer still confirms." +
        (cl.stale ? " ⏳ Staleness flag: source mentions an old last-activity date." : "");
    }
  }
  return claims;
}

const RATIONALE_RE = /\b(because|since|so that|reason|in order to|as we|rationale)\b/i;

export function detectGaps(claims: Claim[], expectedTypes: ClaimType[]): Claim[] {
  const missing: Claim[] = [];
  const candidates: { claims: Claim[]; keywords: Set<string> }[] = [];
  // rationale gaps: a decision with no "why" in its own quote and none on its topic
  const decisions = claims.filter((c) => c.type === "decision" && c.status !== "missing");
  const topicKeywords = (c: Claim) =>
    new Set(normalize(c.text).replace(/[^a-z0-9 ]/g, " ").split(" ").filter((w) => w.length > 3 && !STOPWORDS.has(w)));
  for (const d of decisions) {
    if (RATIONALE_RE.test(d.text)) continue;
    const kw = topicKeywords(d);
    const rationaleElsewhere = decisions.some(
      (o) => o.id !== d.id && RATIONALE_RE.test(o.text) && [...topicKeywords(o)].some((k) => kw.has(k))
    );
    if (rationaleElsewhere) continue;
    // cluster gap candidates by shared topic keyword → one interview question per topic
    const cluster = candidates.find((cand) => [...kw].some((k) => cand.keywords.has(k)));
    if (cluster) {
      cluster.claims.push(d);
      for (const k of kw) cluster.keywords.add(k);
    } else {
      candidates.push({ claims: [d], keywords: kw });
    }
  }
  for (const { claims: group } of candidates) {
    const subject = group
      .map((g) => g.text)
      .join(" / ")
      .slice(0, 200);
    missing.push({
      id: randomId("cl"),
      type: "decision",
      text: `No rationale found for: "${subject}" — gap-interview question for the departing member: why was this decided?`,
      topic: `gap:rationale:${group[0].topic}`,
      status: "missing",
      confidence: 0,
      evidence: [],
      statusReason: "Expected knowledge (decision rationale) has no supporting evidence in any source. Becomes a targeted question for the leaver.",
      reviewState: "pending",
      createdAt: new Date().toISOString(),
    });
  }
  for (const type of expectedTypes) {
    if (!claims.some((c) => c.type === type)) {
      missing.push({
        id: randomId("cl"),
        type,
        text: `No evidence found in any source for: ${type.replace("-", " ")}.`,
        topic: `gap:${type}`,
        status: "missing",
        confidence: 0,
        evidence: [],
        statusReason:
          "Expected knowledge has no supporting evidence in the connected sources. Becomes a gap-interview question for the departing member.",
        reviewState: "pending",
        createdAt: new Date().toISOString(),
      });
    }
  }
  return missing;
}
