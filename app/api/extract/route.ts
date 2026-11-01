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
  const db = seedIfEmpty(getDB());
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

  for (const source of db.sources) {
    const chunks = db.chunks.filter((c) => c.sourceId === source.id);
    let extracted: Claim[] = [];
    let mode = "heuristic";
    let note: string | undefined;
    try {
      if (apiKey && source.accessLevel !== "restricted") {
        // union: LLM claims + the deterministic pattern floor, so model
        // variance can never drop a planted fact; dedupeByQuote merges overlaps
        const groqClaims = await groqExtract(chunks, source, apiKey);
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
    await new Promise((r) => setTimeout(r, 4000));
    try {
      const verdicts = await groqSupportCheck(checkable, apiKey);
      for (const cl of checkable) {
        const v = verdicts.get(cl.id);
        cl.supported = v?.verdict ?? "not-checked";
        if (v?.reason) cl.supportReason = v.reason;
      }
    } catch (e: any) {
      for (const cl of checkable) cl.supported = "not-checked";
      errors.push(`support check unavailable: ${String(e.message).slice(0, 120)}`);
    }
  }

  // conflict detection: LLM-verified candidate pairs (heuristic fallback without a key).
  // pause first: the support-check batch just consumed rate limit
  if (apiKey && claims.length > 0) await new Promise((r) => setTimeout(r, 4000));
  await detectConflicts(claims, apiKey, restrictedIds);
  claims = assignStatuses(claims);
  claims.push(...detectGaps(claims, EXPECTED_TYPES));

  // only accept the six declared claim types (review S2-7)
  claims = claims.filter((c) => VALID_TYPES.includes(c.type));

  db.claims = claims;
  db.reviews = [];
  db.extractedAt = new Date().toISOString();
  appendAudit(
    db,
    "system",
    "extract",
    `Extracted ${claims.length} claims [${perSource.map((p) => `${p.name}: ${p.extractor}`).join("; ")}]`
  );
  saveDB(db);
  return Response.json({ count: claims.length, perSource, errors });
});

export async function POST(_req: NextRequest) {
  return handler(_req);
}
