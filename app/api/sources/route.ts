import { NextRequest } from "next/server";
import { guard } from "@/lib/session";
import { getDB, saveDB, appendAudit } from "@/lib/store";
import { seedIfEmpty } from "@/lib/seed";
import { chunkSource } from "@/lib/extract";
import { filterSourcesForRole, redactSecrets } from "@/lib/permissions";
import { randomId } from "@/lib/id";
import { createHash } from "crypto";
import { VALID_KINDS, VALID_LEVELS, SourceKind, AccessLevel } from "@/lib/types";

export const runtime = "nodejs";

const MAX_CONTENT = 1_000_000; // 1 MB of text per source

// GET: any signed-in role. Content is included ONLY for sources within the
// caller's access level, and is redacted on the way out.
const getHandler = guard(undefined, async (req: NextRequest, user) => {
  const db = seedIfEmpty(getDB());
  const withContent = req.nextUrl.searchParams.get("withContent") === "1";
  const visible = filterSourcesForRole(db, user.role);
  return Response.json({
    role: user.role,
    sources: visible.map((s) => ({
      id: s.id,
      name: s.name,
      kind: s.kind,
      accessLevel: s.accessLevel,
      author: s.author,
      importedAt: s.importedAt,
      chunks: db.chunks.filter((c) => c.sourceId === s.id).length,
      confirmedPermission: s.confirmedPermission,
      ...(withContent ? { content: redactSecrets(s.content) } : {}),
    })),
    excludedSources: db.sources.length - visible.length,
  });
});

// POST: lead only, validated (review item S2-11).
const postHandler = guard(["lead"], async (req: NextRequest, user) => {
  const body = await req.json().catch(() => null);
  if (!body) return Response.json({ error: "Invalid JSON body." }, { status: 422 });

  const { name, kind, accessLevel, author, content, confirmedPermission } = body;

  if (typeof name !== "string" || !name.trim() || name.length > 120) {
    return Response.json({ error: "Name must be 1–120 characters." }, { status: 422 });
  }
  if (!VALID_KINDS.includes(kind)) {
    return Response.json(
      { error: `kind must be one of: ${VALID_KINDS.join(", ")}.` },
      { status: 422 }
    );
  }
  if (!VALID_LEVELS.includes(accessLevel)) {
    return Response.json(
      { error: `accessLevel must be one of: ${VALID_LEVELS.join(", ")}.` },
      { status: 422 }
    );
  }
  if (typeof content !== "string" || !content.trim()) {
    return Response.json({ error: "Content must be non-empty text." }, { status: 422 });
  }
  if (content.length > MAX_CONTENT) {
    return Response.json({ error: "Content exceeds 1 MB. Split the export into parts." }, { status: 422 });
  }
  // Reject binary-looking payloads instead of importing garbage
  const sample = content.slice(0, 2000);
  const badChars = (sample.match(/[\x00-\x08\x0e-\x1f]/g) ?? []).length;
  if (badChars > sample.length * 0.01) {
    return Response.json({ error: "Content does not look like text (chat/notes/boards only)." }, { status: 422 });
  }
  if (!confirmedPermission) {
    return Response.json(
      { error: "You must confirm you are authorised to import this source." },
      { status: 403 }
    );
  }

  const db = seedIfEmpty(getDB());
  const contentHash = createHash("sha256").update(content).digest("hex");
  const dup = db.sources.find((s) => s.contentHash === contentHash);
  if (dup) {
    return Response.json({ error: `Already imported as "${dup.name}".` }, { status: 409 });
  }

  const source = {
    id: randomId("src"),
    name: name.trim(),
    kind: kind as SourceKind,
    accessLevel: accessLevel as AccessLevel,
    author: typeof author === "string" && author.trim() ? author.trim().slice(0, 120) : user.name,
    importedAt: new Date().toISOString(),
    referenceDate: new Date().toISOString(),
    referenceDateAssumed: true,
    content,
    contentHash,
    confirmedPermission: true,
  };
  db.sources.push(source);
  const chunks = chunkSource(source);
  db.chunks.push(...chunks);
  appendAudit(db, user.name, "import-source", `Imported "${source.name}" (${source.accessLevel}, ${chunks.length} chunks)`);
  saveDB(db);
  return Response.json({ id: source.id, chunks: chunks.length });
});

export async function GET(req: NextRequest) {
  return getHandler(req);
}
export async function POST(req: NextRequest) {
  return postHandler(req);
}
