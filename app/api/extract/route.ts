import { NextResponse } from "next/server";
import { getDB, saveDB, appendAudit } from "@/lib/store";
import {
  chunkSource,
  heuristicExtract,
  groqExtract,
  assignStatuses,
  detectGaps,
} from "@/lib/extract";
import { randomId } from "@/lib/id";
import { ClaimType } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

const EXPECTED_TYPES: ClaimType[] = [
  "decision",
  "owner",
  "risk",
  "dependency",
  "open-question",
  "contact",
];

export async function POST() {
  const db = getDB();
  if (db.sources.length === 0) {
    return NextResponse.json({ error: "Import a source first." }, { status: 400 });
  }
  // rebuild chunks so edits to sources are picked up
  db.chunks = db.sources.flatMap((s) => chunkSource(s));

  const apiKey = process.env.GROQ_API_KEY;
  let claims = [];
  let mode = "heuristic";
  const errors: string[] = [];

  for (const source of db.sources) {
    const chunks = db.chunks.filter((c) => c.sourceId === source.id);
    try {
      if (apiKey) {
        claims.push(...(await groqExtract(chunks, source, apiKey)));
        mode = "groq";
      } else {
        claims.push(...heuristicExtract(chunks, source));
      }
    } catch (e: any) {
      errors.push(`${source.name}: ${e.message}`);
      claims.push(...heuristicExtract(chunks, source));
    }
  }

  claims = assignStatuses(claims);
  claims.push(...detectGaps(claims, EXPECTED_TYPES));

  db.claims = claims;
  db.reviews = [];
  db.extractedAt = new Date().toISOString();
  appendAudit(
    db,
    "system",
    "extract",
    `Extracted ${claims.length} claims via ${mode}${errors.length ? ` (fallback used: ${errors.join("; ")})` : ""}`
  );
  saveDB(db);
  return NextResponse.json({ count: claims.length, mode, errors });
}
