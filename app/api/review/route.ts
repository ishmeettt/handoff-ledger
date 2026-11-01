import { NextRequest } from "next/server";
import { guard } from "@/lib/session";
import { getDB, saveDB, appendAudit } from "@/lib/store";
import { redactSecrets } from "@/lib/permissions";
import { randomId } from "@/lib/id";
import { ReviewState } from "@/lib/types";

export const runtime = "nodejs";

const VALID: ReviewState[] = ["pending", "accepted", "edited", "rejected", "unknown"];

// LEAD ONLY. actor always comes from the signed session, never the body.
const handler = guard(["lead"], async (req: NextRequest, user) => {
  const { claimId, action, note, newText } = await req.json();
  if (!claimId || !VALID.includes(action)) {
    return Response.json({ error: "claimId and valid action required" }, { status: 400 });
  }
  const db = getDB();
  const claim = db.claims.find((c) => c.id === claimId);
  if (!claim) return Response.json({ error: "claim not found" }, { status: 404 });

  const before = {
    text: claim.text,
    status: claim.status,
    reviewState: claim.reviewState,
  };

  claim.reviewState = action;
  claim.reviewNote = note;
  if (action === "edited") {
    if (typeof newText !== "string" || !newText.trim()) {
      return Response.json({ error: "edited action requires newText" }, { status: 400 });
    }
    // Reviewer edit: new text is NOT checked against the quote, so the claim
    // drops to Inferred with an honest reason (review S2-4 — condition was
    // previously backwards).
    claim.originalText = claim.originalText ?? before.text;
    claim.text = newText.trim();
    claim.status = "inferred";
    claim.supported = "not-checked";
    claim.statusReason =
      `Edited by reviewer on ${new Date().toISOString().slice(0, 10)}; new text not checked against the quote. If the evidence no longer fits, reject or re-extract.`;
  }
  // NOTE: accepting does NOT rewrite status. Reviewer confirmation is shown as
  // a separate "confirmed by reviewer" badge (review S1-2 fix 5).

  db.reviews.push({
    id: randomId("rev"),
    claimId,
    action,
    actor: user.name, // session identity, not request body
    at: new Date().toISOString(),
    note,
    before,
    after: { text: claim.text, status: claim.status, reviewState: claim.reviewState },
  });
  appendAudit(
    db,
    user.name,
    `review:${action}`,
    `Claim ${claimId}: ${redactSecrets(claim.text.slice(0, 80))}`
  );
  saveDB(db);
  return Response.json({ ok: true, claim });
});

export async function PATCH(req: NextRequest) {
  return handler(req);
}
