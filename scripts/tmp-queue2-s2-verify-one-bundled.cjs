"use strict";

// scripts/tmp-queue2-s2-verify-one.cjs
var CL_BASE = "https://www.courtlistener.com/api/rest/v4";
var id = (process.argv[2] || "").trim().toLowerCase();
var state = process.argv[3] || "?";
var role = process.argv[4] || "unknown";
async function main() {
  if (!id) {
    console.log(JSON.stringify({ ok: false, reason: "id_required", courtListenerHttpCalls: 0 }));
    process.exit(2);
  }
  const key = process.env.COURTLISTENER_API_KEY;
  if (!key) {
    console.log(JSON.stringify({ ok: false, reason: "no_key", courtListenerHttpCalls: 0 }));
    process.exit(2);
  }
  let calls = 0;
  const headers = { Authorization: `Token ${key}`, Accept: "application/json" };
  const cres = await fetch(`${CL_BASE}/courts/${encodeURIComponent(id)}/`, {
    headers,
    signal: AbortSignal.timeout(25e3)
  });
  calls += 1;
  if (cres.status === 429) {
    console.log(JSON.stringify({ ok: false, id, state, role, mappingStatus: "BLOCKED", httpStatus: 429, courtListenerHttpCalls: calls }));
    process.exit(1);
  }
  if (cres.status === 404) {
    console.log(JSON.stringify({ ok: true, id, state, role, mappingStatus: "NO_USABLE_CL_COURT", httpStatus: 404, courtListenerHttpCalls: calls }));
    return;
  }
  const body = await cres.json().catch(() => null);
  let mappingStatus = cres.status === 200 && body?.full_name ? "VERIFIED" : "AMBIGUOUS";
  let opinionSample = null;
  if (mappingStatus === "VERIFIED") {
    await new Promise((r) => setTimeout(r, 2200));
    const oRes = await fetch(
      `${CL_BASE}/opinions/?cluster__docket__court=${encodeURIComponent(id)}&page_size=1&order_by=-id`,
      { headers, signal: AbortSignal.timeout(25e3) }
    );
    calls += 1;
    if (oRes.status === 429) {
      console.log(JSON.stringify({ ok: false, id, state, role, mappingStatus: "BLOCKED", httpStatus: 429, courtListenerHttpCalls: calls }));
      process.exit(1);
    }
    const oj = await oRes.json().catch(() => ({}));
    const first = Array.isArray(oj.results) ? oj.results[0] : null;
    opinionSample = { status: oRes.status, hasResult: Boolean(first), sampleId: first?.id ?? null, dateFiled: first?.date_filed || null };
    if (!first) mappingStatus = "AMBIGUOUS";
  }
  console.log(
    JSON.stringify({
      ok: true,
      id,
      state,
      role,
      mappingStatus,
      httpStatus: cres.status,
      fullName: body?.full_name || body?.name || null,
      jurisdiction: body?.jurisdiction || null,
      inUse: body?.in_use ?? null,
      opinionSample,
      courtListenerHttpCalls: calls,
      mutations: 0
    })
  );
}
main().catch((e) => {
  console.log(JSON.stringify({ ok: false, err: String(e.message || e).slice(0, 200), courtListenerHttpCalls: 0 }));
  process.exit(1);
});
