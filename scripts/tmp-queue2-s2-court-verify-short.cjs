/**
 * Short paced verify: CT/AZ/NM/IN intermediate + 3 district courts only.
 * Keeps Fly exec under ~90s.
 */
"use strict";

const CL_BASE = "https://www.courtlistener.com/api/rest/v4";
const RATE_MS = Number(process.env.CL_RATE_MS || 2200);

const PLAN = [
  { state: "CT", role: "intermediate", id: "connappct" },
  { state: "CT", role: "intermediate", id: "connapp" },
  { state: "AZ", role: "intermediate", id: "arizctapp" },
  { state: "NM", role: "intermediate", id: "nmctapp" },
  { state: "IN", role: "intermediate", id: "indctapp" },
  { state: "US", role: "district", id: "nysd" },
  { state: "US", role: "district", id: "cacd" },
  { state: "US", role: "district", id: "ilnd" },
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const key = process.env.COURTLISTENER_API_KEY;
  if (!key) {
    console.log(JSON.stringify({ ok: false, reason: "no_key", courtListenerHttpCalls: 0 }));
    process.exit(2);
  }
  const results = [];
  let calls = 0;
  let hit429 = false;
  const verifiedByKey = new Set();

  for (const item of PLAN) {
    const keyState = `${item.state}:${item.role}`;
    if (hit429) {
      results.push({ ...item, mappingStatus: "BLOCKED", reason: "skipped_after_429" });
      continue;
    }
    if (item.role === "intermediate" && verifiedByKey.has(keyState)) {
      results.push({ ...item, mappingStatus: "SKIPPED_ALTERNATE", reason: "already_verified" });
      continue;
    }

    await sleep(RATE_MS);
    let httpStatus = 0;
    let body = null;
    try {
      const res = await fetch(`${CL_BASE}/courts/${encodeURIComponent(item.id)}/`, {
        headers: { Authorization: `Token ${key}`, Accept: "application/json" },
        signal: AbortSignal.timeout(25000),
      });
      httpStatus = res.status;
      calls += 1;
      if (res.status === 429) {
        hit429 = true;
        results.push({ ...item, mappingStatus: "BLOCKED", httpStatus: 429 });
        continue;
      }
      body = await res.json().catch(() => null);
    } catch (e) {
      results.push({ ...item, mappingStatus: "BLOCKED", err: String(e.message || e).slice(0, 120) });
      continue;
    }

    let mappingStatus =
      httpStatus === 404
        ? "NO_USABLE_CL_COURT"
        : httpStatus === 200 && body?.full_name
          ? "VERIFIED"
          : httpStatus === 200
            ? "AMBIGUOUS"
            : "BLOCKED";

    let opinionSample = null;
    if (mappingStatus === "VERIFIED") {
      await sleep(RATE_MS);
      try {
        const oRes = await fetch(
          `${CL_BASE}/opinions/?cluster__docket__court=${encodeURIComponent(item.id)}&page_size=1&order_by=-id`,
          {
            headers: { Authorization: `Token ${key}`, Accept: "application/json" },
            signal: AbortSignal.timeout(25000),
          },
        );
        calls += 1;
        if (oRes.status === 429) {
          hit429 = true;
          opinionSample = { status: 429 };
        } else {
          const oj = await oRes.json().catch(() => ({}));
          const first = Array.isArray(oj.results) ? oj.results[0] : null;
          opinionSample = {
            status: oRes.status,
            hasResult: Boolean(first),
            sampleId: first?.id ?? null,
            dateFiled: first?.date_filed || null,
          };
          if (!first) mappingStatus = "AMBIGUOUS";
        }
      } catch (e) {
        opinionSample = { error: String(e.message || e).slice(0, 100) };
      }
    }

    if (mappingStatus === "VERIFIED") verifiedByKey.add(keyState);
    results.push({
      ...item,
      mappingStatus,
      httpStatus,
      fullName: body?.full_name || body?.name || null,
      jurisdiction: body?.jurisdiction || null,
      inUse: body?.in_use ?? null,
      opinionSample,
    });
  }

  const summary = {};
  for (const r of results) {
    const k = `${r.state}:${r.role}`;
    if (!summary[k]) summary[k] = { status: "NO_USABLE_CL_COURT", tried: [] };
    summary[k].tried.push(r.id);
    if (r.mappingStatus === "VERIFIED" && summary[k].status !== "VERIFIED") {
      summary[k] = {
        status: "VERIFIED",
        id: r.id,
        fullName: r.fullName,
        jurisdiction: r.jurisdiction,
        opinionOk: r.opinionSample?.hasResult === true,
      };
    } else if (summary[k].status !== "VERIFIED" && r.mappingStatus !== "SKIPPED_ALTERNATE") {
      summary[k].status = r.mappingStatus;
    }
  }

  const outPath = "/tmp/queue2-s2-court-verify-out.json";
  const payload = {
      ok: !hit429,
      classification: "QUEUE2_S2_COURT_VERIFY_SHORT",
      generatedAt: new Date().toISOString(),
      courtListenerHttpCalls: calls,
      mutations: 0,
      hit429,
      summary,
      results,
    };
  try {
    require("fs").writeFileSync(outPath, JSON.stringify(payload, null, 2));
  } catch (_) {
    /* ignore */
  }
  console.log(JSON.stringify(payload));
}

main().catch((e) => {
  console.log(JSON.stringify({ ok: false, err: String(e.message || e).slice(0, 300), courtListenerHttpCalls: 0 }));
  process.exit(1);
});
