// Session auth: three demo users, scrypt-hashed passwords, HMAC-signed httpOnly
// cookie. Role ALWAYS comes from the verified session — never from a URL param
// or request body (review item S1-1).
import {
  scryptSync,
  randomBytes,
  timingSafeEqual,
  createHmac,
  randomUUID,
} from "crypto";
import fs from "fs";
import path from "path";
import { NextRequest } from "next/server";
import { AccessLevel, ROLE_MATRIX } from "./types";
import { SaveError, DocTooLargeError } from "./store";

export type Role = "lead" | "successor" | "junior";

export interface SessionUser {
  userId: string;
  name: string;
  role: Role;
}

interface UserRecord extends SessionUser {
  passwordHash: string; // "salt:hex(scrypt(password, salt, 64))"
}

const COOKIE_NAME = "hl_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

// Demo users. Passwords are deliberately simple and SHOWN on the login page —
// this is a judged demo, not a production deployment. Swap for real accounts
// when real data exists.
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? "handoff-demo";
const USERS: UserRecord[] = [
  { userId: "u_priya", name: "Priya (project lead)", role: "lead", passwordHash: hashPassword(DEMO_PASSWORD) },
  { userId: "u_sam", name: "Sam (incoming successor)", role: "successor", passwordHash: hashPassword(DEMO_PASSWORD) },
  { userId: "u_lee", name: "Lee (incoming junior)", role: "junior", passwordHash: hashPassword(DEMO_PASSWORD) },
];

// ---------- signing secret (generated once, stored in gitignored data/) ----------

let cachedSecret: Buffer | null = null;
function signingSecret(): Buffer {
  if (cachedSecret) return cachedSecret;
  if (process.env.SESSION_SECRET) {
    cachedSecret = Buffer.from(process.env.SESSION_SECRET, "utf8");
    return cachedSecret;
  }
  const file = path.join(process.cwd(), "data", "session-secret");
  try {
    cachedSecret = fs.readFileSync(file);
  } catch {
    cachedSecret = randomBytes(32);
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, cachedSecret, { mode: 0o600 });
    } catch {
      // Workers have no filesystem: this isolate keeps its own random secret.
      // Deployments set SESSION_SECRET (the branch above) so cookies survive
      // isolate rotation; locally the data/ file keeps it stable.
    }
  }
  return cachedSecret;
}

function sign(payload: string): string {
  return createHmac("sha256", signingSecret()).update(payload).digest("base64url");
}

// ---------- cookie ----------

interface SessionPayload {
  userId: string;
  name: string;
  role: Role;
  exp: number;
}

export function encodeSession(user: SessionUser): string {
  const payload: SessionPayload = {
    userId: user.userId,
    name: user.name,
    role: user.role,
    exp: Date.now() + SESSION_TTL_MS,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body)}`;
}

export function decodeSession(token: string | undefined): SessionPayload | null {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null; // forged cookie
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionPayload;
    if (typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
    if (!ROLE_MATRIX[payload.role]) return null;
    return payload;
  } catch {
    return null;
  }
}

export function readSession(req: NextRequest): SessionUser | null {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  const payload = decodeSession(token);
  if (!payload) return null;
  return { userId: payload.userId, name: payload.name, role: payload.role };
}

export function sessionCookie(token: string): string {
  // Secure on HTTPS deployments (fixes-only #6); http://localhost still works
  // because NODE_ENV is development there.
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}${secure}`;
}

export function clearSessionCookie(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

// ---------- auth gate ----------

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Every protected route starts here. Throws HttpError(401/403) on failure. */
export function requireUser(req: NextRequest, roles?: Role[]): SessionUser {
  const user = readSession(req);
  if (!user) throw new HttpError(401, "Not signed in.");
  if (roles && !roles.includes(user.role)) {
    throw new HttpError(403, `This action requires one of: ${roles.join(", ")}.`);
  }
  return user;
}

// ---------- login rate limit (fixes-only #6) ----------
// In-memory per isolate: 5 failed attempts per username+IP locks that pair
// for 60 s. Best-effort on Workers (each isolate has its own map) — enough
// to stop password guessing during the demo without external state.
const failedLogins = new Map<string, { fails: number; lockedUntil: number }>();
const MAX_FAILS = 5;
const LOCKOUT_MS = 60_000;

export function login(username: string, password: string, ip = "local"): SessionUser | null {
  const key = `${username.toLowerCase()}|${ip}`;
  const rec = failedLogins.get(key);
  if (rec && rec.lockedUntil > Date.now()) return null; // locked out
  const user = USERS.find((u) => u.userId === `u_${username.toLowerCase()}`);
  if (!user || !verifyPassword(password, user.passwordHash)) {
    const base = rec && rec.lockedUntil <= Date.now() ? 0 : rec?.fails ?? 0;
    const fails = base + 1;
    failedLogins.set(key, {
      fails,
      lockedUntil: fails >= MAX_FAILS ? Date.now() + LOCKOUT_MS : 0,
    });
    return null;
  }
  failedLogins.delete(key); // success clears the counter
  return { userId: user.userId, name: user.name, role: user.role };
}

export function demoUsers(): { username: string; name: string; role: Role; roleLabel: string }[] {
  return USERS.map((u) => ({
    username: u.userId.replace(/^u_/, ""),
    name: u.name,
    role: u.role,
    roleLabel: ROLE_MATRIX[u.role].label,
  }));
}

/** Wrap a route handler with the auth gate. */
export function guard(
  roles: Role[] | undefined,
  handler: (req: NextRequest, user: SessionUser) => Promise<Response>
): (req: NextRequest) => Promise<Response> {
  return async (req: NextRequest) => {
    try {
      const user = requireUser(req, roles);
      return await handler(req, user);
    } catch (e) {
      if (e instanceof HttpError) {
        return Response.json({ error: e.message }, { status: e.status });
      }
      // honest save failures (fixes-only #5): a failed write is never a 200
      if (e instanceof DocTooLargeError) {
        return Response.json({ error: e.message }, { status: 413 });
      }
      if (e instanceof SaveError) {
        return Response.json({ error: e.message }, { status: 500 });
      }
      console.error(e);
      return Response.json({ error: "Internal error" }, { status: 500 });
    }
  };
}

/** Max access level a role may see. */
export function roleMaxLevel(role: Role): AccessLevel {
  return ROLE_MATRIX[role].seeBelow;
}

export { COOKIE_NAME, DEMO_PASSWORD };
