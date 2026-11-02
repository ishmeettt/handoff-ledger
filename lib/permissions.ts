// Permission-first access control: filtering happens BEFORE anything is handed
// to a view. A restricted role never receives restricted chunks or claims in
// any API payload. Unknown sources fail CLOSED (review item S3-h).

import {
  AccessLevel,
  Claim,
  DB,
  RoleViewResult,
  Source,
  ACCESS_ORDER,
} from "./types";
import { Role, roleMaxLevel } from "./session";

export function allowedLevels(maxLevel: AccessLevel): AccessLevel[] {
  const max = ACCESS_ORDER[maxLevel];
  return (Object.keys(ACCESS_ORDER) as AccessLevel[]).filter(
    (l) => ACCESS_ORDER[l] <= max
  );
}

/** Sources the role may see. Used by /api/sources. */
export function filterSourcesForRole(db: DB, role: Role): Source[] {
  const allowed = allowedLevels(roleMaxLevel(role));
  return db.sources.filter((s) => allowed.includes(s.accessLevel));
}

/** Filter claims by the access level of the source they cite.
 * A claim citing a source above the role's level is EXCLUDED, not shown with
 * hidden details. Returns visible claims + the count of exclusions. */
export function filterClaims(
  claims: Claim[],
  sources: Source[],
  roleMax: AccessLevel
): RoleViewResult {
  const allowed = allowedLevels(roleMax);
  const levelBySource = new Map(sources.map((s) => [s.id, s.accessLevel]));
  const visible: Claim[] = [];
  let excluded = 0;
  for (const cl of claims) {
    const levels = cl.evidence.map((e) => levelBySource.get(e.sourceId));
    // unknown/deleted source -> treated as restricted (fail closed)
    const forbidden =
      cl.evidence.length > 0 &&
      levels.some((l) => !l || !allowed.includes(l));
    if (forbidden) {
      excluded++;
      continue;
    }
    visible.push({
      ...cl,
      evidence: cl.evidence.filter((e) => {
        const l = levelBySource.get(e.sourceId);
        return !!l && allowed.includes(l);
      }),
    });
  }
  return { visible, excludedCount: excluded };
}

// ---------- redaction (review item S2-5) ----------
// Specific provider patterns first, then a strict generic rule that requires
// an explicit separator AND a value mixing letters and digits (so ordinary
// phrases like "password infrastructure team" are NOT redacted).

const SPECIFIC_PATTERNS: RegExp[] = [
  // Stripe test/live keys (note: demo seed uses sk_test_FAKE...)
  /\b(?:sk|pk)_(?:live|test)_?[A-Za-z0-9_]{6,}\b/g,
  // GitHub tokens
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  // AWS access key IDs
  /\bAKIA[0-9A-Z]{16}\b/g,
  // Slack tokens
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/gi,
  // JWTs
  /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  // PEM private keys (incl. anything up to end marker, handled line-wise)
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  // Connection strings with credentials
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s@]+@[^\s]+/gi,
  // Authorization headers
  /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/g,
  // NOTE: no bare digit-pair pattern here — it redacted ordinary numbers
  // ("10000-20000", "8080 3000", "2026 12345"). Phones live in
  // PHONE_PATTERNS and run FIRST in redactSecrets().
];

// Phone numbers (review S2-5): Indian mobiles (5+5, optional +91) and
// international +CC numbers. Narrow on purpose — no bare digit runs, so dates
// and ids are never redacted.
const PHONE_PATTERNS: RegExp[] = [
  // Indian mobiles: optional "+91 " prefix consumed as part of the match so
  // "+91 98765 43210" becomes one [REDACTED-PHONE], not a stray "+".
  /(?:\+91[\s-]?)?\b[6-9]\d{4}[\s-]\d{5}\b/g,
  /\+\d{1,3}[\s-]?\(?\d{1,4}\)?(?:[\s-]\d{1,4}){1,3}\b/g,
];

// Generic: label, explicit separator (":" "=" or "is"), then a value of 8+
// chars that contains BOTH a letter and a digit (or symbol).
const GENERIC_SECRET =
  /\b(password|passwd|pwd|secret|token|api[_-]?key)\b\s*(?:is|=|:)\s*["']?(?=[^\s"']*\d)(?=[^\s"']*[A-Za-z])[^\s"']{8,}/gi;

export function redactSecrets(text: string): string {
  let out = text;
  // phones first: a full "+91 98765 43210" must become [REDACTED-PHONE]
  // before any other pattern gets a chance to mangle it
  for (const re of PHONE_PATTERNS) {
    out = out.replace(re, "[REDACTED-PHONE]");
  }
  for (const re of SPECIFIC_PATTERNS) {
    out = out.replace(re, "[REDACTED-CREDENTIAL]");
  }
  out = out.replace(GENERIC_SECRET, "$1=[REDACTED-CREDENTIAL]");
  // emails (documented demo exception: example.com addresses are fake and kept)
  out = out.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, (m) =>
    m.includes("example.com") ? m : "[REDACTED-EMAIL]"
  );
  return out;
}
