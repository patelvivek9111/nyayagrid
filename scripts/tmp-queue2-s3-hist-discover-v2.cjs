/**
 * Session 3 hist discovery v2 — try SEARCH endpoint first (filed_after/before),
 * fall back to opinions date filters. Hard timeout. Discovery only.
 *
 * argv: <court> <gte YYYY-MM-DD> <lte YYYY-MM-DD> [maxIds] [mode=search|opinions|both]
 */
"use strict";
const CL_BASE = "https://www.courtlistener.com/api/rest/v4";
const fs = require("fs");

const court = (process.argv[2] || "").trim().toLowerCase();
const gte = (process.argv[3] || "").trim();
const lte = (process.argv[4] || "").trim();
const maxIds = Math.min(Math.max(Number(process.argv[5] || 8), 1), 20);
const mode = (process.argv[6] || "search").trim().toLowerCase();
const hardTimeoutMs = Math.min(Math.max(Number(process.env.CL_HARD_TIMEOUT_MS || 35000), 8000), 60000);
const outPath = "/tmp/queue2-s3-hist-discover.json";

function finish(payload, code) {
  try {
    fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
  } catch (_) {}
  console.log(JSON.stringify(payload));
  process.exit(code);
}

async function fetchJson(url, key, timeoutMs) {
  const res = await fetch(url, {
    headers: { Authorization: `Token ${key}`, Accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch (_) {
    body = { raw: text.slice(0, 400) };
  }
  return { status: res.status, body, ok: res.ok };
}

async function main() {
  const key = process.env.COURTLISTENER_API_KEY;
  if (!key) finish({ ok: false, phase: "DISCOVERY", reason: "no_key", courtListenerHttpCalls: 0 }, 2);
  if (!court || !gte || !lte) finish({ ok: false, phase: "DISCOVERY", reason: "args court gte lte", courtListenerHttpCalls: 0 }, 2);

  const started = Date.now();
  let calls = 0;
  const attempts = [];

  const timer = setTimeout(() => {
    finish(
      {
        ok: false,
        phase: "DISCOVERY",
        status: "HIST_QUERY_TIMEOUT",
        hardTimeoutMs,
        court,
        gte,
        lte,
        mode,
        attempts,
        courtListenerHttpCalls: calls,
        elapsedMs: Date.now() - started,
      },
      1,
    );
  }, hardTimeoutMs);

  try {
    const perCallTimeout = Math.min(25000, hardTimeoutMs - 3000);

    // Probe A: search API (preferred for date windows)
    if (mode === "search" || mode === "both") {
      const params = new URLSearchParams({
        type: "o",
        court,
        order_by: "dateFiled asc",
        page_size: String(Math.min(maxIds, 20)),
        filed_after: gte,
        filed_before: lte,
      });
      const url = `${CL_BASE}/search/?${params}`;
      const t0 = Date.now();
      try {
        const r = await fetchJson(url, key, perCallTimeout);
        calls += 1;
        attempts.push({ path: "search", httpStatus: r.status, ms: Date.now() - t0, resultCount: (r.body?.results || []).length });
        if (r.status === 429) {
          clearTimeout(timer);
          finish({ ok: false, phase: "DISCOVERY", status: "rate_limited", attempts, courtListenerHttpCalls: calls }, 1);
        }
        if (r.ok) {
          const ids = [];
          for (const hit of r.body.results || []) {
            if (ids.length >= maxIds) break;
            const op0 = Array.isArray(hit.opinions) ? hit.opinions[0] : null;
            const snippetLen = String(op0?.snippet || "").length;
            // Prefer opinions with usable text (skip tiny table affirmances)
            if (snippetLen > 0 && snippetLen < 400) continue;
            const id = op0?.id ?? hit.id ?? hit.opinion_id ?? hit.cluster_id ?? hit.pk;
            if (!id) continue;
            ids.push({
              id: Number(id),
              dateFiled: hit.dateFiled || hit.date_filed || null,
              caseName: hit.caseName || hit.case_name || null,
              clusterId: hit.cluster_id ?? null,
              snippetLen,
            });
          }
          clearTimeout(timer);
          finish({
            ok: true,
            phase: "DISCOVERY",
            status: "discovered",
            path: "search",
            court,
            gte,
            lte,
            count: ids.length,
            ids,
            attempts,
            courtListenerHttpCalls: calls,
            elapsedMs: Date.now() - started,
            mutations: 0,
          }, 0);
        }
      } catch (e) {
        attempts.push({ path: "search", error: String(e.message || e).slice(0, 160), ms: Date.now() - t0 });
      }
    }

    // Probe B: opinions with cluster__date_filed filters
    if (mode === "opinions" || mode === "both" || attempts.every((a) => a.error || (a.httpStatus && a.httpStatus >= 400))) {
      const params = new URLSearchParams({
        cluster__docket__court: court,
        order_by: "dateFiled",
        page_size: String(Math.min(maxIds, 20)),
        cluster__date_filed__gte: gte,
        cluster__date_filed__lte: lte,
      });
      const url = `${CL_BASE}/opinions/?${params}`;
      const t0 = Date.now();
      try {
        const r = await fetchJson(url, key, perCallTimeout);
        calls += 1;
        attempts.push({ path: "opinions", httpStatus: r.status, ms: Date.now() - t0, resultCount: (r.body?.results || []).length });
        if (r.status === 429) {
          clearTimeout(timer);
          finish({ ok: false, phase: "DISCOVERY", status: "rate_limited", attempts, courtListenerHttpCalls: calls }, 1);
        }
        if (r.ok) {
          const ids = [];
          for (const hit of r.body.results || []) {
            if (ids.length >= maxIds) break;
            const id = hit.id ?? hit.pk;
            if (!id) continue;
            ids.push({
              id: Number(id),
              dateFiled: hit.date_filed || null,
              caseName: hit.case_name || null,
            });
          }
          clearTimeout(timer);
          finish({
            ok: true,
            phase: "DISCOVERY",
            status: "discovered",
            path: "opinions",
            court,
            gte,
            lte,
            count: ids.length,
            ids,
            attempts,
            courtListenerHttpCalls: calls,
            elapsedMs: Date.now() - started,
            mutations: 0,
          }, 0);
        }
      } catch (e) {
        attempts.push({ path: "opinions", error: String(e.message || e).slice(0, 160), ms: Date.now() - t0 });
      }
    }

    clearTimeout(timer);
    finish({
      ok: false,
      phase: "DISCOVERY",
      status: "HIST_QUERY_TIMEOUT",
      reason: "all_paths_failed_or_timed_out",
      court,
      gte,
      lte,
      attempts,
      courtListenerHttpCalls: calls,
      elapsedMs: Date.now() - started,
    }, 1);
  } catch (e) {
    clearTimeout(timer);
    finish({
      ok: false,
      phase: "DISCOVERY",
      status: "error",
      reason: String(e.message || e).slice(0, 300),
      attempts,
      courtListenerHttpCalls: calls,
      elapsedMs: Date.now() - started,
    }, 1);
  }
}

main();
