// Handoff Ledger — data model
// Source → Chunk → Claim → Evidence → ReviewAction → HandoverVersion → AuditLog

export type AccessLevel = "public" | "internal" | "restricted";
export type SourceKind = "meeting-notes" | "chat-export" | "task-board" | "doc";
export type ClaimType =
  | "decision"
  | "owner"
  | "risk"
  | "dependency"
  | "open-question"
  | "contact";
export type ClaimStatus = "verified" | "inferred" | "conflicting" | "missing";
export type ReviewState = "pending" | "accepted" | "edited" | "rejected" | "unknown";
// support check verdict: does the quote actually say what the claim asserts?
export type SupportVerdict = "yes" | "partial" | "no" | "not-checked";

export interface Chunk {
  id: string;
  sourceId: string;
  idx: number;
  text: string;
  charStart: number;
  charEnd: number;
}

export interface Source {
  id: string;
  name: string;
  kind: SourceKind;
  accessLevel: AccessLevel;
  author: string;
  importedAt: string;
  /** When the notes/export were written. Used for timeline year inference.
   *  Defaults to importedAt and is then flagged as "assumed". */
  referenceDate: string;
  referenceDateAssumed: boolean;
  content: string;
  contentHash: string; // SHA-256, for duplicate detection
  confirmedPermission: boolean;
}

export interface Evidence {
  chunkId: string;
  sourceId: string;
  quote: string; // the EXACT source substring (model output is replaced by this)
  /** "exact" = character-perfect match; "normalized" = matches ignoring
   *  case/whitespace/curly quotes. Shown honestly in the UI. */
  matchType: "exact" | "normalized" | "none";
  quoteVerified: boolean; // matchType !== "none"
  charStart: number; // offsets into the ORIGINAL source content
  charEnd: number;
}

export interface Claim {
  id: string;
  type: ClaimType;
  text: string; // the claim statement itself
  topic: string; // grouping key for conflict detection
  status: ClaimStatus;
  confidence: number; // 0..1, only meaningful for inferred
  /** Does the quote support the claim? Separate from quote existence (S1-2). */
  supported: SupportVerdict;
  supportReason?: string; // model's reason when supported != not-checked
  extractedBy: "groq" | "heuristic";
  evidence: Evidence[];
  statusReason: string; // why this status was assigned
  stale?: boolean; // source mentions an old last-activity date
  reviewState: ReviewState;
  reviewNote?: string;
  originalText?: string; // preserved when a reviewer edits the claim
  conflictingWith?: string[]; // claim ids when status = conflicting
  createdAt: string;
}

export interface ReviewAction {
  id: string;
  claimId: string;
  action: ReviewState | "resolve"; // "resolve" = conflict-resolution pair of entries
  actor: string; // always the session user, never from the request body
  at: string;
  note?: string;
  before?: { text: string; status: ClaimStatus; reviewState: ReviewState };
  after?: { text: string; status: ClaimStatus; reviewState: ReviewState };
}

export interface AuditEntry {
  id: string;
  at: string;
  actor: string;
  action: string;
  detail: string;
}

export interface HandoverVersion {
  id: string;
  version: number;
  publishedAt: string;
  publishedBy: string;
  claims: Claim[]; // immutable snapshot
  note?: string;
  // SHA-256 of the snapshot claims (review S2-8): shown in the UI and
  // recomputable by anyone with the file to prove the snapshot was not edited
  hash?: string;
}

export interface DB {
  projectName: string;
  sources: Source[];
  chunks: Chunk[];
  claims: Claim[];
  reviews: ReviewAction[];
  versions: HandoverVersion[];
  audit: AuditEntry[];
  extractedAt: string | null;
}

export interface RoleViewResult {
  visible: Claim[];
  excludedCount: number;
}

export const ROLE_MATRIX: Record<string, { label: string; seeBelow: AccessLevel }> = {
  lead: { label: "Reviewer / project lead", seeBelow: "restricted" },
  successor: { label: "Incoming member (full successor)", seeBelow: "internal" },
  junior: { label: "Incoming member (restricted)", seeBelow: "public" },
};

export const ACCESS_ORDER: Record<AccessLevel, number> = {
  public: 0,
  internal: 1,
  restricted: 2,
};

export const VALID_KINDS: SourceKind[] = ["meeting-notes", "chat-export", "task-board", "doc"];
export const VALID_LEVELS: AccessLevel[] = ["public", "internal", "restricted"];
export const VALID_TYPES: ClaimType[] = [
  "decision",
  "owner",
  "risk",
  "dependency",
  "open-question",
  "contact",
];
