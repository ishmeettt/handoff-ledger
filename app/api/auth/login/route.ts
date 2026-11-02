import { NextRequest } from "next/server";
import { login, sessionCookie, encodeSession, demoUsers } from "@/lib/session";

export const runtime = "nodejs";

export async function GET() {
  return Response.json({ users: demoUsers() });
}

export async function POST(req: NextRequest) {
  const { username, password } = await req.json().catch(() => ({}));
  if (typeof username !== "string" || typeof password !== "string") {
    return Response.json({ error: "username and password required" }, { status: 400 });
  }
  // rate-limit key: username + caller IP (fixes-only #6)
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("cf-connecting-ip") ||
    "local";
  const user = login(username, password, ip);
  if (!user) {
    return Response.json({ error: "Invalid username or password." }, { status: 401 });
  }
  return Response.json(
    { name: user.name, role: user.role },
    { headers: { "Set-Cookie": sessionCookie(encodeSession(user)) } }
  );
}
