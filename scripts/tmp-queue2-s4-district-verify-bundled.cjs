"use strict";

// scripts/tmp-queue2-s4-district-verify.cjs
var CL_BASE = "https://www.courtlistener.com/api/rest/v4";
var CANDIDATES = [
  { id: "edny", label: "E.D.N.Y.", circuit: "2" },
  { id: "njd", label: "D.N.J.", circuit: "3" },
  { id: "paed", label: "E.D. Pa.", circuit: "3" },
  { id: "mad", label: "D. Mass.", circuit: "1" },
  { id: "flsd", label: "S.D. Fla.", circuit: "11" },
  { id: "txnd", label: "N.D. Tex.", circuit: "5" },
  { id: "cand", label: "N.D. Cal.", circuit: "9" },
  { id: "waed", label: "E.D. Wash.", circuit: "9" }
];
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
  for (const c of CANDIDATES) {
    await new Promise((r) => setTimeout(r, PACE_MS));
    let courtRes;
    try {
      courtRes = await getJson(`${CL_BASE}/courts/${c.id}/`, key, 2e4);
      calls += 1;
    } catch (e) {
      rows.push({ ...c, mappingStatus: "AMBIGUOUS", reason: `timeout:${String(e.message || e).slice(0, 80)}` });
      continue;
    }
    if (courtRes.status === 404) {
      rows.push({ ...c, mappingStatus: "UNAVAILABLE", httpStatus: 404 });
      continue;
    }
    if (!courtRes.ok) {
      rows.push({ ...c, mappingStatus: "AMBIGUOUS", httpStatus: courtRes.status });
      continue;
    }
    const fullName = courtRes.body?.full_name || courtRes.body?.short_name || null;
    await new Promise((r) => setTimeout(r, PACE_MS));
    let sample = { status: null, count: 0, earliest: null, latest: null };
    try {
      const search = await getJson(
        `${CL_BASE}/search/?type=o&court=${encodeURIComponent(c.id)}&page_size=3&order_by=dateFiled desc`,
        key,
        25e3
      );
      calls += 1;
      const hits = search.body?.results || [];
      sample.status = search.status;
      sample.count = hits.length;
      sample.latest = hits[0]?.dateFiled || hits[0]?.date_filed || null;
      if (hits.length) {
        await new Promise((r) => setTimeout(r, PACE_MS));
        const early = await getJson(
          `${CL_BASE}/search/?type=o&court=${encodeURIComponent(c.id)}&page_size=1&order_by=dateFiled asc`,
          key,
          25e3
        );
        calls += 1;
        sample.earliest = early.body?.results?.[0]?.dateFiled || early.body?.results?.[0]?.date_filed || null;
      }
    } catch (e) {
      sample = { status: "timeout", error: String(e.message || e).slice(0, 80) };
    }
    const usable = courtRes.ok && sample.count > 0 && /district/i.test(String(fullName || ""));
    rows.push({
      ...c,
      mappingStatus: usable ? "VERIFIED" : sample.count === 0 ? "UNAVAILABLE" : "AMBIGUOUS",
      httpStatus: courtRes.status,
      fullName,
      jurisdiction: courtRes.body?.jurisdiction || null,
      inUse: courtRes.body?.in_use,
      opinionSample: sample
    });
  }
  const verified = rows.filter((r) => r.mappingStatus === "VERIFIED").map((r) => r.id);
  console.log(
    JSON.stringify({
      ok: true,
      classification: "MANUAL_QUEUE2_S4_DISTRICT_VERIFY",
      candidates: rows,
      verifiedIds: verified,
      courtListenerHttpCalls: calls,
      mutations: 0
    })
  );
}
main().catch((e) => {
  console.log(JSON.stringify({ ok: false, err: String(e.message || e).slice(0, 300) }));
  process.exit(1);
});
