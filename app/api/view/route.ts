import { NextRequest, NextResponse } from "next/server";
import { getDB } from "@/lib/store";
import { filterClaims, redactSecrets } from "@/lib/permissions";
import { ROLE_MATRIX } from "@/lib/types";

export const runtime = "nodejs";

// Role-appropriate handover view. Serves ONLY published versions — the invariant:
// nothing reaches the incoming person that a reviewer has not approved.
export async function GET(req: NextRequest) {
  const role = req.nextUrl.searchParams.get("role") ?? "successor";
  const cfg = ROLE_MATRIX[role];
  if (!cfg) {
    return NextResponse.json(
      { error: `Unknown role. Valid: ${Object.keys(ROLE_MATRIX).join(", ")}` },
      { status: 400 }
    );
  }
  const db = getDB();
  const version = db.versions.at(-1);
  if (!version) {
    return NextResponse.json(
      { error: "No published handover yet. A reviewer must publish from the Publish page.", published: false },
      { status: 404 }
    );
  }
  const sourceName = new Map(db.sources.map((s) => [s.id, s.name]));
  const { visible, excludedCount } = filterClaims(
    version.claims,
    db.sources,
    cfg.seeBelow[cfg.seeBelow.length - 1]
  );
  return NextResponse.json({
    published: true,
    role,
    roleLabel: cfg.label,
    projectName: db.projectName,
    version: version.version,
    publishedAt: version.publishedAt,
    publishedBy: version.publishedBy,
    claims: visible.map((c) => ({
      ...c,
      text: redactSecrets(c.text),
      evidence: c.evidence.map((e) => ({
        ...e,
        quote: redactSecrets(e.quote),
        sourceName: sourceName.get(e.sourceId) ?? e.sourceId,
      })),
    })),
    excludedCount,
    publishedTotal: version.claims.length,
    versions: db.versions.map((v) => ({ version: v.version, publishedAt: v.publishedAt, note: v.note })),
  });
}
