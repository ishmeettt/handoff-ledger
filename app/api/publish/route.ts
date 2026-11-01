import { NextRequest, NextResponse } from "next/server";
import { getDB, saveDB, appendAudit } from "@/lib/store";
import { randomId } from "@/lib/id";
import { ROLE_MATRIX } from "@/lib/types";

export const runtime = "nodejs";

// Claims that MAY be published: the reviewer approved them (accepted/edited) or
// explicitly acknowledged a gap (unknown). Missing-status claims assert nothing,
// so they publish too (they leak no source content). Pending claims are HELD BACK —
// this is the human review gate from the plan's invariant.
const PUBLISHABLE = new Set(["accepted", "edited", "unknown"]);

export async function POST(req: NextRequest) {
  const { publishedBy, note } = await req.json().catch(() => ({}));
  const db = getDB();
  if (db.claims.length === 0) {
    return NextResponse.json({ error: "Nothing to publish — run extraction first." }, { status: 400 });
  }
  const publishable = db.claims.filter(
    (c) => PUBLISHABLE.has(c.reviewState) || c.status === "missing"
  );
  const reviewed = db.claims.filter((c) => PUBLISHABLE.has(c.reviewState));
  const heldBack = db.claims.filter(
    (c) => !PUBLISHABLE.has(c.reviewState) && c.status !== "missing"
  );
  if (reviewed.length === 0) {
    return NextResponse.json(
      { error: "No claims have been reviewed yet. Approve at least one claim on the review board before publishing — the human review gate." },
      { status: 400 }
    );
  }
  const version = (db.versions.at(-1)?.version ?? 0) + 1;
  db.versions.push({
    id: randomId("ver"),
    version,
    publishedAt: new Date().toISOString(),
    publishedBy: publishedBy ?? "reviewer",
    // immutable snapshot: only reviewed claims; pending ones never reach the handover
    claims: structuredClone(publishable),
    note: note ?? (heldBack.length > 0 ? `${heldBack.length} unreviewed claim(s) held back` : "all claims reviewed"),
  });
  appendAudit(
    db,
    publishedBy ?? "reviewer",
    "publish",
    `Published handover v${version}: ${publishable.length} claims published, ${heldBack.length} held back (unreviewed)`
  );
  saveDB(db);
  return NextResponse.json({
    version,
    publishedCount: publishable.length,
    heldBackCount: heldBack.length,
    roles: ROLE_MATRIX,
  });
}
