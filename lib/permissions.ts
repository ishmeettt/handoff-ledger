// Permission-first access control: filtering happens BEFORE anything is handed to a view.
// A restricted role never receives restricted chunks or claims in any API payload.

import { AccessLevel, Claim, RoleViewResult, Source } from "./types";

const LEVEL_ORDER: Record<AccessLevel, number> = { public: 0, internal: 1, restricted: 2 };

export function allowedLevels(maxLevel: AccessLevel): AccessLevel[] {
  const max = LEVEL_ORDER[maxLevel];
  return (Object.keys(LEVEL_ORDER) as AccessLevel[]).filter((l) => LEVEL_ORDER[l] <= max);
}

/** Filter sources the role may see. */
export function filterSources(sources: Source[], roleMax: AccessLevel): Source[] {
  const allowed = allowedLevels(roleMax);
  return sources
    .filter((s) => allowed.includes(s.accessLevel))
    .map((s) => ({ ...s, content: "[content available to pipeline only]" }));
}

/**
 * Filter claims by the access level of the source they cite.
 * A claim citing a source above the role's level is EXCLUDED, not shown with hidden details.
 * Returns the visible claims plus a count of exclusions (the "excluded-items indicator").
 */
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
    // no evidence (a gap) → visible to every role; it leaks nothing
    const forbidden =
      cl.evidence.length > 0 && levels.some((l) => l && !allowed.includes(l));
    if (forbidden) {
      excluded++;
      continue;
    }
    // strip evidence chunks from sources the role may not read (defense in depth)
    visible.push({
      ...cl,
      evidence: cl.evidence.filter((e) => {
        const l = levelBySource.get(e.sourceId);
        return l && allowed.includes(l);
      }),
    });
  }
  return { visible, excludedCount: excluded };
}

export function redactSecrets(text: string): string {
  return text
    // Stripe-style keys: sk_live_…, sk_test_…, pk_live_…
    .replace(/\b(?:sk|pk)_(?:live|test)_?[A-Za-z0-9]{8,}\b/g, "[REDACTED-CREDENTIAL]")
    // generic credential assignments: api_key=…, token: …, secret …
    .replace(/\b(api[_-]?key|token|secret|password|credential)(?:\s*[:=]\s*|\s+)["']?[A-Za-z0-9/_-]{12,}/gi, "$1=[REDACTED-CREDENTIAL]")
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, (m) =>
      m.includes("example.com") ? m : "[REDACTED-EMAIL]"
    );
}
