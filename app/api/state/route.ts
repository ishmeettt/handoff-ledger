import { NextRequest } from "next/server";
import { guard } from "@/lib/session";
import { getDB, saveDB } from "@/lib/store";
import { seedIfEmpty } from "@/lib/seed";
import { redactSecrets } from "@/lib/permissions";

export const runtime = "nodejs";

// Reviewer-facing full state. LEAD ONLY — successor/junior must not be able to
// read the live draft, unredacted claims or restricted evidence (review S1-1).
const handler = guard(["lead"], async () => {
  const db = seedIfEmpty(await getDB());
  await saveDB(db);

  const byStatus = { verified: 0, inferred: 0, conflicting: 0, missing: 0 };
  const byReview = { pending: 0, accepted: 0, edited: 0, rejected: 0, unknown: 0 };
  for (const c of db.claims) {
    byStatus[c.status as keyof typeof byStatus]++;
    byReview[c.reviewState as keyof typeof byReview]++;
  }
  // unreviewed = pending AND not a declared gap (gaps publish without review)
  const pendingUnreviewed = db.claims.filter(
    (c) => c.reviewState === "pending" && c.status !== "missing"
  ).length;
  // quotes found = claims whose quotes all exist in their source (NOT an accuracy score)
  const withEvidence = db.claims.filter((c) => c.evidence.length > 0);
  const quotesFound = withEvidence.filter((c) =>
    c.evidence.every((e) => e.quoteVerified)
  ).length;
  // support-check verdicts (only meaningful when the support check ran)
  const supportCounts = { yes: 0, partial: 0, no: 0, "not-checked": 0 };
  for (const c of db.claims) supportCounts[c.supported ?? "not-checked"]++;

  return Response.json({
    projectName: db.projectName,
    extractedAt: db.extractedAt,
    pendingUnreviewed,
    // renamed per review S2-10: this is quote-existence, not an accuracy score
    quotesFound: { found: quotesFound, total: withEvidence.length },
    supportCounts,
    byStatus,
    byReview,
    sources: db.sources.map((s) => ({
      id: s.id,
      name: s.name,
      kind: s.kind,
      accessLevel: s.accessLevel,
      author: s.author,
      importedAt: s.importedAt,
      chunks: db.chunks.filter((c) => c.sourceId === s.id).length,
      // redacted on the way out for EVERY role, lead included (review S1-1 fix 4)
      preview: redactSecrets(s.content.slice(0, 160)),
    })),
    claims: db.claims.map((c) => ({
      ...c,
      text: redactSecrets(c.text),
      evidence: c.evidence.map((e) => ({ ...e, quote: redactSecrets(e.quote) })),
      ...(c.originalText ? { originalText: redactSecrets(c.originalText) } : {}),
    })),
    reviews: db.reviews,
    versions: db.versions.map((v) => ({
      version: v.version,
      publishedAt: v.publishedAt,
      publishedBy: v.publishedBy,
      note: v.note,
      claimCount: v.claims.length,
      hash: v.hash,
    })),
    audit: db.audit,
  });
});

export async function GET(req: NextRequest) {
  return handler(req);
}
