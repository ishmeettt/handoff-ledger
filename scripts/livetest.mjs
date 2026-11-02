// Live-site acceptance tests from the fixes-only doc ("TESTS TO RUN ON THE
// LIVE SITE"). Run against a published URL:
//   BASE_URL=https://... node scripts/livetest.mjs
// Writes a markdown report to stdout; save into docs/TESTING.md.

const BASE = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
let pass = 0, fail = 0;
const results = [];

function check(name, ok, detail = "") {
  if (ok) pass++; else fail++;
  results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function req(path, { method = "GET", body, cookie } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (cookie) headers["Cookie"] = cookie;
  const r = await fetch(BASE + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  const setCookie = r.headers.get("set-cookie") ?? "";
  const token = /hl_session=([^;]+)/.exec(setCookie)?.[1];
  return { status: r.status, data, cookie: token ? `hl_session=${token}` : cookie };
}

async function login(username) {
  const r = await req("/api/auth/login", {
    method: "POST",
    body: { username, password: "handoff-demo" },
  });
  if (r.status !== 200) throw new Error(`login ${username}: ${r.status}`);
  return r.cookie;
}

async function main() {
  console.log(`# Live tests — ${BASE}\n`);

  // 1-3. no session -> 401
  for (const [p, m] of [["/api/sources", "GET"], ["/api/state", "GET"], ["/api/view?role=lead", "GET"]]) {
    const r = await req(p, { method: m });
    check(`no session ${m} ${p} -> 401`, r.status === 401, `got ${r.status}`);
  }

  // 4. junior session: filtered everywhere, no writes
  const lee = await login("lee");
  const leeSrc = await req("/api/sources?withContent=1", { cookie: lee });
  const srcText = JSON.stringify(leeSrc.data);
  check("junior /api/sources has no restricted source", !srcText.includes("Ops runbook") && !srcText.includes("CONFIDENTIAL"));
  check("junior /api/sources leaks no fake secret", !srcText.includes("sk_test_FAKE"));
  const leeTl = await req("/api/timeline", { cookie: lee });
  check("junior /api/timeline has no fake secret", !JSON.stringify(leeTl.data).includes("sk_test_FAKE"));
  const leeState = await req("/api/state", { cookie: lee });
  check("junior /api/state -> 403", leeState.status === 403, `got ${leeState.status}`);
  const leeReset = await req("/api/reset", { method: "POST", cookie: lee });
  check("junior /api/reset -> 403", leeReset.status === 403, `got ${leeReset.status}`);

  // 5. forged cookie
  const forged = await req("/api/sources", { cookie: "hl_session=abc.def" });
  check("forged cookie -> 401", forged.status === 401, `got ${forged.status}`);

  // 6. lead import validation
  const priya = await login("priya");
  const badLevel = await req("/api/sources", {
    method: "POST", cookie: priya,
    body: { name: "x", kind: "doc", accessLevel: "Public ", content: "y", confirmedPermission: true },
  });
  check("bad accessLevel -> 422", badLevel.status === 422, `got ${badLevel.status}`);
  const empty = await req("/api/sources", {
    method: "POST", cookie: priya,
    body: { name: "x2", kind: "doc", accessLevel: "public", content: "   ", confirmedPermission: true },
  });
  check("empty content -> 422", empty.status === 422, `got ${empty.status}`);
  const dupeContent = `livetest duplicate probe ${Date.now()}`;
  const first = await req("/api/sources", {
    method: "POST", cookie: priya,
    body: { name: `livetest-a-${Date.now()}`, kind: "doc", accessLevel: "public", content: dupeContent, confirmedPermission: true },
  });
  const dupe = await req("/api/sources", {
    method: "POST", cookie: priya,
    body: { name: `livetest-b-${Date.now()}`, kind: "doc", accessLevel: "public", content: dupeContent, confirmedPermission: true },
  });
  check("first import -> 200, duplicate -> 409", first.status === 200 && dupe.status === 409, `first=${first.status} dupe=${dupe.status}`);

  // 7. session secret: /api/auth/me 30x all 200 (a 401 means SESSION_SECRET
  //    is missing on this deployment and isolates disagree)
  let meOk = 0;
  for (let i = 0; i < 30; i++) {
    const r = await fetch(BASE + "/api/auth/me", { headers: { Cookie: priya } });
    if (r.status === 200) meOk++;
  }
  check("/api/auth/me 30/30 -> 200 (SESSION_SECRET set)", meOk === 30, `${meOk}/30`);

  // 8. 10 publishes + 150 KB import on the live store.
  // The clean demo state has ZERO reviewed claims (that is the intended
  // starting state — the publish gate must 400). Accept one claim first so
  // the publish loop tests what it means to test.
  const st = await req("/api/state", { cookie: priya });
  const claimList = st.data.claims ?? [];
  const firstPending = claimList.find((c) => c.reviewState === "pending");
  if (firstPending) {
    await req("/api/review", { method: "PATCH", cookie: priya, body: { claimId: firstPending.id, action: "accepted" } });
  }
  let pubOk = 0, lastVer = null, pubErr = "";
  for (let i = 0; i < 10; i++) {
    const r = await req("/api/publish", { method: "POST", cookie: priya, body: { note: `livetest publish ${i + 1}/10` } });
    if (r.status === 200) { pubOk++; lastVer = r.data.version; }
    else if (!pubErr) pubErr = `${r.status}: ${r.data.error ?? ""}`;
  }
  check("10 consecutive publishes succeed", pubOk === 10, `${pubOk}/10${pubOk < 10 ? ` (${pubErr})` : `, latest v${lastVer}`}`);
  // unique per run so the duplicate-content guard (409) does not trip on a re-run
  const big = `Run ${Date.now()}. The grader pipeline processes batch segments; each row carries a trace id. `.repeat(2000); // ~150 KB
  const bigImp = await req("/api/sources", {
    method: "POST", cookie: priya,
    body: { name: `livetest-150kb-${Date.now()}`, kind: "doc", accessLevel: "internal", content: big, confirmedPermission: true },
  });
  check("150 KB import succeeds under the production cap", bigImp.status === 200, `got ${bigImp.status} (${big.length} chars)`);

  // 9. timed re-extraction (Groq on the server)
  const t0 = Date.now();
  const ext = await req("/api/extract", { method: "POST", cookie: priya });
  const wall = ((Date.now() - t0) / 1000).toFixed(1);
  check("re-extraction succeeds on live", ext.status === 200, ext.status === 200
    ? `${ext.data.count} claims in ${wall}s wall (server ${((ext.data.durationMs ?? 0) / 1000).toFixed(1)}s), with: ${ext.data.extractorSummary}`
    : `got ${ext.status}: ${ext.data.error ?? ""}`);

  console.log(`\n${pass}/${pass + fail} live checks passed${fail ? `, ${fail} FAILED` : ""}`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
