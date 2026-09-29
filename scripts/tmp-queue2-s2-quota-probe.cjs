/**
 * ONE authoritative CourtListener api-usage probe. Run via run-tmp-fly-node.
 * Counts as the session's single quota observation.
 */
"use strict";
const k = process.env.COURTLISTENER_API_KEY;
if (!k) {
  console.log(JSON.stringify({ ok: false, reason: "no_key", courtListenerHttpCalls: 0 }));
  process.exit(2);
}
const t0 = Date.now();
fetch("https://www.courtlistener.com/api/rest/v4/api-usage/", {
  headers: { Authorization: `Token ${k}`, Accept: "application/json" },
  signal: AbortSignal.timeout(30000),
})
  .then(async (r) => {
    const j = await r.json().catch(() => ({}));
    const membership = j.membership || null;
    const current = j.current_usage || j.usage || [];
    function normalizeRows(raw) {
      const out = [];
      const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? [raw] : [];
      for (const row of list) {
        if (!row || typeof row !== "object") continue;
        if (row.minute || row.hour || row.day) {
          for (const period of ["minute", "hour", "day"]) {
            const p = row[period];
            if (!p) continue;
            out.push({
              scope: String(row.scope || "user"),
              period,
              limit: Number(p.limit ?? p.rate_limit ?? null),
              usage: Number(p.usage ?? p.used ?? null),
              remaining: Number(
                p.remaining ??
                  (p.limit != null && p.usage != null ? Number(p.limit) - Number(p.usage) : null),
              ),
              reset_at: p.reset_at || p.resetAt || null,
              blocked: Boolean(p.blocked || false),
            });
          }
          continue;
        }
        const periodRaw = String(row.period || row.window || row.rate || row.name || "").toLowerCase();
        const period = periodRaw.includes("min")
          ? "minute"
          : periodRaw.includes("hour")
            ? "hour"
            : periodRaw.includes("day")
              ? "day"
              : null;
        out.push({
          scope: String(row.scope || row.throttle || "user"),
          period,
          limit: Number(row.limit ?? row.rate_limit ?? row.allowed ?? null),
          usage: Number(row.usage ?? row.used ?? row.count ?? null),
          remaining: Number(
            row.remaining ??
              (row.limit != null && row.usage != null ? Number(row.limit) - Number(row.usage) : null),
          ),
          reset_at: row.reset_at || row.resetAt || null,
          blocked: Boolean(row.blocked || row.is_blocked || false),
        });
      }
      return out;
    }
    let rows = [];
    if (Array.isArray(current)) {
      const userish = current.filter((x) =>
        String(x.scope || x.throttle || x.name || "")
          .toLowerCase()
          .includes("user"),
      );
      rows = normalizeRows(userish.length ? userish : current);
    } else if (current && typeof current === "object") {
      rows = normalizeRows(current.user || current);
    }
    const byPeriod = {};
    for (const row of rows) {
      if (row.period) byPeriod[row.period] = row;
    }
    if (!byPeriod.minute && rows.length >= 3) {
      const sorted = [...rows].filter((r) => Number.isFinite(r.limit)).sort((a, b) => a.limit - b.limit);
      if (sorted[0]) byPeriod.minute = { ...sorted[0], period: "minute" };
      if (sorted[1]) byPeriod.hour = { ...sorted[1], period: "hour" };
      if (sorted[2]) byPeriod.day = { ...sorted[2], period: "day" };
    }
    console.log(
      JSON.stringify({
        ok: r.ok,
        status: r.status,
        ms: Date.now() - t0,
        classification: "QUEUE2_SESSION2_QUOTA_PROBE",
        membership: {
          level: membership?.level || membership?.name || null,
          is_active: membership?.is_active ?? membership?.isActive ?? null,
        },
        limits: {
          minute: byPeriod.minute || null,
          hour: byPeriod.hour || null,
          day: byPeriod.day || null,
        },
        courtListenerHttpCalls: 1,
      }),
    );
  })
  .catch((e) => {
    console.log(JSON.stringify({ ok: false, err: String(e.message || e), courtListenerHttpCalls: 1 }));
    process.exit(1);
  });
