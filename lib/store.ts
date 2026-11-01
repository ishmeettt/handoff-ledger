// Simple JSON-file store. SQLite/Postgres is the Round 3 swap; the shape matches the plan's
// data model so the migration is mechanical.
import fs from "fs";
import path from "path";
import { DB } from "./types";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "db.json");

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

export function getDB(): DB {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify(EMPTY, null, 2));
    return structuredClone(EMPTY);
  }
  return JSON.parse(fs.readFileSync(DB_PATH, "utf-8"));
}

export function saveDB(db: DB): void {
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
