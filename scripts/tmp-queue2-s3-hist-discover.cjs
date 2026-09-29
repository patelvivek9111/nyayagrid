/**
 * Session 3 Phase A — HISTORICAL DISCOVERY ONLY.
 * No ingest. Bounded page. Writes ID list and exits.
 *
 * Env:
 *   CL_COURT=ca5
 *   CL_DATE_FILED_GTE=1995-01-01
 *   CL_DATE_FILED_LTE=1999-12-31
 *   CL_DISCOVER_MAX=10
 *   CL_ORDER_BY=dateFiled  (preferred for hist windows)
 *   CL_HARD_TIMEOUT_MS=45000
 */
"use strict";

const CL_BASE = "https://www.courtlistener.com/api/rest/v4";
const fs = require("fs");

const court = (process.argv[2] || process.env.CL_COURT || "").trim().toLowerCase();
const gte = (process.argv[3] || process.env.CL_DATE_FILED_GTE || "").trim();
const lte = (process.argv[4] || process.env.CL_DATE_FILED_LTE || "").trim();
const maxIds = Math.min(Math.max(Number(process.argv[5] || process.env.CL_DISCOVER_MAX || 10), 1), 25);
const orderBy = (process.env.CL_ORDER_BY || "dateFiled").trim() || "dateFiled";
const hardTimeoutMs = Math.min(Math.max(Number(process.env.CL_HARD_TIMEOUT_MS || 45000), 10000), 90000);
const outPath = process.env.CL_DISCOVER_OUT || "/tmp/queue2-s3-hist-discover.json";

function finish(payload, code) {
  try {
    fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
  } catch (_) {
    /* ignore */
  }
  console.log(JSON.stringify(payload));
  process.exit(code);
}

async function main() {
  const key = process.env.COURTLISTENER_API_KEY;
  if (!key) finish({ ok: false, phase: "DISCOVERY", reason: "no_key", courtListenerHttpCalls: 0 }, 2);
  if (!court) finish({ ok: false, phase: "DISCOVERY", reason: "CL_COURT required", courtListenerHttpCalls: 0 }, 2);
  if (!gte || !lte) finish({ ok: false, phase: "DISCOVERY", reason: "date window required", courtListenerHttpCalls: 0 }, 2);

  const started = Date.now();
  const timer = setTimeout(() => {
    finish(
      {
        ok: false,
        phase: "DISCOVERY",
        status: "HIST_QUERY_TIMEOUT",
        reason: "hard_timeout",
        hardTimeoutMs,
        court,
        gte,
        lte,
        courtListenerHttpCalls: calls,
        elapsedMs: Date.now() - started,
      },
      1,
    );
  }, hardTimeoutMs);

  let calls = 0;
  try {
    const params = new URLSearchParams({
      cluster__docket__court: court,
      order_by: orderBy,
      page_size: String(Math.min(maxIds, 20)),
      cluster__date_filed__gte: gte,
      cluster__date_filed__lte: lte,
    });
    const url = `${CL_BASE}/opinions/?${params}`;
    const res = await fetch(url, {
      headers: { Authorization: `Token ${key}`, Accept: "application/json" },
      signal: AbortSignal.timeout(Math.min(hardTimeoutMs - 2000, 40000)),
    });
    calls += 1;
    if (res.status === 429) {
      clearTimeout(timer);
      finish({ ok: false, phase: "DISCOVERY", status: "rate_limited", httpStatus: 429, court, gte, lte, courtListenerHttpCalls: calls }, 1);
    }
    if (!res.ok) {
      clearTimeout(timer);
      const bodyText = await res.text().catch(() => "");
      finish({
        ok: false,
        phase: "DISCOVERY",
        status: "discover_failed",
        httpStatus: res.status,
        bodySnippet: bodyText.slice(0, 300),
        court,
        gte,
        lte,
        url,
        courtListenerHttpCalls: calls,
      }, 1);
    }
    const body = await res.json();
    const results = Array.isArray(body.results) ? body.results : [];
    const ids = [];
    for (const hit of results) {
      if (ids.length >= maxIds) break;
      const id = hit.id ?? hit.pk ?? null;
      if (!id) continue;
      ids.push({
        id: Number(id),
        dateFiled: hit.date_filed || hit.cluster?.date_filed || null,
        caseName: hit.case_name || hit.cluster?.case_name || null,
      });
    }
    clearTimeout(timer);
    finish({
      ok: true,
      phase: "DISCOVERY",
      status: "discovered",
      court,
      gte,
      lte,
      orderBy,
      count: ids.length,
      ids,
      next: body.next || null,
      courtListenerHttpCalls: calls,
      elapsedMs: Date.now() - started,
      mutations: 0,
    }, 0);
  } catch (e) {
    clearTimeout(timer);
    const msg = String(e.message || e);
    const timedOut = /timeout|aborted|AbortError/i.test(msg);
    finish({
      ok: false,
      phase: "DISCOVERY",
      status: timedOut ? "HIST_QUERY_TIMEOUT" : "error",
      reason: msg.slice(0, 300),
      court,
      gte,
      lte,
      courtListenerHttpCalls: calls,
      elapsedMs: Date.now() - started,
    }, 1);
  }
}

main();
