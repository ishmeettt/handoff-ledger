import { NextResponse } from "next/server";
import { getDB } from "@/lib/store";
import { buildTimeline } from "@/lib/timeline";

export const runtime = "nodejs";

export async function GET() {
  const db = getDB();
  return NextResponse.json({
    events: buildTimeline(db.claims, db.sources),
    extractedAt: db.extractedAt,
  });
}
