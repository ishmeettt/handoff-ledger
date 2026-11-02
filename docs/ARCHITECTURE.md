# Handoff Ledger — Architecture (Round 2)

## The invariant

> Nothing reaches the incoming person that a reviewer has not approved, that lacks a
> checkable source, or that the role is not permitted to see.

Every component below exists to enforce one clause of that sentence.

## System diagram

```
                    ┌────────────────────────────────────────────────────┐
  AUTHORISED        │                  INGEST (step 1)                   │
  SOURCES ────────▶ │  /api/sources  · access level + permission confirm │
  (notes, chat,     └───────────────┬────────────────────────────────────┘
   task board, doc)                 │ chunking (char offsets preserved)
                                    ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                        PIPELINE (steps 2–3)                                  │
│  lib/extract.ts                                                              │
│   1. chunk each source                                                       │
│   2. extract claims (restricted sources: local heuristic only; else Groq     │
│      JSON-object output validated against the six allowed types, or the       │
│      deterministic heuristic fallback without a key)                          │
│   3. VERIFY: every quote must exist verbatim in its source (offsets recorded) │
│      — abstain otherwise — then a batched support check asks whether the      │
│      quote actually states the claim; Verified requires BOTH                 │
│   4. detect conflicts (candidate pairs verified by an LLM disagreement check; │
│      strict local option check when no key or restricted content is involved)│
│   5. detect staleness (old last-activity dates)                              │
│   6. detect gaps (missing types + decisions without rationale)               │
└───────────────┬──────────────────────────────────────────────────────────────┘
                ▼
        claims (status: verified | inferred | conflicting | missing)
                │
                ▼
┌──────────────────────────────────┐   ┌───────────────────────────────────────┐
│  HUMAN GATE (step 5)             │   │  GAP INTERVIEW (step 4)               │
│  /review · accept / edit /       │   │  every "missing" claim IS a targeted  │
│  reject / mark unknown           │   │  question for the departing member;  │
│  every action → audit log        │   │  answers become new claims (R3 flow)  │
└───────────────┬──────────────────┘   └───────────────────────────────────────┘
                ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  PUBLISH (step 6) — /api/publish                                             │
│  immutable versioned snapshot. ONLY reviewed claims (accepted/edited/unknown)│
│  and declared gaps are published. Unreviewed claims are held back.           │
└───────────────┬──────────────────────────────────────────────────────────────┘
                ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  SERVE (step 7) — /api/view · role from the signed session                    │
│  permission-first: claims whose evidence cites a source ABOVE the role's     │
│  level are removed BEFORE the response is built. The role sees a COUNT of    │
│  excluded items, never their content. Secrets are redacted as defense in     │
│  depth. Every listing endpoint (sources, state, timeline, view) applies the  │
│  same filter; no endpoint answers from restricted chunks for a junior role.  │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Data model

`Source → Chunk → Claim → Evidence → ReviewAction → HandoverVersion → AuditLog`

| Entity | Key property |
|---|---|
| Source | access level (`public`/`internal`/`restricted`) + confirmed permission |
| Chunk | char offsets into the source, so quotes stay verifiable |
| Claim | type, status (4 honest states), topic key, review state |
| Evidence | verbatim quote + `quoteVerified` (exact-match result) + char `start`/`end` offsets + `matchType` (exact vs normalized) |
| ReviewAction | who did what to which claim, when, why — the audit trail |
| HandoverVersion | immutable snapshot of approved claims at publish time |

Store: `lib/store.ts` — one JSON document per workspace stored in **D1
(SQLite)** on Cloudflare Workers, with a local JSON-file fallback when there is
no Cloudflare context (plain `next dev`). Saves are size-gated before the
write (413 near the row limit), failures surface as an honest 500 "Could not
save" — never a silent success — and only the last 5 published versions keep
full claim snapshots (older versions keep number/hash/time/note).

## The four statuses (never a confident guess)

| Status | Assigned when | Reviewer's lever |
|---|---|---|
| **Verified** | quote exists verbatim in the source AND a support check says the quote states the claim | accept |
| **Inferred** | extracted/reasoned, labelled as such (includes every heuristic claim and every restricted-source claim) | accept to confirm, or edit |
| **Conflicting** | a candidate pair (shared topic, competing options) verified as disagreeing — by the LLM check, or a strict local option check for restricted content / no key | accept one side, reject the other |
| **Missing** | expected knowledge has no evidence | mark unknown / answer in gap interview |

## Permission matrix

| Role | Sees | Never sees |
|---|---|---|
| Lead (reviewer) | public + internal + restricted | — |
| Successor | public + internal | restricted (excluded pre-generation) |
| Junior | public | internal + restricted (excluded pre-generation) |

Filtering happens in `lib/permissions.ts` **before** any view payload exists —
not as a UI hide. `redactSecrets()` masks credential-shaped strings as a second
layer even for roles that are allowed to see the source.

Authentication (`lib/session.ts`): every API route requires a signed httpOnly
session cookie (scrypt-hashed demo passwords, HMAC-signed payload, `Secure`
flag in production). The role is read from the session — never from the URL or
request body — and `actor` / `publishedBy` in the audit trail come from the
session user, so actions cannot be forged by the client. Failed logins are
rate-limited per username+IP (5 attempts → 60 s lockout, in-memory per
isolate).

## AI extraction (Groq) and its safety gate

`GROQ_API_KEY` → `openai/gpt-oss-120b` with a JSON-object response format
(validated in code: the six claim types only, quotes located verbatim in the
source or the claim is dropped — abstain-on-failure). The model is instructed
to copy quotes verbatim; the pipeline re-verifies every quote by exact match at
recorded offsets, then a batched support check confirms the quote actually
states the claim — **Verified requires both**. Without a key, a deterministic
heuristic extractor runs the same quote gate, so quote honesty is guaranteed by
code, not by the model.

**Data-handling policy (restricted sources):** a `restricted` source is never
sent to the external model — extraction runs the local heuristic, its claims are
excluded from the support check, and conflict pairs citing it are decided by the
local option check. The self-test asserts this.

## Self-test (`npm run selftest`)

Walks the whole flow against a running server and asserts the plan's success
criteria: all five planted facts found and labelled (and the decoy pair NOT
flagged as a conflict), no claim Verified without an exact quote AND a passed
support check, publish blocked with zero reviews, 401 without a session on
every endpoint, zero permission leaks across every endpoint for junior and
successor roles, the restricted-never-sent-to-the-model policy, session-derived
audit actors, immutable versions, timeline + evidence endpoints live.

## Rounds

- **Round 2 (this build):** import → extract → verify → review → publish → role views,
  plus timeline, evidence inspector, gap questions, audit log, self-test.
- **Round 3 (committed):** interactive gap-interview flow, permission-aware cited Q&A,
  version diff + acknowledgement tracking + evaluation scorecard, knowledge-risk map,
  repo-export import, Postgres+pgvector.
