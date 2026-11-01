import { NextRequest } from "next/server";
import { guard } from "@/lib/session";
import { getDB } from "@/lib/store";
import { filterClaims, redactSecrets } from "@/lib/permissions";
import { roleMaxLevel } from "@/lib/session";

export const runtime = "nodejs";

// Role-appropriate handover view. The role comes from the SIGNED SESSION —
// ?role= is ignored entirely (review S1-1). Serves only published versions.
const handler = guard(undefined, async (req: NextRequest, user) => {
  // A lead may PREVIEW a subordinate role's view (?as=successor) — the result
  // is still filtered to that role, and marked as a preview.
  const preview = req.nextUrl.searchParams.get("as");
  const effRole =
    user.role === "lead" && (preview === "successor" || preview === "junior")
      ? preview
      : user.role;
  const maxLevel = roleMaxLevel(effRole);

  const db = getDB();
  const version = db.versions.at(-1);
  if (!version) {
    return Response.json(
      { error: "No published handover yet. A reviewer must publish from the Publish page.", published: false },
      { status: 404 }
    );
  }
  const sourceName = new Map(db.sources.map((s) => [s.id, s.name]));
  const { visible, excludedCount } = filterClaims(version.claims, db.sources, maxLevel);
  return Response.json({
    published: true,
    role: effRole,
    viewerRole: user.role,
    preview: effRole !== user.role,
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
        sourceName: sourceName.get(e.sourceId) ?? "unknown source",
      })),
    })),
    excludedCount,
    publishedTotal: version.claims.length,
    versions: db.versions.map((v) => ({ version: v.version, publishedAt: v.publishedAt, note: v.note })),
  });
});

export async function GET(req: NextRequest) {
  return handler(req);
}
