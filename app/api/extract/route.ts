import { NextRequest } from "next/server";
import { guard } from "@/lib/session";
import { getDB, saveDB, appendAudit } from "@/lib/store";
import {
  chunkSource,
  heuristicExtract,
  groqExtract,
  groqSupportCheck,
  dedupeByQuote,
  refineTypes,
  detectConflicts,
  assignStatuses,
  detectGaps,
  activeGroqModel,
  preserveReviews,
  selectRelevantChunks,
} from "@/lib/extract";
import { seedIfEmpty } from "@/lib/seed";
import { VALID_TYPES, ClaimType, Claim } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

const EXPECTED_TYPES: ClaimType[] = [
  "decision",
  "owner",
  "risk",
  "dependency",
  "open-question",
  "contact",
];

// LEAD ONLY — extraction is a reviewer action (review S1-1).
const handler = guard(["lead"], async () => {
  const db = seedIfEmpty(await getDB());
  if (db.sources.length === 0) {
    return Response.json({ error: "Import a source first." }, { status: 400 });
  }
  // rebuild chunks so edits to sources are picked up
  db.chunks = db.sources.flatMap((s) => chunkSource(s));

  const apiKey = process.env.GROQ_API_KEY;
  // DATA-HANDLING POLICY (review S2-7): restricted sources never leave this
  // server — extraction, the support check and conflict verdicts are all local
  // for them, so no restricted quote is ever sent to the external model.
  const restrictedIds = new Set(
    db.sources.filter((s) => s.accessLevel === "restricted").map((s) => s.id)
  );
  const citesRestricted = (cl: Claim) => cl.evidence.some((e) => restrictedIds.has(e.sourceId));
  let claims: Claim[] = [];
  const perSource: { name: string; extractor: string; count: number; note?: string }[] = [];
  const errors: string[] = [];

  // per-step progress (fixes-only #7): timestamps relative to the start, so
  // the UI can show exactly where the time went
  const t0 = Date.now();
  const steps: { label: string; detail?: string; atMs: number }[] = [];
  const step = (label: string, detail?: string) =>
    steps.push({ label, detail, atMs: Date.now() - t0 });
  step(
    "Reading sources",
    `${db.sources.length} source(s), ${db.chunks.length} chunk(s)${apiKey ? "" : " — no API key, heuristic only"}`
  );

  for (const [i, source] of db.sources.entries()) {
    const chunks = db.chunks.filter((c) => c.sourceId === source.id);
    let extracted: Claim[] = [];
    let mode = "heuristic";
    let note: string | undefined;
    let retrieved = chunks.length;
    try {
      if (apiKey && source.accessLevel !== "restricted") {
        // retrieval (PDF brief): relevance-score chunks and send only the
        // top-k to the model; the heuristic floor still scans ALL chunks
        const selected = selectRelevantChunks(chunks);
        retrieved = selected.length;
        // union: LLM claims + the deterministic pattern floor, so model
        // variance can never drop a planted fact; dedupeByQuote merges overlaps
        const groqClaims = await groqExtract(selected, source, apiKey);
        extracted = [...groqClaims, ...heuristicExtract(chunks, source)];
        mode = "groq+heuristic";
      } else {
        extracted = heuristicExtract(chunks, source);
        if (source.accessLevel === "restricted") {
          mode = "heuristic (restricted: local-only)";
          note = "Restricted source processed locally — never sent to an external model.";
        }
      }
    } catch (e: any) {
      errors.push(`${source.name}: ${e.message}`);
      extracted = heuristicExtract(chunks, source);
      mode = "heuristic (groq failed)";
      note = String(e.message).slice(0, 200);
    }
    claims.push(...extracted);
    perSource.push({ name: source.name, extractor: mode, count: extracted.length, note });
    step(
      `Extracting ${i + 1}/${db.sources.length}`,
      `${source.name} — ${mode}, ${extracted.length} claim(s)` +
        (retrieved !== chunks.length ? `, ${retrieved}/${chunks.length} chunks retrieved for the model` : "") +
        (note ? ` · ${note}` : "")
    );
    // pace Groq calls: the 8000 TPM budget is shared by every call below
    if (apiKey) await new Promise((r) => setTimeout(r, 1500));
  }

  // one claim per source sentence; contact claims about credentials -> dependency
  claims = refineTypes(dedupeByQuote(claims));

  // support check: does the quote actually say what the claim asserts?
  // chunked inside groqSupportCheck, with spacing to stay under TPM.
  // Excluded: restricted-citing claims (policy) and heuristic claims (they
  // are never auto-Verified per S1-2, so a support call would change nothing).
  const checkable = claims.filter((cl) => !citesRestricted(cl) && cl.extractedBy !== "heuristic");
  if (apiKey && checkable.length > 0) {
    step("Checking quotes", `support check for ${checkable.length} model claim(s)…`);
    await new Promise((r) => setTimeout(r, 4000));
    try {
      const verdicts = await groqSupportCheck(checkable, apiKey);
      for (const cl of checkable) {
        const v = verdicts.get(cl.id);
        cl.supported = v?.verdict ?? "not-checked";
        if (v?.reason) cl.supportReason = v.reason;
      }
      step("Quotes checked", `${checkable.length} verdict(s) returned`);
    } catch (e: any) {
      for (const cl of checkable) cl.supported = "not-checked";
      errors.push(`support check unavailable: ${String(e.message).slice(0, 120)}`);
      step("Quotes checked", `unavailable (${String(e.message).slice(0, 80)}) — claims stay Inferred`);
    }
  } else {
    step("Checking quotes", "skipped (heuristic claims or no API key)");
  }

  // conflict detection: LLM-verified candidate pairs (heuristic fallback without a key).
  // pause first: the support-check batch just consumed rate limit
  step("Detecting conflicts", "candidate pairs…");
  if (apiKey && claims.length > 0) await new Promise((r) => setTimeout(r, 4000));
  await detectConflicts(claims, apiKey, restrictedIds);
  claims = assignStatuses(claims);
  claims.push(...detectGaps(claims, EXPECTED_TYPES));
  step("Statuses and gaps assigned", `${claims.length} claim(s) total`);

  // only accept the six declared claim types (review S2-7)
  claims = claims.filter((c) => VALID_TYPES.includes(c.type));

  // carry review decisions across re-extraction (fixes-only #8): matched
  // claims keep their state, history is re-pointed, gone claims are counted
  const prevClaims = db.claims;
  const preservation = preserveReviews(claims, prevClaims, db.reviews);

  db.claims = claims;
  db.extractedAt = new Date().toISOString();
  appendAudit(
    db,
    "system",
    "extract",
    `Extracted ${claims.length} claims [${perSource.map((p) => `${p.name}: ${p.extractor}`).join("; ")}] — ${preservation.kept} review(s) kept, ${preservation.newToReview} new to review, ${preservation.noLongerFound} reviewed claim(s) no longer found`
  );
  await saveDB(db);

  const durationMs = Date.now() - t0;
  step("Done", `${claims.length} claim(s) in ${(durationMs / 1000).toFixed(1)}s`);
  // honest "extracted with" summary (fixes-only #7)
  const usedGroq = perSource.some((p) => p.extractor.startsWith("groq"));
  const extractorSummary = usedGroq
    ? `${activeGroqModel()} + heuristic pattern floor`
    : apiKey
      ? "heuristic only (model returned no usable output)"
      : "heuristic only (no API key set)";
  return Response.json({
    count: claims.length,
    perSource,
    errors,
    steps,
    durationMs,
    extractorSummary,
    reviewsKept: preservation.kept,
    newToReview: preservation.newToReview,
    noLongerFound: preservation.noLongerFound,
  });
});

export async function POST(_req: NextRequest) {
  return handler(_req);
}
