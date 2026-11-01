import { NextRequest, NextResponse } from "next/server";
import { getDB, saveDB, appendAudit } from "@/lib/store";
import { randomId } from "@/lib/id";
import { ReviewState } from "@/lib/types";

export const runtime = "nodejs";

const VALID: ReviewState[] = ["pending", "accepted", "edited", "rejected", "unknown"];

export async function PATCH(req: NextRequest) {
  const { claimId, action, actor, note, newText } = await req.json();
  if (!claimId || !VALID.includes(action)) {
    return NextResponse.json({ error: "claimId and valid action required" }, { status: 400 });
  }
  const db = getDB();
  const claim = db.claims.find((c) => c.id === claimId);
  if (!claim) return NextResponse.json({ error: "claim not found" }, { status: 404 });

  claim.reviewState = action;
  claim.reviewNote = note;
  if (action === "edited" && typeof newText === "string" && newText.trim()) {
    claim.text = newText.trim();
    claim.status = claim.evidence.every((e) => e.quoteVerified) ? claim.status : "inferred";
  }
  if (action === "accepted" && claim.status === "inferred") {
    // reviewer confirmation upgrades inferred → verified (human gate, per plan)
    claim.status = "verified";
    claim.statusReason = "Inference confirmed by reviewer; quote verified against source.";
  }
  db.reviews.push({
    id: randomId("rev"),
    claimId,
    action,
    actor: actor ?? "reviewer",
    at: new Date().toISOString(),
    note,
  });
  appendAudit(db, actor ?? "reviewer", `review:${action}`, `Claim ${claimId}: ${claim.text.slice(0, 80)}`);
  saveDB(db);
  return NextResponse.json({ ok: true, claim });
}
