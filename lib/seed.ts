// Synthetic demo project with PLANTED FACTS (per plan §8 testing approach):
//  1. Two conflicting decisions (database: Postgres vs SQLite)
//  2. One decision without rationale (Postgres chosen — no "why" anywhere)
//  3. One stale task (auth refactor, untouched for 5 months)
//  4. One confidential item (Stripe live secret key — restricted source)
//  5. One undocumented dependency (Redis owned only by the departing member)

import { DB, Source } from "./types";
import { chunkSource } from "./extract";
import { appendAudit } from "./store";
import { randomId } from "./id";

export const SEED_SOURCES: Omit<Source, "id" | "importedAt">[] = [
  {
    name: "Standup notes — March sprint",
    kind: "meeting-notes",
    accessLevel: "internal",
    author: "Priya (lead)",
    confirmedPermission: true,
    content: `Weekly standup — March 14

Priya: Sprint goal is grading pipeline stability. We decided to use Postgres for the new grades table. Rahul will run the migration this week.
Rahul: Sounds good. Done — the migration script is merged.
Priya: Also decided — the grader service will own all writes to grades; the web app only reads through the API.
Mei: Who owns the deploy pipeline now?
Priya: Rahul owns deployment and the CI workflow. Ping him before merging to main.
Rahul: Careful — the staging environment has been flaky since the runner migration. Blocked on infra credits, might slip the demo.
Mei: Open question: do we still need the nightly regrade job? It costs 40 minutes of CI time.`,
  },
  {
    name: "Backend chat export — #eng (partial)",
    kind: "chat-export",
    accessLevel: "internal",
    author: "various",
    confirmedPermission: true,
    content: `#eng export, Feb 2 – Mar 10

<Feb 2> rahul: pushing the auth refactor to a branch, will finish next week
<Feb 9> mei: how's the auth refactor going? rahul?
<Feb 20> rahul: busy with the outage, will get back to it
<Mar 3> priya: rahul's auth branch is stale, do we revive it?
<Mar 4> mei: no idea why we chose Postgres over SQLite, ask rahul i think?
<Mar 4> priya: honestly i was leaning SQLite, someone just started the Postgres migration and it stuck
<Mar 4> rahul: i thought priya decided it, i just built it
<Mar 8> mei: the stripe webhook fails with 400 on every live order since tuesday
<Mar 8> rahul: yeah the signature check broke after the SDK upgrade
<Mar 9> priya: anyone has the deploy SSH password? rahul set it up and he's on leave
<Mar 9> rahul: it's in the shared vault, ask me when I'm back on the 15th`,
  },
  {
    name: "Task board export — Trello (archived)",
    kind: "task-board",
    accessLevel: "public",
    author: "board export",
    confirmedPermission: true,
    content: `BACKLOG
- Add CSV export for grades — owner: mei
- Docs refresh for onboarding — owner: priya
DONE
- Grades table migration (done, mar 6)
- Grader writes via API only (done, feb 28)
STALE / UNTOUCHED
- Refactor auth to OAuth2 — assigned to rahul — last activity: oct 12 (5 months ago)
- Nightly regrade job — owner: unassigned — open question: keep or kill?`,
  },
  {
    name: "Ops runbook — confidential extract",
    kind: "doc",
    accessLevel: "restricted",
    author: "Priya (lead)",
    confirmedPermission: true,
    content: `CONFIDENTIAL — do not share outside the core team

Payment setup: the live Stripe secret key is sk_live_51H8xQ2eZvKYlo2C00xRAbCdEfGhIjKlMnOpQrStUv and it is configured only on rahul's laptop .env; nobody else can rotate it.
Production DB password is stored in rahul's password manager only — this is a single point of failure.
Third-party: the Gradescope integration token expires Apr 30; renewal requires the department admin (contact: Dr. Anita Rao).`,
  },
];

export function seedIfEmpty(db: DB): DB {
  if (db.sources.length > 0) return db;
  for (const s of SEED_SOURCES) {
    const source: Source = {
      ...s,
      id: randomId("src"),
      importedAt: new Date().toISOString(),
    };
    db.sources.push(source);
    db.chunks.push(...chunkSource(source));
  }
  appendAudit(db, "system", "seed", "Seeded 4 synthetic sources with planted test facts.");
  return db;
}
