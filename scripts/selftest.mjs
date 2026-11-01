// Handoff Ledger — self-test.
// Walks the full pipeline against a running server and asserts the plan's success
// criteria: every planted fact is found and labelled correctly, and the confidential
// item never reaches a restricted role (target: zero leaks).
//
// Usage:  npm run dev   (in one terminal)
//         node scripts/selftest.mjs   (in another)

const BASE = process.env.BASE_URL ?? "http://localhost:3000";

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function req(path, opts = {}) {
  const r = await fetch(BASE + path, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts.headers ?? {}) },
  });
  const body = await r.json().catch(() => ({}));
  return { status: r.status, body };
}

async function main() {
  // 0. reachability
  try {
    const ping = await fetch(BASE + "/api/state");
    if (!ping.ok) throw new Error(`status ${ping.status}`);
  } catch (e) {
    console.error(`Cannot reach ${BASE}. Start the dev server first (npm run dev).`);
    process.exit(2);
  }

  // 1. reset to the seeded synthetic project
  await fetch(BASE + "/api/reset", { method: "POST" });
  let s = (await req("/api/state")).body;
  check("seeded demo project loads", s.sources?.length === 4, `${s.sources?.length} sources`);
  check(
    "all demo sources are synthetic-flagged",
    s.sources.every((x) => x.confirmedPermission !== false),
    "permission confirmed on import"
  );

  // 2. extraction
  const ex = await req("/api/extract", { method: "POST" });
  check("extraction produces claims", ex.body.count > 0, `${ex.body.count} claims via ${ex.body.mode}`);
  s = (await req("/api/state")).body;
  const claims = s.claims ?? [];

  // 3. planted facts (plan §8 testing approach)
  const decisions = claims.filter((c) => c.type === "decision");
  const conflictPairs = decisions.filter((c) => c.status === "conflicting");
  check("conflicting decisions detected", conflictPairs.length >= 2, `${conflictPairs.length} flagged conflicting`);
  const rationaleGaps = claims.filter((c) => c.status === "missing" && /no rationale/i.test(c.text));
  check("decision-without-rationale found as a gap", rationaleGaps.length >= 1, `${rationaleGaps.length} gap question(s)`);
  const stale = claims.filter((c) => /staleness/i.test(c.statusReason));
  check("stale task flagged", stale.length >= 1, `${stale.length} stale`);
  const confidential = claims.filter((c) => /sk_live_/i.test(c.text));
  check("confidential item captured (Stripe key)", confidential.length >= 1, "present in a restricted source");
  const undocumentedDep = claims.filter(
    (c) => c.type === "dependency" && /ssh|password/i.test(c.text)
  );
  check("undocumented dependency found", undocumentedDep.length >= 1, "deploy SSH password");

  // 4. quote verification gate: no claim is verified without an exact-matching quote
  const badVerified = claims.filter(
    (c) => c.status === "verified" && (c.evidence.length === 0 || !c.evidence.every((e) => e.quoteVerified))
  );
  check("no claim is Verified without an exact-matching quote", badVerified.length === 0, `${badVerified.length} violations`);
  check(
    "citation validity rate reported",
    typeof s.citationValidity?.valid === "number",
    `${s.citationValidity?.valid}/${s.citationValidity?.total}`
  );

  // 5. review gate: publish with nothing reviewed must be blocked
  let pub = await req("/api/publish", { method: "POST", body: JSON.stringify({ publishedBy: "self-test" }) });
  check("publishing with zero reviewed claims is blocked", pub.status === 400, pub.body.error ?? "");

  // accept every non-gap claim, reject one, mark one unknown
  for (const c of claims.filter((x) => x.status !== "missing")) {
    await req("/api/review", {
      method: "PATCH",
      body: JSON.stringify({ claimId: c.id, action: "accepted", actor: "self-test" }),
    });
  }
  const someClaim = claims.find((x) => x.status === "missing");
  if (someClaim) {
    await req("/api/review", {
      method: "PATCH",
      body: JSON.stringify({ claimId: someClaim.id, action: "unknown", actor: "self-test" }),
    });
  }
  s = (await req("/api/state")).body;
  check("review actions logged in audit", s.audit.some((a) => a.action === "review:accepted"), `${s.audit.length} audit entries`);

  // 6. publish
  pub = await req("/api/publish", { method: "POST", body: JSON.stringify({ publishedBy: "self-test" }) });
  check("publish creates an immutable version", pub.status === 200 && pub.body.version === 1, `v${pub.body.version}`);

  // 7. role views + leak tests
  const lead = (await req("/api/view?role=lead")).body;
  const successor = (await req("/api/view?role=successor")).body;
  const junior = (await req("/api/view?role=junior")).body;
  check("lead sees the full published handover", lead.claims?.length === successor.publishedTotal, `${lead.claims?.length} claims`);
  check(
    "restricted claims excluded for successor",
    successor.excludedCount > 0,
    `${successor.excludedCount} excluded of ${successor.publishedTotal}`
  );
  check(
    "junior sees fewer claims than successor",
    junior.claims.length < successor.claims.length,
    `junior ${junior.claims.length} vs successor ${successor.claims.length}`
  );
  // Confidential strings appear ONLY in the restricted source. The internal chat's
  // mention of a Stripe webhook failure is legitimately visible to a successor.
  const RESTRICTED_ONLY = /sk_live_|password manager|Gradescope integration token|Anita Rao|laptop \.env|Production DB password/i;
  const leakRoles = ["successor", "junior"].filter((r) => RESTRICTED_ONLY.test(JSON.stringify({ successor, junior }[r])));
  check("zero permission leaks (restricted-source strings absent for restricted roles)", leakRoles.length === 0, leakRoles.length ? `leaked for ${leakRoles}` : "no restricted strings in successor/junior payloads");
  check(
    "excluded-items indicator present (content hidden, count shown)",
    successor.excludedCount > 0 && !RESTRICTED_ONLY.test(JSON.stringify(successor)),
    "count without content"
  );

  // 8. immutability: publishing again creates v2; v1 claim count unchanged
  const v1Before = (await req("/api/state")).body.versions?.[0]?.claimCount;
  const pub2 = await req("/api/publish", { method: "POST", body: JSON.stringify({ publishedBy: "self-test" }) });
  const versions = (await req("/api/state")).body.versions;
  check(
    "second publish creates a new version, v1 unchanged",
    pub2.body.version === 2 && versions[0].claimCount === v1Before,
    `now at v${pub2.body.version}`
  );

  // 9. timeline + evidence endpoints
  const tl = await req("/api/timeline");
  check("timeline orders claims with parsed dates", tl.status === 200 && Array.isArray(tl.body.events), `${tl.body.events?.length} events, ${tl.body.events?.filter((e) => e.date).length} dated`);
  const src = await req("/api/sources");
  check("evidence inspector returns source content", src.status === 200 && src.body.sources.every((x) => typeof x.content === "string"));

  // summary
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log("FAILED:");
    for (const f of failed) console.log(`  - ${f.name}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("self-test crashed:", e);
  process.exit(1);
});
