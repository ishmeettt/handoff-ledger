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
│   2. extract claims (Groq JSON-schema OR deterministic heuristic fallback)   │
│   3. VERIFY: every quote must exact-match its source — abstain otherwise     │
│   4. detect conflicts (disagreeing decision statements)                      │
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
│  every action → audit log        │   │  their answer becomes a new claim     │
└───────────────┬──────────────────┘   └───────────────────────────────────────┘
                ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  PUBLISH (step 6) — /api/publish                                             │
│  immutable versioned snapshot. ONLY reviewed claims (accepted/edited/unknown)│
│  and declared gaps are published. Unreviewed claims are held back.           │
└───────────────┬──────────────────────────────────────────────────────────────┘
                ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  SERVE (step 7) — /api/view?role=                                            │
│  permission-first: claims whose evidence cites a source ABOVE the role's     │
│  level are removed BEFORE the response is built. The role sees a COUNT of    │
│  excluded items, never their content. Secrets are redacted as defense in     │
│  depth. Q&A / views answer only from the permitted chunks.                   │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Data model

`Source → Chunk → Claim → Evidence → ReviewAction → HandoverVersion → AuditLog`

| Entity | Key property |
|---|---|
| Source | access level (`public`/`internal`/`restricted`) + confirmed permission |
| Chunk | char offsets into the source, so quotes stay verifiable |
| Claim | type, status (4 honest states), topic key, review state |
| Evidence | verbatim quote + `quoteVerified` (exact-match result) |
| ReviewAction | who did what to which claim, when, why — the audit trail |
| HandoverVersion | immutable snapshot of approved claims at publish time |

Store: JSON file (`data/db.json`) behind `lib/store.ts` — the shape matches the
plan's Postgres target, so the Round 3 swap is mechanical.

## The four statuses (never a confident guess)

| Status | Assigned when | Reviewer's lever |
|---|---|---|
| **Verified** | quote exists verbatim in the source and supports the claim | accept |
| **Inferred** | extracted/reasoned, labelled as such | accept to confirm, or edit |
| **Conflicting** | ≥2 decision statements disagree on a shared topic | accept one side, reject the other |
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

## AI extraction (Groq) and its safety gate

`GROQ_API_KEY` → `llama-3.3-70b-versatile` with a JSON response format. The model
is instructed to copy quotes verbatim; the pipeline then re-verifies every quote by
exact match and **drops any claim whose quote cannot be found** (abstain-on-failure).
Without a key, a deterministic heuristic extractor runs the same verification gate —
so quote honesty is guaranteed by code, not by the model.

## Self-test (`npm run selftest`)

Walks the whole flow against a running server and asserts the plan's success
criteria: all five planted facts found and labelled, no claim Verified without an
exact quote, publish blocked with zero reviews, zero permission leaks for
confidential strings, immutable versions, timeline + evidence endpoints live.

## Rounds

- **Round 2 (this build):** import → extract → verify → review → publish → role views,
  plus timeline, evidence inspector, gap questions, audit log, self-test.
- **Round 3 (committed):** interactive gap-interview flow, permission-aware cited Q&A,
  version diff + acknowledgement tracking + evaluation scorecard, knowledge-risk map,
  repo-export import, Postgres+pgvector.
