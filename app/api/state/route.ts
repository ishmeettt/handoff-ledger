import { NextResponse } from "next/server";
import { getDB, saveDB } from "@/lib/store";
import { seedIfEmpty } from "@/lib/seed";

export const runtime = "nodejs";

// Reviewer-facing full state (the reviewer sees everything — they own the sources).
export async function GET() {
  const db = seedIfEmpty(getDB());
  saveDB(db);
  const byStatus = { verified: 0, inferred: 0, conflicting: 0, missing: 0 };
  const byReview = { pending: 0, accepted: 0, edited: 0, rejected: 0, unknown: 0 };
  for (const c of db.claims) {
    byStatus[c.status as keyof typeof byStatus]++;
    byReview[c.reviewState as keyof typeof byReview]++;
  }
  // plan metric: citation validity rate = claims whose quotes all exact-match their source
  const withEvidence = db.claims.filter((c) => c.evidence.length > 0);
  const citationValid = withEvidence.filter((c) => c.evidence.every((e) => e.quoteVerified)).length;
  return NextResponse.json({
    projectName: db.projectName,
    extractedAt: db.extractedAt,
    citationValidity: { valid: citationValid, total: withEvidence.length },
    sources: db.sources.map((s) => ({
      id: s.id,
      name: s.name,
      kind: s.kind,
      accessLevel: s.accessLevel,
      author: s.author,
      importedAt: s.importedAt,
      chunks: db.chunks.filter((c) => c.sourceId === s.id).length,
    })),
    claims: db.claims,
    byStatus,
    byReview,
    reviews: db.reviews,
    versions: db.versions.map((v) => ({
      version: v.version,
      publishedAt: v.publishedAt,
      publishedBy: v.publishedBy,
      note: v.note,
      claimCount: v.claims.length,
    })),
    audit: db.audit,
  });
}
