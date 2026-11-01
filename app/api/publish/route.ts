import { NextRequest } from "next/server";
import { guard } from "@/lib/session";
import { getDB, saveDB, appendAudit } from "@/lib/store";
import { randomId } from "@/lib/id";

export const runtime = "nodejs";

// Claims that MAY be published: the reviewer approved them (accepted/edited) or
// explicitly acknowledged a gap (unknown). Missing-status claims assert nothing,
// so they publish too (stated in the UI). Pending claims are HELD BACK — the
// human review gate.
const PUBLISHABLE = new Set(["accepted", "edited", "unknown"]);

// LEAD ONLY. publishedBy always comes from the signed session.
const handler = guard(["lead"], async (req: NextRequest, user) => {
  const { note } = await req.json().catch(() => ({}));
  const db = getDB();
  if (db.claims.length === 0) {
    return Response.json({ error: "Nothing to publish — run extraction first." }, { status: 400 });
  }

  const publishable = db.claims.filter(
    (c) => PUBLISHABLE.has(c.reviewState) || c.status === "missing"
  );
  const reviewed = db.claims.filter((c) => PUBLISHABLE.has(c.reviewState));
  const heldBack = db.claims.filter(
    (c) => !PUBLISHABLE.has(c.reviewState) && c.status !== "missing"
  );
  if (reviewed.length === 0) {
    return Response.json(
      { error: "No claims have been reviewed yet. Approve at least one claim on the review board before publishing — the human review gate." },
      { status: 400 }
    );
  }

  // publish checklist (review S2-8): unresolved conflicts warn the publisher
  const unresolvedConflicts = publishable.filter((c) => c.status === "conflicting").length;
  const unconfirmed = publishable.filter(
    (c) => c.status === "inferred" && c.reviewState !== "accepted" && c.reviewState !== "edited"
  ).length;

  const version = (db.versions.at(-1)?.version ?? 0) + 1;
  db.versions.push({
    id: randomId("ver"),
    version,
    publishedAt: new Date().toISOString(),
    publishedBy: user.name,
    claims: structuredClone(publishable),
    note:
      note ??
      ([
        heldBack.length > 0 ? `${heldBack.length} unreviewed held back` : null,
        unresolvedConflicts > 0 ? `${unresolvedConflicts} unresolved conflict(s)` : null,
        unconfirmed > 0 ? `${unconfirmed} unconfirmed inference(s)` : null,
      ]
        .filter(Boolean)
        .join(" · ") || "all claims reviewed"),
  });
  appendAudit(
    db,
    user.name,
    "publish",
    `Published handover v${version}: ${publishable.length} claims published, ${heldBack.length} held back (unreviewed)`
  );
  saveDB(db);
  return Response.json({
    version,
    publishedCount: publishable.length,
    heldBackCount: heldBack.length,
    unresolvedConflicts,
    unconfirmed,
  });
});

export async function POST(req: NextRequest) {
  return handler(req);
}
