import { NextRequest, NextResponse } from "next/server";
import { getDB, saveDB, appendAudit } from "@/lib/store";
import { chunkSource } from "@/lib/extract";
import { randomId } from "@/lib/id";
import { AccessLevel, SourceKind } from "@/lib/types";

export const runtime = "nodejs";

export async function GET() {
  const db = getDB();
  return NextResponse.json({
    projectName: db.projectName,
    sources: db.sources.map((s) => ({
      id: s.id,
      name: s.name,
      kind: s.kind,
      accessLevel: s.accessLevel,
      author: s.author,
      importedAt: s.importedAt,
      chunks: db.chunks.filter((c) => c.sourceId === s.id).length,
      confirmedPermission: s.confirmedPermission,
      content: s.content, // reviewer-facing evidence inspector
    })),
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { name, kind, accessLevel, author, content, confirmedPermission } = body ?? {};
  if (!name || !content || typeof content !== "string") {
    return NextResponse.json({ error: "name and content are required" }, { status: 400 });
  }
  if (!confirmedPermission) {
    return NextResponse.json(
      { error: "You must confirm you are authorised to import this source." },
      { status: 400 }
    );
  }
  const db = getDB();
  const source = {
    id: randomId("src"),
    name: String(name),
    kind: (kind as SourceKind) ?? "doc",
    accessLevel: (accessLevel as AccessLevel) ?? "internal",
    author: String(author ?? "unknown"),
    importedAt: new Date().toISOString(),
    content: String(content),
    confirmedPermission: true,
  };
  db.sources.push(source);
  const chunks = chunkSource(source);
  db.chunks.push(...chunks);
  appendAudit(db, author ?? "user", "import-source", `Imported "${name}" (${source.accessLevel}, ${chunks.length} chunks)`);
  saveDB(db);
  return NextResponse.json({ id: source.id, chunks: chunks.length });
}
