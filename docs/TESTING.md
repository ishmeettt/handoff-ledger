# Testing

Three layers of tests, all green at the time of this writing.

## 1. Unit tests (vitest)

```
npm test          # vitest run
npx tsc --noEmit  # type check
```

Covers redaction (ordinary numbers untouched, real secrets masked), timeline
year inference (future dates, relative dates, missing claims skipped), chunking,
quote location, status assignment, prompt-injection filtering, stable keys and
review preservation across re-extraction.

## 2. End-to-end self-test (scripts/selftest.mjs)

```
BASE_URL=https://<site> node scripts/selftest.mjs
```

Walks the full flow against a running deployment: authentication and role
filtering on every endpoint, extraction, planted-fact recall (conflict, missing
rationale, stale item), honest statuses, the review gate, conflict resolution,
publish snapshots, audit trail, reset behaviour and the handover plan.
**Result: 58/58 checks passed** on both preview and production.

## 3. Live acceptance tests (scripts/livetest.mjs)

The "TESTS TO RUN ON THE LIVE SITE" list from the code review, automated:

```
BASE_URL=https://<site> node scripts/livetest.mjs
```

Run against production (https://site-33806628e9554e34946540809e2ba016.freebuff.page):

```
# Live tests — https://site-33806628e9554e34946540809e2ba016.freebuff.page

PASS  no session GET /api/sources -> 401 — got 401
PASS  no session GET /api/state -> 401 — got 401
PASS  no session GET /api/view?role=lead -> 401 — got 401
PASS  junior /api/sources has no restricted source
PASS  junior /api/sources leaks no fake secret
PASS  junior /api/timeline has no fake secret
PASS  junior /api/state -> 403 — got 403
PASS  junior /api/reset -> 403 — got 403
PASS  forged cookie -> 401 — got 401
PASS  bad accessLevel -> 422 — got 422
PASS  empty content -> 422 — got 422
PASS  first import -> 200, duplicate -> 409 — first=200 dupe=409
PASS  /api/auth/me 30/30 -> 200 (SESSION_SECRET set) — 30/30
PASS  10 consecutive publishes succeed — 10/10, latest v21
PASS  150 KB import succeeds under the production cap — got 200 (188000 chars)
PASS  re-extraction succeeds on live — 35 claims in 132.5s wall (server 131.5s), with: openai/gpt-oss-120b + heuristic pattern floor

16/16 live checks passed
```

Notes on individual checks:

- **Session secret (30/30)**: every `/api/auth/me` call returns 200, so the
  cookie signature key is set on the deployment — isolates agree and nobody
  gets random sign-outs.
- **Publish gate**: the clean demo state has zero reviewed claims, so the
  livetest accepts one claim before the publish loop. Publishing with zero
  reviewed claims returns 400 (asserted in the self-test).
- **Duplicate import**: the same content twice returns 409 (SHA-256 content
  hash), including on a re-run of the 150 KB payload.
- **Re-extraction timing**: 54–132 s wall on production with the Groq model
  (openai/gpt-oss-120b) plus the heuristic floor. The model is called only for
  non-restricted sources; restricted claims are processed locally and marked
  "not checked by the model". The UI shows per-step progress while it runs.

## 4. Browser checks (production)

- Dashboard, review board, timeline, handover view render with no console
  errors (only the expected 401 from the session probe when signed out).
- Sign-in and sign-out land cleanly on `/login` with no redirect loop.
- Workflow stepper shows the live stage counts (Connect 4 sources /
  Reconstruct 23 claims / Verify 21 of 21 quotes / Review 21 pending /
  Handover v1).
- Screenshots in `screenshots/` are captured from the production build.
