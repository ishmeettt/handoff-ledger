import { NextRequest } from "next/server";
import { readSession } from "@/lib/session";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const user = readSession(req);
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  return Response.json(user);
}
