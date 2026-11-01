import { NextResponse } from "next/server";
import { getDB, saveDB, appendAudit } from "@/lib/store";
import { seedIfEmpty } from "@/lib/seed";
import { chunkSource } from "@/lib/extract";

export const runtime = "nodejs";

// Reset to the seeded synthetic project. Demo/self-test convenience only.
export async function POST() {
  const db = seedIfEmpty(getDB());
  db.chunks = db.sources.flatMap((s) => chunkSource(s));
  db.claims = [];
  db.reviews = [];
  db.versions = [];
  db.audit = [];
  db.extractedAt = null;
  appendAudit(db, "system", "reset", "Database reset to seeded synthetic project.");
  saveDB(db);
  return NextResponse.json({ ok: true, sources: db.sources.length });
}
