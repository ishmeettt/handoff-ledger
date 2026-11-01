// Document store.
// - On Cloudflare Workers (Freebuff Sites) the whole DB is one JSON document
//   in D1 under the kv key "db" — a mechanical swap from the file store
//   (review S2-9): same shape, same call sites, now async.
// - Locally (plain `next dev` / `next start`, or dev without the OpenNext
//   Cloudflare integration) it falls back to data/db.json exactly as before.
// D1 serializes writes; concurrent read-modify-write across requests is
// last-writer-wins, which matches the file store's behaviour and is fine at
// demo scale (single reviewer).
import fs from "fs";
import path from "path";
import { DB } from "./types";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "db.json");
const KV_KEY = "db";

const EMPTY: DB = {
  projectName: "Autograder (demo team)",
  sources: [],
  chunks: [],
  claims: [],
  reviews: [],
  versions: [],
  audit: [],
  extractedAt: null,
};

// ---------- minimal structural types for D1 (no workers-types dependency) ----------
interface D1Stmt {
  bind(...values: unknown[]): D1Stmt;
  first<T = unknown>(): Promise<T | null>;
  run(): Promise<unknown>;
}
interface D1Like {
  prepare(sql: string): D1Stmt;
}

// D1 is an OBJECT binding, so it is never in process.env — it comes from the
// OpenNext request context. Outside a Worker (plain next dev/build/start)
// getCloudflareContext() throws and we select the file store.
let d1Cache: D1Like | null = null;
async function getD1(): Promise<D1Like | null> {
  if (d1Cache) return d1Cache;
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const ctx = getCloudflareContext() as unknown as
      | { env?: { DB?: D1Like } }
      | undefined;
    d1Cache = ctx?.env?.DB ?? null;
  } catch {
    d1Cache = null;
  }
  return d1Cache;
}

let schemaReady: Promise<void> | null = null;
function ensureSchema(d1: D1Like): Promise<void> {
  if (!schemaReady) {
    schemaReady = d1
      .prepare("CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)")
      .run()
      .then(() => undefined)
      .catch((e) => {
        schemaReady = null; // retry on the next call
        throw e;
      });
  }
  return schemaReady;
}

async function putDoc(d1: D1Like, db: DB): Promise<void> {
  await d1
    .prepare(
      "INSERT INTO kv (k, v) VALUES (?1, ?2) ON CONFLICT(k) DO UPDATE SET v = excluded.v"
    )
    .bind(KV_KEY, JSON.stringify(db))
    .run();
}

export async function getDB(): Promise<DB> {
  const d1 = await getD1();
  if (d1) {
    await ensureSchema(d1);
    const row = await d1
      .prepare("SELECT v FROM kv WHERE k = ?1")
      .bind(KV_KEY)
      .first<{ v: string }>();
    if (!row) {
      const db = structuredClone(EMPTY);
      await putDoc(d1, db);
      return db;
    }
    return JSON.parse(row.v) as DB;
  }
  // file fallback (local development)
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify(EMPTY, null, 2));
    return structuredClone(EMPTY);
  }
  return JSON.parse(fs.readFileSync(DB_PATH, "utf-8"));
}

export async function saveDB(db: DB): Promise<void> {
  const d1 = await getD1();
  if (d1) {
    await ensureSchema(d1);
    await putDoc(d1, db);
    return;
  }
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

export function appendAudit(db: DB, actor: string, action: string, detail: string) {
  db.audit.push({
    id: `aud_${db.audit.length + 1}_${Date.now()}`,
    at: new Date().toISOString(),
    actor,
    action,
    detail,
  });
}
