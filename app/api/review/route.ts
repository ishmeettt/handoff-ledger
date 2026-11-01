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
  if (!claimId || (action !== "resolve" && !VALID.includes(action))) {
    return Response.json({ error: "claimId and valid action required" }, { status: 400 });
  }
  const db = await getDB();
  const claim = db.claims.find((c) => c.id === claimId);
  if (!claim) return Response.json({ error: "claim not found" }, { status: 404 });

  // Conflict resolution (review S2-8): the reviewer picks the winning side;
  // the other side(s) become rejected with the reason, and both stop being
  // "conflicting" so the publish checklist no longer warns about them.
  if (action === "resolve") {
    if (claim.status !== "conflicting") {
      return Response.json({ error: "claim is not conflicting" }, { status: 400 });
    }
    const winner = claim;
    const losers = (winner.conflictingWith ?? [])
      .map((id) => db.claims.find((c) => c.id === id))
      .filter((c): c is NonNullable<typeof c> => !!c && c.id !== winner.id);
    const quotesOk =
      winner.evidence.length > 0 && winner.evidence.every((e) => e.quoteVerified);
    const beforeW = { text: winner.text, status: winner.status, reviewState: winner.reviewState };
    winner.status = winner.supported === "yes" && quotesOk ? "verified" : "inferred";
    winner.statusReason =
      `Conflict resolved by ${user.name}: this version stands.` +
      (note ? ` ${note}` : "") +
      (winner.stale ? " ⏳ Staleness flag: source mentions an old last-activity date." : "");
    winner.conflictingWith = [];
    winner.reviewState = "accepted";
    winner.reviewNote = note;
    db.reviews.push({
      id: randomId("rev"),
      claimId: winner.id,
      action: "resolve",
      actor: user.name,
      at: new Date().toISOString(),
      note: note ?? "kept as the winning version",
      before: beforeW,
      after: { text: winner.text, status: winner.status, reviewState: winner.reviewState },
    });
    for (const loser of losers) {
      const beforeL = { text: loser.text, status: loser.status, reviewState: loser.reviewState };
      loser.status = "inferred";
      loser.statusReason =
        `Conflict resolved by ${user.name}: rejected in favour of another version of this statement.`;
      loser.conflictingWith = [];
      loser.reviewState = "rejected";
      loser.reviewNote = note;
      db.reviews.push({
        id: randomId("rev"),
        claimId: loser.id,
        action: "resolve",
        actor: user.name,
        at: new Date().toISOString(),
        note: `rejected in favour of ${winner.id}`,
        before: beforeL,
        after: { text: loser.text, status: loser.status, reviewState: loser.reviewState },
      });
    }
    appendAudit(
      db,
      user.name,
      "review:resolve",
      `Conflict resolved: kept ${winner.id}, rejected ${losers.length} other side(s)`
    );
    await saveDB(db);
    return Response.json({ ok: true, winner, losers });
  }

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
  await saveDB(db);
  return Response.json({ ok: true, claim });
});

export async function PATCH(req: NextRequest) {
  return handler(req);
}
