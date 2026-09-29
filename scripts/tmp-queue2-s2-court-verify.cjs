/**
 * Paced CourtListener /courts/{id}/ verification for Session 2.
 * ZERO mutations. Small paced probe only (1 court / ~2.2s).
 *
 * Candidates:
 * - CT/AZ/NM/IN intermediate appellate
 * - representative federal district courts
 *
 * Usage: node tmp-queue2-s2-court-verify.cjs
 * Env: CL_VERIFY_IDS=comma,list  (optional override)
 */
"use strict";

const CL_BASE = "https://www.courtlistener.com/api/rest/v4";
const RATE_MS = Number(process.env.CL_RATE_MS || 2200);

/** Primary candidate + alternates for priority states. */
const CANDIDATES = [
  { state: "CT", role: "intermediate", ids: ["connappct", "connapp", "connctapp"] },
  { state: "AZ", role: "intermediate", ids: ["arizctapp", "arizapp"] },
  { state: "NM", role: "intermediate", ids: ["nmctapp", "nmapp"] },
  { state: "IN", role: "intermediate", ids: ["indctapp", "indappct", "indapp"] },
  // Other thin intermediate layers (verify only if primary states succeed with budget left)
  { state: "NE", role: "intermediate", ids: ["nebrctapp", "nebctapp"] },
  { state: "KS", role: "intermediate", ids: ["kanctapp"] },
  { state: "KY", role: "intermediate", ids: ["kyctapp"] },
  // Known-good from prior session (reconfirm cache)
  { state: "WI", role: "intermediate", ids: ["wisctapp"] },
  { state: "UT", role: "intermediate", ids: ["utahctapp"] },
  // Federal district pilot candidates
  { state: "US", role: "district", ids: ["nysd", "nyed", "cacd", "ilnd", "txsd", "dcd"] },
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function classifyStatus(httpStatus, body) {
  if (httpStatus === 429) return "BLOCKED";
  if (httpStatus === 404) return "NO_USABLE_CL_COURT";
  if (httpStatus !== 200) return "BLOCKED";
  if (!body || typeof body !== "object") return "AMBIGUOUS";
  const fullName = String(body.full_name || body.name || "").trim();
  if (!fullName) return "AMBIGUOUS";
  return "VERIFIED";
}

async function main() {
  const key = process.env.COURTLISTENER_API_KEY;
  if (!key) {
    console.log(JSON.stringify({ ok: false, reason: "no_key", courtListenerHttpCalls: 0 }));
    process.exit(2);
  }

  const override = (process.env.CL_VERIFY_IDS || "").trim();
  let plan = [];
  if (override) {
    plan = override.split(",").map((id) => ({ state: "?", role: "custom", id: id.trim() })).filter((x) => x.id);
  } else {
    for (const c of CANDIDATES) {
      for (const id of c.ids) plan.push({ state: c.state, role: c.role, id });
    }
  }

  // Cap paced calls: priority intermediates first (~12) + districts (~6) = ~18 max
  const MAX = Math.min(Number(process.env.CL_VERIFY_MAX || 20), 24);
  plan = plan.slice(0, MAX);

  const results = [];
  let calls = 0;
  let hit429 = false;

  for (const item of plan) {
    if (hit429) {
      results.push({ ...item, status: "BLOCKED", reason: "skipped_after_429", httpStatus: null });
      continue;
    }
    // Skip remaining alternates for a state if one already VERIFIED
    const already = results.find((r) => r.state === item.state && r.role === item.role && r.mappingStatus === "VERIFIED");
    if (already && item.role === "intermediate") {
      results.push({
        ...item,
        status: "SKIPPED_ALTERNATE",
        mappingStatus: "SKIPPED_ALTERNATE",
        reason: `already_verified:${already.id}`,
        httpStatus: null,
      });
      continue;
    }

    await sleep(RATE_MS);
    const url = `${CL_BASE}/courts/${encodeURIComponent(item.id)}/`;
    let httpStatus = 0;
    let body = null;
    let err = null;
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Token ${key}`, Accept: "application/json" },
        signal: AbortSignal.timeout(30000),
      });
      httpStatus = res.status;
      calls += 1;
      if (res.status === 429) {
        hit429 = true;
        results.push({
          ...item,
          mappingStatus: "BLOCKED",
          status: "BLOCKED",
          httpStatus: 429,
          reason: "rate_limited",
        });
        continue;
      }
      body = await res.json().catch(() => null);
    } catch (e) {
      err = String(e.message || e).slice(0, 200);
    }

    const mappingStatus = err ? "BLOCKED" : classifyStatus(httpStatus, body);
    const fullName = body?.full_name || body?.name || null;
    const jurisdiction = body?.jurisdiction || null;
    const inUse = body?.in_use ?? null;
    const hasOpinionScraper = body?.has_opinion_scraper ?? null;

    // Opinion availability smoke (1 extra call only for VERIFIED, paced)
    let opinionSample = null;
    if (mappingStatus === "VERIFIED") {
      await sleep(RATE_MS);
      try {
        const oUrl = `${CL_BASE}/opinions/?cluster__docket__court=${encodeURIComponent(item.id)}&page_size=1&order_by=-id`;
        const oRes = await fetch(oUrl, {
          headers: { Authorization: `Token ${key}`, Accept: "application/json" },
          signal: AbortSignal.timeout(30000),
        });
        calls += 1;
        if (oRes.status === 429) {
          hit429 = true;
          opinionSample = { status: 429 };
        } else {
          const oj = await oRes.json().catch(() => ({}));
          const first = Array.isArray(oj.results) ? oj.results[0] : null;
          opinionSample = {
            status: oRes.status,
            countHint: oj.count ?? null,
            hasResult: Boolean(first),
            sampleId: first?.id ?? null,
            dateFiled: first?.date_filed || first?.cluster?.date_filed || null,
          };
        }
      } catch (e) {
        opinionSample = { error: String(e.message || e).slice(0, 120) };
      }
    }

    let finalStatus = mappingStatus;
    if (mappingStatus === "VERIFIED" && opinionSample && opinionSample.hasResult === false && opinionSample.status === 200) {
      finalStatus = "AMBIGUOUS"; // court exists but no opinions returned
    }

    results.push({
      ...item,
      mappingStatus: finalStatus,
      status: finalStatus,
      httpStatus,
      fullName,
      jurisdiction,
      inUse,
      hasOpinionScraper,
      opinionSample,
      err,
    });
  }

  const byState = {};
  for (const r of results) {
    const key = `${r.state}:${r.role}`;
    if (!byState[key]) byState[key] = [];
    byState[key].push(r);
  }
  const summary = Object.fromEntries(
    Object.entries(byState).map(([k, arr]) => {
      const verified = arr.find((x) => x.mappingStatus === "VERIFIED");
      return [
        k,
        verified
          ? { status: "VERIFIED", id: verified.id, fullName: verified.fullName }
          : { status: arr.find((x) => x.mappingStatus !== "SKIPPED_ALTERNATE")?.mappingStatus || "NO_USABLE_CL_COURT", tried: arr.map((x) => x.id) },
      ];
    }),
  );

  console.log(
    JSON.stringify({
      ok: !hit429,
      classification: "QUEUE2_S2_COURT_VERIFY",
      generatedAt: new Date().toISOString(),
      courtListenerHttpCalls: calls,
      mutations: 0,
      hit429,
      summary,
      results,
    }),
  );
}

main().catch((e) => {
  console.log(JSON.stringify({ ok: false, err: String(e.message || e).slice(0, 400), courtListenerHttpCalls: 0 }));
  process.exit(1);
});
