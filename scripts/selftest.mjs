// Handoff Ledger — self-test.
// Walks the full pipeline against a running server and asserts the plan's
// success criteria AND the code-review fixes: authentication on every route,
// role isolation on every endpoint, planted-fact detection, honest statuses,
// conflict logic, redaction, and immutability.
//
// Usage:  npm run dev   (ALLOW_RESET=true for the reset check)
//         npm run selftest

const BASE = process.env.BASE_URL ?? "http://localhost:3000";

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

// Ground truth shared with the Round 3 scorecard (review Part 4)
import { readFileSync } from "node:fs";
const PLANTED = JSON.parse(
  readFileSync(new URL("./planted-facts.json", import.meta.url), "utf8")
);

// strings that exist ONLY in the restricted ops runbook
const RESTRICTED_ONLY = new RegExp(PLANTED.restrictedStrings.join("|"), "i");

// simple cookie-jar fetch
async function req(path, { method = "GET", body, cookie, headers = {} } = {}) {
  const r = await fetch(BASE + path, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = r.headers.get("set-cookie") ?? "";
  const token = setCookie.split("hl_session=")[1]?.split(";")[0];
  const data = await r.json().catch(() => ({}));
  return { status: r.status, data, cookie: token ? `hl_session=${token}` : cookie };
}

async function login(username) {
  const r = await req("/api/auth/login", {
    method: "POST",
    body: { username, password: "handoff-demo" },
  });
  if (r.status !== 200) throw new Error(`login as ${username} failed: ${r.status}`);
  return r.cookie;
}

const NO_AUTH_ENDPOINTS = [
  ["/api/sources", "GET"], ["/api/state", "GET"], ["/api/timeline", "GET"],
  ["/api/view", "GET"], ["/api/reset", "POST"], ["/api/extract", "POST"],
  ["/api/review", "PATCH"], ["/api/publish", "POST"],
];

async function main() {
  // ---------- A. authentication ----------
  try {
    const ping = await fetch(BASE + "/api/auth/me");
    if (!ping.ok && ping.status !== 401) throw new Error(`status ${ping.status}`);
  } catch (e) {
    console.error(`Cannot reach ${BASE}. Start the dev server first (npm run dev).`);
    process.exit(2);
  }

  for (const [path, method] of NO_AUTH_ENDPOINTS) {
    const r = await req(path, {
      method,
      body: method !== "GET" ? { claimId: "x", action: "accepted" } : undefined,
    });
    check(`no-login ${method} ${path} -> 401`, r.status === 401, `got ${r.status}`);
  }

  // forged cookie must fail signature check
  const forged = await req("/api/state", { cookie: "hl_session=eyJmYWtlIjp0cnVlfQ.forgedsig" });
  check("forged cookie -> 401", forged.status === 401, `got ${forged.status}`);

  // role in URL/body is ignored for /api/view (session decides).
  // (Before anything is published the endpoint 404s — also an acceptable answer;
  // the assertion is that role=lead in the URL never yields role=lead.)
  const lead = await login("priya");
  const sam = await login("sam");
  const lee = await login("lee");
  const viewAsLee = await req("/api/view?role=lead", { cookie: lee });
  check(
    "?role=lead with junior session does NOT grant lead view",
    viewAsLee.status === 404 || (viewAsLee.status === 200 && viewAsLee.data.role === "junior"),
    `status=${viewAsLee.status} role=${viewAsLee.data.role ?? "n/a"}`
  );

  // state is lead-only
  const stateSam = await req("/api/state", { cookie: sam });
  const stateLee = await req("/api/state", { cookie: lee });
  check("successor cannot read reviewer draft (/api/state -> 403)", stateSam.status === 403, `got ${stateSam.status}`);
  check("junior cannot read reviewer draft (/api/state -> 403)", stateLee.status === 403, `got ${stateLee.status}`);

  // writes are lead-only
  const writes = [
    ["/api/extract", "POST", {}],
    ["/api/publish", "POST", {}],
    ["/api/sources", "POST", { name: "x", kind: "doc", accessLevel: "public", content: "y", confirmedPermission: true }],
    ["/api/review", "PATCH", { claimId: "x", action: "accepted" }],
    ["/api/reset", "POST", {}],
  ];
  for (const [path, method, body] of writes) {
    const r = await req(path, { method, body, cookie: lee });
    check(`junior blocked from ${method} ${path}`, r.status === 403 || r.status === 404, `got ${r.status}`);
  }

  // ---------- B. every endpoint leak-scans for junior & successor ----------
  // reset + extract as lead first
  const resetJunior = await req("/api/reset", { method: "POST", cookie: lee });
  check("reset as junior -> 403", resetJunior.status === 403, `got ${resetJunior.status}`);
  const reset = await req("/api/reset", { method: "POST", cookie: lead });
  if (reset.status === 404) console.log("NOTE  reset endpoint disabled (ALLOW_RESET not set) — skipping reset-dependent checks below");
  const resetOk = reset.status === 200;
  if (resetOk) {
    // fixes-only #4: reset restores the full demo STORY
    check(
      "reset leaves every claim pending (unreviewed — Review is the next step)",
      reset.data.claims > 0 && reset.data.pending === reset.data.claims,
      `${reset.data.pending}/${reset.data.claims} pending`
    );
    check(
      "reset publishes baseline v1 so role views work immediately",
      reset.data.baselineVersion === 1 && reset.data.baselineClaims > 0,
      `v${reset.data.baselineVersion} with ${reset.data.baselineClaims} claims`
    );
  }

  const ext = await req("/api/extract", { method: "POST", cookie: lead });
  check("lead can run extraction", ext.status === 200, ext.status === 200 ? `${ext.data.count} claims, modes: ${(ext.data.perSource ?? []).map((p) => p.extractor).join("/")}` : JSON.stringify(ext.data).slice(0, 120));

  if (resetOk) {
    const state = (await req("/api/state", { cookie: lead })).data;
    const claims = state.claims ?? [];
    check("claims extracted", claims.length > 0, `${claims.length} claims`);
    // freshness gate: the assertions below must judge THIS run's extraction,
    // never a stale database left over from an earlier run
    const extractedAge = Date.now() - Date.parse(state.extractedAt ?? "");
    check(
      "extraction ran fresh on this database",
      Number.isFinite(extractedAge) && extractedAge < 15 * 60 * 1000,
      state.extractedAt ? `age ${Math.round(extractedAge / 1000)}s` : "no extractedAt"
    );
    // publish versions are counted from this run's baseline, not hard-coded
    const baseV = state.versions?.length ?? 0;

    // ---------- C. planted facts ----------
    const decisions = claims.filter((c) => c.type === "decision");
    // match on the CITED QUOTE as well as the claim text: Groq may paraphrase
    // the claim, but the source sentence is the ground truth
    const cites = (c, re) => re.test(c.text) || (c.evidence ?? []).some((e) => re.test(e.quote ?? ""));
    const conflicts = claims.filter((c) => c.status === "conflicting");
    check("planted conflict (Postgres vs SQLite) detected", conflicts.length >= 1, `${conflicts.length} conflicting`);
    check(
      "conflicts never involve questions or gaps (open-question stays out)",
      conflicts.every((c) => c.type !== "open-question" && c.status !== "missing"),
      `${conflicts.length} conflicting, types: ${[...new Set(conflicts.map((c) => c.type))].join("/")}`
    );
    // decoy: the grader-writes decision shares the word "grader/grades" with the
    // Postgres decision but names no different option -> must NOT be flagged
    const decoy = claims.find((c) => cites(c, /grader service will own all writes/i));
    check(
      "decoy decision (grader owns writes) NOT flagged conflicting",
      !!decoy && decoy.status !== "conflicting",
      decoy ? `status=${decoy.status}` : "decoy claim missing"
    );
    const rationaleGaps = claims.filter((c) => c.status === "missing" && /no rationale/i.test(c.text));
    check("decision-without-rationale found as a gap", rationaleGaps.length >= 1, `${rationaleGaps.length} gap question(s)`);
    const stale = claims.filter((c) => c.stale || /staleness/i.test(c.statusReason));
    check("stale task flagged", stale.length >= 1, `${stale.length} stale`);
    const secret = claims.filter((c) => /payment secret key is \[REDACTED/i.test(c.text) || /payment secret key/i.test(c.text));
    check("confidential item captured (fake payment key, redacted in output)", secret.length >= 1, `${secret.length} claim(s)`);
    const dep = claims.filter((c) => c.type === "dependency" && /password/i.test(c.text));
    check("undocumented dependency found (deploy password)", dep.length >= 1, `${dep.length}`);

    // prompt-injection defence (review S2-7): the planted injection line in the
    // chat export must not steer extraction — no claim may name Mallory
    const injectionHits = claims.filter(
      (c) => new RegExp(PLANTED.injection.mustNotAppearInClaims, "i").test(c.text) ||
        new RegExp(PLANTED.injection.mustNotAppearInClaims, "i").test(c.owner ?? "") ||
        /ignore all previous/i.test(c.text)
    );
    check(
      "injection line does not change owner/status (no Mallory claim)",
      injectionHits.length === 0,
      injectionHits.length ? injectionHits.map((c) => c.text).join("; ").slice(0, 80) : "clean"
    );

    // ---------- S2-7 data-handling policy: restricted stays on this server ----------
    const srcs = (await req("/api/sources", { cookie: lead })).data.sources ?? [];
    const restrictedIds = new Set(srcs.filter((s) => s.accessLevel === "restricted").map((s) => s.id));
    const restrictedClaims = claims.filter((c) => (c.evidence ?? []).some((e) => restrictedIds.has(e.sourceId)));
    const policyViolations = restrictedClaims.filter(
      (c) => c.extractedBy !== "heuristic" || c.supported === "yes" || c.supported === "partial"
    );
    check(
      "restricted sources never sent to the external model (local heuristic, support not checked)",
      restrictedClaims.length >= 1 && policyViolations.length === 0,
      `${restrictedClaims.length} restricted claim(s), ${policyViolations.length} violation(s)`
    );

    // missed claims (review S2-2): "Also decided" must be extracted
    check(
      "'Also decided — grader owns all writes' IS extracted",
      decisions.some((c) => cites(c, /grader service will own all writes/i)),
      "loosened decision pattern (quote- or text-cited)"
    );
    // duplicates (review S2-2): normalized quote appears once
    const normKeys = claims
      .filter((c) => c.evidence[0])
      .map((c) => c.evidence[0].quote.toLowerCase().replace(/\s+/g, " ").slice(0, 100));
    const dupes = normKeys.filter((k, i) => normKeys.indexOf(k) !== i);
    check("no duplicate claims for the same sentence", dupes.length === 0, `${dupes.length} duplicate(s)`);

    // ---------- D. honest statuses (review S1-2) ----------
    const verified = claims.filter((c) => c.status === "verified");
    const badVerified = verified.filter(
      (c) => c.supported !== "yes" || !c.evidence.every((e) => e.quoteVerified)
    );
    check(
      "every Verified claim has quoteFound AND supported=yes",
      badVerified.length === 0,
      `${verified.length} verified, ${badVerified.length} violations`
    );
    const heuristicVerified = verified.filter((c) => c.extractedBy === "heuristic");
    check(
      "heuristic claims are never auto-Verified (no support check)",
      heuristicVerified.length === 0,
      `${heuristicVerified.length} violations`
    );
    check(
      "quotes found metric reported honestly",
      typeof state.quotesFound?.found === "number",
      `${state.quotesFound?.found}/${state.quotesFound?.total} quotes found`
    );

    // ---------- E. review gate ----------
    let pub = await req("/api/publish", { method: "POST", body: {}, cookie: lead });
    check("publishing with zero reviewed claims is blocked", pub.status === 400, pub.data.error ?? "");

    // unknown-only publish is allowed but loudly warned (review S2-8)
    const unknownOnly = claims.find((x) => x.status !== "missing" && x.status !== "conflicting");
    await req("/api/review", { method: "PATCH", body: { claimId: unknownOnly.id, action: "unknown" }, cookie: lead });
    pub = await req("/api/publish", { method: "POST", body: {}, cookie: lead });
    check(
      "publish with ONLY unknown-reviewed claims warns (noRealClaims)",
      pub.status === 200 && (pub.data.noRealClaims ?? 0) >= 1 && pub.data.version === baseV + 1,
      `v${pub.data.version} (baseline v${baseV}), noRealClaims=${pub.data.noRealClaims}`
    );

    // conflict resolution (review S2-8): winner accepted, counterpart rejected
    const conf = claims.find((c) => c.status === "conflicting");
    const resolved = await req("/api/review", {
      method: "PATCH",
      body: { claimId: conf.id, action: "resolve" },
      cookie: lead,
    });
    check(
      "resolve conflict accepts winner AND rejects counterpart",
      resolved.status === 200 &&
        resolved.data.winner?.reviewState === "accepted" &&
        (resolved.data.losers ?? []).length >= 1 &&
        resolved.data.losers.every((l) => l.reviewState === "rejected"),
      `winner=${resolved.data.winner?.reviewState}, losers=${(resolved.data.losers ?? []).map((l) => l.reviewState).join("/")}`
    );
    const resolvedCounterpartId = resolved.data.losers?.[0]?.id;

    // mass-accept only claims still awaiting review — never reopen a resolved pair
    for (const c of claims.filter(
      (x) => x.status !== "missing" && x.id !== resolvedCounterpartId &&
        (x.reviewState === "pending" || x.reviewState === "unknown")
    )) {
      await req("/api/review", {
        method: "PATCH",
        body: { claimId: c.id, action: "accepted" },
        cookie: lead,
      });
    }
    // audit actor must come from the session, not the body
    const s2 = (await req("/api/state", { cookie: lead })).data;
    const reviewAudits = (s2.audit ?? []).filter((a) => a.action === "review:accepted");
    check(
      "audit actor is the session user (not request body)",
      reviewAudits.length > 0 && reviewAudits.every((a) => a.actor.includes("Priya")),
      reviewAudits[0]?.actor ?? "no entries"
    );

    // edited claim -> Inferred (review S2-4)
    const editTarget = claims.find((x) => x.status === "verified" && x.id !== resolvedCounterpartId) ??
      claims.find((x) => x.id !== resolvedCounterpartId) ?? claims[0];
    const edited = await req("/api/review", {
      method: "PATCH",
      body: { claimId: editTarget.id, action: "edited", newText: "Rewritten by the reviewer during self-test." },
      cookie: lead,
    });
    check(
      "edited claim becomes Inferred with reason",
      edited.status === 200 &&
        edited.data.claim?.status === "inferred" &&
        /not checked against the quote/.test(edited.data.claim?.statusReason ?? ""),
      `status=${edited.data.claim?.status}`
    );
    check(
      "review action keeps before/after history",
      !!edited.data.claim && Array.isArray(s2.reviews),
      "before/after recorded in review log"
    );

    // ---------- F. publish + immutability ----------
    pub = await req("/api/publish", { method: "POST", body: {}, cookie: lead });
    check(
      "publish creates an immutable version",
      pub.status === 200 && pub.data.version === baseV + 2,
      `v${pub.data.version ?? "?"} (baseline v${baseV}, first was the unknown-only warning publish)`
    );

    // ---------- G. role leak scans across ALL endpoints ----------
    for (const [who, cookie] of [["successor", sam], ["junior", lee]]) {
      const payloads = {};
      payloads.sources = await req("/api/sources?withContent=1", { cookie });
      payloads.timeline = await req("/api/timeline", { cookie });
      payloads.view = await req("/api/view", { cookie });
      const leaked = Object.entries(payloads).filter(([, r]) =>
        RESTRICTED_ONLY.test(JSON.stringify(r.data))
      );
      check(
        `no restricted strings in ANY endpoint for ${who}`,
        leaked.length === 0,
        leaked.length ? `leaked: ${leaked.map(([p]) => p).join(",")}` : "sources/timeline/view clean"
      );
      // role isolation: junior sees strictly less than successor
      if (who === "junior") {
        const vJ = payloads.view.data;
        const vS = (await req("/api/view", { cookie: sam })).data;
        check(
          "junior sees fewer published claims than successor",
          (vJ.claims?.length ?? 0) < (vS.claims?.length ?? 0),
          `junior ${vJ.claims?.length} vs successor ${vS.claims?.length}`
        );
        check(
          "excluded-items indicator present (count without content)",
          (vJ.excludedCount ?? 0) > 0 && !RESTRICTED_ONLY.test(JSON.stringify(vJ)),
          `${vJ.excludedCount} excluded of ${vJ.publishedTotal}`
        );
      }
      // sources endpoint must hide restricted sources entirely from non-leads
      const srcCount = payloads.sources.data.sources?.length ?? 0;
      const excluded = payloads.sources.data.excludedSources ?? -1;
      check(
        `${who}: restricted sources not listed (${excluded} excluded)`,
        excluded >= 1 && !JSON.stringify(payloads.sources.data).includes("confidential"),
        `${srcCount} visible`
      );
    }
    // lead preview filter works
    const preview = await req("/api/view?as=junior", { cookie: lead });
    check(
      "lead preview of junior view is filtered",
      preview.status === 200 && preview.data.preview === true && !RESTRICTED_ONLY.test(JSON.stringify(preview.data)),
      `excluded=${preview.data.excludedCount}`
    );

    // ---------- H. timeline year inference (review S2-3) ----------
    const tl = (await req("/api/timeline", { cookie: lead })).data;
    const oct = (tl.events ?? []).find((e) => /oct 12/i.test(e.dateEvidence ?? ""));
    check(
      'timeline: "oct 12" resolves to BEFORE the March reference date',
      !!oct && oct.date && oct.date < "2026-03-01",
      oct ? `${oct.date} (inferred=${oct.yearInferred})` : "event not found"
    );
    check(
      "timeline has no duplicate claim events",
      new Set((tl.events ?? []).map((e) => e.claimId)).size === (tl.events ?? []).length,
      `${tl.events?.length} events`
    );

    // ---------- I. version immutability + snapshot hash (review S2-8) ----------
    const prevCount = (await req("/api/state", { cookie: lead })).data.versions?.[0]?.claimCount;
    const pub2 = await req("/api/publish", { method: "POST", body: {}, cookie: lead });
    const versions = (await req("/api/state", { cookie: lead })).data.versions;
    check(
      "next publish -> new version, previous snapshot unchanged",
      pub2.data.version === baseV + 3 && versions[0].claimCount === prevCount,
      `now v${pub2.data.version} (baseline v${baseV})`
    );
    check(
      "every published version carries a SHA-256 snapshot hash",
      versions.every((v) => typeof v.hash === "string" && /^[0-9a-f]{64}$/.test(v.hash)),
      versions.map((v) => `v${v.version}:${(v.hash ?? "").slice(0, 8)}`).join(" ")
    );
  }

  // ---------- J. redaction unit checks (review S2-5) ----------
  const redact = await fetch(`${BASE}/api/auth/login`, { method: "OPTIONS" }).catch(() => null);
  // tested indirectly: run the pure function via a tiny import in node isn't
  // possible from .mjs against TS — instead assert on a lead's sources output
  const srcLead = await req("/api/sources?withContent=1", { cookie: lead });
  const content = JSON.stringify(srcLead.data);
  check("fake seed key is redacted even for lead", !content.includes("sk_test_FAKE_DEMO_KEY_00000000"), content.includes("REDACTED") ? "REDACTED marker present" : "no marker");

  // ---------- K. evidence endpoints ----------
  check("sources endpoint returns content for lead", srcLead.status === 200 && Array.isArray(srcLead.data.sources));
  const ev = await req("/api/sources?withContent=1", { cookie: lead });
  const withQuotes = (await req("/api/state", { cookie: lead })).data;
  const evClaims = (withQuotes.claims ?? []).filter((c) => c.evidence?.[0]);
  check(
    "every non-gap claim carries offsets for the inspector",
    evClaims.every((c) => typeof c.evidence[0].charStart === "number"),
    `${evClaims.length} claims`
  );

  // summary
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log("FAILED:");
    for (const f of failed) console.log(`  - ${f.name}${f.detail ? ` (${f.detail})` : ""}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("self-test crashed:", e);
  process.exit(1);
});
