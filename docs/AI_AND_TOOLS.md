# AI and tools used in this build

Full disclosure of everything that produced this project (rule 7: name the
tool and keep the disclosure in the docs and commits).

## AI pair-programming

- **Codebuff** 🤖 — the AI agent that wrote the code, with human review of
  every change. Commit messages carry the same disclosure
  ("Generated with Codebuff").

## AI extraction (runtime, optional)

- **Groq API** (`https://api.groq.com/openai/v1/chat/completions`) — used only
  when `GROQ_API_KEY` is set, and only for **non-restricted** sources.
- Models, in fallback order: `openai/gpt-oss-120b` → `qwen/qwen3.8-27b` →
  `openai/gpt-oss-20b` (a 404 on the key's allowlist advances to the next).
- Used for: claim extraction (JSON-object output, validated in code against
  the six allowed claim types), the quote **support check**, and pairwise
  **conflict verdicts**. Statuses are always computed in code, never by the
  model.
- **Data policy:** `restricted` sources never leave the server — no model
  call ever receives them. Documented in `docs/ARCHITECTURE.md`.
- Without a key everything runs on the deterministic heuristic extractor; the
  self-test suite passes either way.

## Libraries and frameworks

| Tool | Licence | Purpose |
|---|---|---|
| Next.js 16 (App Router) | MIT | app framework, API routes |
| React 19 | MIT | UI |
| TypeScript 5 | Apache-2.0 | types |
| Vitest 5 | MIT | unit tests |
| Wrangler 4 / @opennextjs/cloudflare | MIT / MIT | Cloudflare Workers build & local dev |
| Cloudflare D1 | service | production store (SQLite documents) |

No UI component library — the interface is hand-written CSS
(`app/globals.css`).

## Design

- **Adminator 4** admin dashboard (MIT) —
  <https://github.com/puikinsh/Adminator-admin-dashboard> — its token
  system and layout patterns were adapted into the HUD theme.
- **Fonts:** Inter and JetBrains Mono (both SIL Open Font License), loaded
  from Google Fonts in `<head>`.

## Wallpapers

`public/hud-frame.png`, `public/login-frame.png`, `public/hud-capsule.png`
and `public/login-frame.png` are sci-fi HUD artwork supplied by the project
owner (from their own reference images) for this project. Not third-party
stock; rights remain with the owner.

## Data

Every source, claim, name and secret in the demo is **synthetic**, created
during the build. The "Stripe key" in the restricted source is deliberately
not a valid shape (`sk_test_FAKE_DEMO_KEY_00000000`).
