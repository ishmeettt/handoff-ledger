import { NextRequest } from "next/server";
import { guard } from "@/lib/session";
import { getDB, saveDB, appendAudit } from "@/lib/store";
import { seedIfEmpty } from "@/lib/seed";
import { chunkSource } from "@/lib/extract";

export const runtime = "nodejs";

// LEAD ONLY, and only when ALLOW_RESET=true (never on a live deployment —
// review S1-1 fix 2). Returns 404 when disabled so it isn't even discoverable.
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
  appendAudit(db, user.name, "reset", "Database reset to seeded synthetic project.");
  await saveDB(db);
  return Response.json({ ok: true, sources: db.sources.length });
});

export async function POST(req: NextRequest) {
  return handler(req);
}
