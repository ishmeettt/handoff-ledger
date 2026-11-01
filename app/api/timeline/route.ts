import { NextRequest } from "next/server";
import { guard } from "@/lib/session";
import { getDB } from "@/lib/store";
import { filterClaims, redactSecrets } from "@/lib/permissions";
import { roleMaxLevel } from "@/lib/session";
import { buildTimeline } from "@/lib/timeline";

export const runtime = "nodejs";

// Timeline over the ROLE-FILTERED claim set (review S1-3): a junior never
// receives restricted claim text through this endpoint either.
const handler = guard(undefined, async (req: NextRequest, user) => {
  const db = await getDB();
  const { visible } = filterClaims(db.claims, db.sources, roleMaxLevel(user.role));
  const events = buildTimeline(visible, db.sources).map((e) => ({
    ...e,
    text: redactSecrets(e.text),
  }));
  return Response.json({ role: user.role, events, extractedAt: db.extractedAt });
});

export async function GET(req: NextRequest) {
  return handler(req);
}
