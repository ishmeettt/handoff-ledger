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
  content: string;
  confirmedPermission: boolean;
}

export interface Evidence {
  chunkId: string;
  sourceId: string;
  quote: string; // verbatim, exact-match verified against source
  quoteVerified: boolean;
}

export interface Claim {
  id: string;
  type: ClaimType;
  text: string; // the claim statement itself
  topic: string; // grouping key for conflict detection
  status: ClaimStatus;
  confidence: number; // 0..1, only meaningful for inferred
  evidence: Evidence[];
  statusReason: string; // why this status was assigned
  stale?: boolean; // source mentions an old last-activity date
  reviewState: ReviewState;
  reviewNote?: string;
  conflictingWith?: string[]; // claim ids when status = conflicting
  createdAt: string;
}

export interface ReviewAction {
  id: string;
  claimId: string;
  action: ReviewState;
  actor: string;
  at: string;
  note?: string;
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

export const ROLE_MATRIX: Record<string, { label: string; seeBelow: AccessLevel[] }> = {
  lead: { label: "Reviewer / project lead", seeBelow: ["public", "internal", "restricted"] },
  successor: { label: "Incoming member (full successor)", seeBelow: ["public", "internal"] },
  junior: { label: "Incoming member (restricted)", seeBelow: ["public"] },
};
