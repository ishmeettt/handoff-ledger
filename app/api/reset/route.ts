import { NextRequest } from "next/server";
import { createHash } from "crypto";
import { guard } from "@/lib/session";
import { getDB, saveDB, appendAudit } from "@/lib/store";
import { seedIfEmpty } from "@/lib/seed";
import {
  chunkSource,
  heuristicExtract,
  dedupeByQuote,
  refineTypes,
  detectConflicts,
  assignStatuses,
  detectGaps,
  preserveReviews,
} from "@/lib/extract";
import { VALID_TYPES, Claim, ClaimType, HandoverVersion } from "@/lib/types";
import { randomId } from "@/lib/id";

export const runtime = "nodejs";

const EXPECTED_TYPES: ClaimType[] = [
  "decision",
  "owner",
  "risk",
  "dependency",
  "open-question",
  "contact",
];

// LEAD ONLY, and only when ALLOW_RESET=true (never on a live deployment —
// review S1-1 fix 2). Returns 404 when disabled so it isn't even discoverable.
//
// The reset restores the full demo STORY (fixes-only #4): re-seed, run the
// fast deterministic heuristic extractor (no model call, no rate limits),
// leave every claim UNREVIEWED so Review → Publish are the next steps, and
// publish a small baseline v1 from a fixed safe subset so successor and
// junior views work immediately.
const handler = guard(["lead"], async (req: NextRequest, user) => {
  if (process.env.ALLOW_RESET !== "true") {
    return Response.json({ error: "Reset is disabled on this deployment." }, { status: 404 });
  }
  const db = await getDB();
  // full re-seed: drop old sources so schema changes (referenceDate etc.) apply
  db.sources = [];
  db.chunks = [];
  seedIfEmpty(db);
  db.chunks = db.sources.flatMap((s) => chunkSource(s));
  db.claims = [];
  db.reviews = [];
  db.versions = [];
  db.audit = [];
  db.extractedAt = null;

  // --- deterministic re-extraction (heuristic only: fast, offline, stable) ---
  const restrictedIds = new Set(
    db.sources.filter((s) => s.accessLevel === "restricted").map((s) => s.id)
  );
  const publicIds = new Set(
    db.sources.filter((s) => s.accessLevel === "public").map((s) => s.id)
  );
  let claims: Claim[] = [];
  for (const source of db.sources) {
    const chunks = db.chunks.filter((c) => c.sourceId === source.id);
    claims.push(...heuristicExtract(chunks, source));
  }
  claims = refineTypes(dedupeByQuote(claims));
  await detectConflicts(claims, undefined, restrictedIds);
  claims = assignStatuses(claims);
  claims.push(...detectGaps(claims, EXPECTED_TYPES));
  claims = claims.filter((c) => VALID_TYPES.includes(c.type));
  // stamp stableKeys (same helper the extraction route uses)
  preserveReviews(claims, [], []);
  db.claims = claims; // every claim starts reviewState="pending" (unreviewed)

  // --- baseline v1: a small, fixed safe subset ---
  // Safe = never cites the restricted source, and either comes from a public
  // source (so the junior view has content) or is a non-conflicting decision/
  // owner claim (the spine of the handover). Gaps are included: they assert
  // nothing. Conflicts stay out until a reviewer resolves them.
  const citesRestricted = (cl: Claim) =>
    cl.evidence.some((e) => restrictedIds.has(e.sourceId));
  const publicOnly = (cl: Claim) =>
    cl.evidence.length > 0 && cl.evidence.every((e) => publicIds.has(e.sourceId));
  const baseline = claims
    .filter((cl) => !citesRestricted(cl))
    .filter((cl) => cl.status !== "conflicting")
    .filter(
      (cl) =>
        publicOnly(cl) ||
        cl.status === "missing" ||
        ((cl.type === "decision" || cl.type === "owner") && cl.status !== "conflicting")
    )
    .slice(0, 10);

  if (baseline.length > 0) {
    const snapshot = structuredClone(baseline);
    const version: HandoverVersion = {
      id: randomId("ver"),
      version: 1,
      publishedAt: new Date().toISOString(),
      publishedBy: user.name,
      claims: snapshot,
      note: "Baseline demo handover (synthetic data, heuristic extraction)",
      hash: createHash("sha256").update(JSON.stringify(snapshot)).digest("hex"),
    };
    db.versions.push(version);
  }

  db.extractedAt = new Date().toISOString();
  appendAudit(
    db,
    user.name,
    "reset",
    `Database reset: re-seeded, heuristic extraction (${claims.length} claims, all pending), baseline v1 published with ${db.versions[0]?.claims.length ?? 0} claims.`
  );
  await saveDB(db);
  return Response.json({
    ok: true,
    sources: db.sources.length,
    claims: claims.length,
    pending: claims.filter((c) => c.reviewState === "pending").length,
    baselineVersion: db.versions[0]?.version ?? null,
    baselineClaims: db.versions[0]?.claims.length ?? 0,
  });
});

export async function POST(req: NextRequest) {
  return handler(req);
}
