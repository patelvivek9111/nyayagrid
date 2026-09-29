"use strict";

// scripts/tmp-queue2-s3-in-verify.cjs
var CL_BASE = "https://www.courtlistener.com/api/rest/v4";
var CANDIDATES = ["indctapp", "indctapp.", "incourtofappeals", "in-ct-app", "indcoa", "indappct", "indapp"];
var PACE_MS = 2200;
async function getJson(url, key, timeoutMs = 2e4) {
  const res = await fetch(url, {
    headers: { Authorization: `Token ${key}`, Accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs)
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body, ok: res.ok };
}
async function main() {
  const key = process.env.COURTLISTENER_API_KEY;
  if (!key) {
    console.log(JSON.stringify({ ok: false, reason: "no_key" }));
    process.exit(2);
  }
  let calls = 0;
  const rows = [];
  await new Promise((r) => setTimeout(r, PACE_MS));
  const search = await getJson(
    `${CL_BASE}/courts/?search=Indiana+Court+of+Appeals&page_size=20`,
    key,
    25e3
  );
  calls += 1;
  const searchHits = (search.body?.results || []).map((c) => ({
    id: c.id,
    fullName: c.full_name || c.short_name,
    jurisdiction: c.jurisdiction,
    inUse: c.in_use,
    hasOpinionScraper: c.has_opinion_scraper
  }));
  for (const id of CANDIDATES) {
    await new Promise((r) => setTimeout(r, PACE_MS));
    let courtRes;
    try {
      courtRes = await getJson(`${CL_BASE}/courts/${id}/`, key, 2e4);
      calls += 1;
    } catch (e) {
      rows.push({
        id,
        mappingStatus: "AMBIGUOUS",
        reason: `court_timeout:${String(e.message || e).slice(0, 80)}`
      });
      continue;
    }
    if (courtRes.status === 404) {
      rows.push({ id, mappingStatus: "UNAVAILABLE", httpStatus: 404 });
      continue;
    }
    if (!courtRes.ok) {
      rows.push({
        id,
        mappingStatus: "AMBIGUOUS",
        httpStatus: courtRes.status,
        reason: "court_http_error"
      });
      continue;
    }
    const c = courtRes.body || {};
    await new Promise((r) => setTimeout(r, PACE_MS));
    let opSample = { status: null, hasResult: false, sampleId: null, dateFiled: null, earliest: null, latest: null };
    try {
      const op = await getJson(
        `${CL_BASE}/opinions/?cluster__docket__court=${encodeURIComponent(id)}&page_size=1&order_by=-dateFiled`,
        key,
        25e3
      );
      calls += 1;
      const hit = (op.body?.results || [])[0];
      opSample = {
        status: op.status,
        hasResult: Boolean(hit),
        sampleId: hit?.id ?? null,
        dateFiled: hit?.date_filed ?? null
      };
      if (hit) {
        await new Promise((r) => setTimeout(r, PACE_MS));
        const early = await getJson(
          `${CL_BASE}/opinions/?cluster__docket__court=${encodeURIComponent(id)}&page_size=1&order_by=dateFiled`,
          key,
          25e3
        );
        calls += 1;
        opSample.earliest = early.body?.results?.[0]?.date_filed ?? null;
        opSample.latest = hit.date_filed ?? null;
      }
    } catch (e) {
      opSample = { status: "timeout", hasResult: false, error: String(e.message || e).slice(0, 80) };
    }
    const usable = courtRes.ok && (c.in_use === true || c.in_use === void 0) && opSample.hasResult && /indiana/i.test(String(c.full_name || c.short_name || ""));
    rows.push({
      id,
      mappingStatus: usable ? "VERIFIED" : courtRes.ok && !opSample.hasResult ? "UNAVAILABLE" : "AMBIGUOUS",
      httpStatus: courtRes.status,
      fullName: c.full_name || c.short_name || null,
      jurisdiction: c.jurisdiction || null,
      inUse: c.in_use,
      opinionSample: opSample
    });
  }
  const verified = rows.find((r) => r.mappingStatus === "VERIFIED");
  const out = {
    ok: true,
    state: "IN",
    role: "intermediate",
    searchHits,
    candidates: rows,
    finalStatus: verified ? "VERIFIED" : rows.some((r) => r.mappingStatus === "AMBIGUOUS") ? "AMBIGUOUS" : "UNAVAILABLE",
    verifiedId: verified?.id || null,
    courtListenerHttpCalls: calls,
    mutations: 0
  };
  console.log(JSON.stringify(out));
}
main().catch((e) => {
  console.log(JSON.stringify({ ok: false, err: String(e.message || e).slice(0, 300) }));
  process.exit(1);
});
