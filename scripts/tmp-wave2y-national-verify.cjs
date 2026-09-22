/**
 * Wave 2Y — paced single verify of next national high-court CL ids.
 * All traffic through spacing + LOCAL_QUOTA_SAFETY_FLOOR. Hard-stop on 429.
 * FEATURE_AGENTS=0. No rediscovery / search — candidate ids only.
 */
const CL_BASE = "https://www.courtlistener.com/api/rest/v4";
const CANDIDATES = [
  { cl: "mont", j: "MT", nyaya: "st-mt-high", name: "Montana Supreme Court" },
  { cl: "nd", j: "ND", nyaya: "st-nd-high", name: "North Dakota Supreme Court" },
  { cl: "neb", j: "NE", nyaya: "st-ne-high", name: "Nebraska Supreme Court" },
  { cl: "nh", j: "NH", nyaya: "st-nh-high", name: "New Hampshire Supreme Court" },
  { cl: "nm", j: "NM", nyaya: "st-nm-high", name: "New Mexico Supreme Court" },
  { cl: "nev", j: "NV", nyaya: "st-nv-high", name: "Nevada Supreme Court" },
  { cl: "okla", j: "OK", nyaya: "st-ok-high", name: "Supreme Court of Oklahoma" },
  { cl: "sc", j: "SC", nyaya: "st-sc-high", name: "Supreme Court of South Carolina" },
  { cl: "sd", j: "SD", nyaya: "st-sd-high", name: "South Dakota Supreme Court" },
  { cl: "tenn", j: "TN", nyaya: "st-tn-high", name: "Supreme Court of Tennessee" },
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseRetryAfterSec(res) {
  const h = res.headers.get("retry-after");
  if (!h) return null;
  const asInt = Number.parseInt(h, 10);
  if (Number.isFinite(asInt) && asInt >= 0) return Math.min(asInt, 3600);
  return null;
}

function parseUsage(payload) {
  const by = {};
  for (const row of payload?.current_usage || []) {
    if (String(row.scope || "").toLowerCase() !== "user") continue;
    const rate = String(row.rate || "").toLowerCase();
    const period = rate.includes("/min")
      ? "minute"
      : rate.includes("/hour")
        ? "hour"
        : rate.includes("/day")
          ? "day"
          : null;
    if (!period) continue;
    const limit = Number(row.limit);
    const used = Number(row.used ?? row.usage ?? 0);
    by[period] = {
      limit,
      used,
      remaining: Number(row.remaining ?? (Number.isFinite(limit) ? limit - used : 0)),
      resetAt: row.reset_at || null,
    };
  }
  if (!by.minute || !by.hour || !by.day) return null;
  const minuteTarget = Math.floor(by.minute.limit * (14 / 15));
  const hourTarget = Math.floor(by.hour.limit * (140 / 150));
  const dayTarget = by.day.limit - Math.max(20, Math.round(by.day.limit * (20 / 600)));
  const hourUsed = by.hour.limit - by.hour.remaining;
  const dayUsed = by.day.limit - by.day.remaining;
  const hourRem = Math.max(0, Math.min(by.hour.remaining, hourTarget - hourUsed));
  const dayRem = Math.max(0, Math.min(by.day.remaining, dayTarget - dayUsed));
  const minuteRem = Math.max(0, Math.min(by.minute.remaining, minuteTarget));
  return {
    windows: by,
    minuteTarget,
    hourTarget,
    dayTarget,
    safe: Math.max(0, Math.min(minuteRem, hourRem, dayRem)),
    rateMs: Math.ceil(60_000 / Math.max(1, minuteTarget)),
  };
}

class ClRateLimiter {
  constructor(apiKey, rateMs, maxCalls) {
    this.apiKey = apiKey;
    this.rateMs = rateMs;
    this.maxCalls = maxCalls;
    this.apiCalls = 0;
    this.rateLimitHits = 0;
    this.lastRetryAfterSec = null;
    this.quotaExhausted = false;
    this.lastRequestAt = 0;
    this.globalPauseUntil = 0;
    this.chain = Promise.resolve();
  }

  async fetch(url) {
    const run = async () => {
      if (this.apiCalls >= this.maxCalls) {
        this.quotaExhausted = true;
        return new Response(null, { status: 429, headers: { "retry-after": "3600" } });
      }
      const now = Date.now();
      const wait = Math.max(0, this.globalPauseUntil - now, this.rateMs - (now - this.lastRequestAt));
      if (wait > 0) await sleep(wait);
      this.apiCalls += 1;
      this.lastRequestAt = Date.now();
      const res = await fetch(url, {
        headers: { Authorization: `Token ${this.apiKey}`, Accept: "application/json" },
        signal: AbortSignal.timeout(90_000),
      });
      if (res.status === 429) {
        this.rateLimitHits += 1;
        this.lastRetryAfterSec = parseRetryAfterSec(res) ?? 60;
      }
      return res;
    };
    const next = this.chain.then(run, run);
    this.chain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
}

async function main() {
  const key = process.env.COURTLISTENER_API_KEY;
  if (!key) {
    console.log(JSON.stringify({ ok: false, reason: "no_key", courtListenerHttpCalls: 0 }));
    process.exit(2);
  }

  const usageRes = await fetch(`${CL_BASE}/api-usage/`, {
    headers: { Authorization: `Token ${key}`, Accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  const usageBody = await usageRes.json().catch(() => ({}));
  const plan = parseUsage(usageBody);
  if (!plan || plan.safe < 2) {
    console.log(
      JSON.stringify({
        ok: true,
        status: "quota_paused",
        reason: "LOCAL_QUOTA_SAFETY_FLOOR",
        plan,
        courtListenerHttpCalls: 0,
        featureAgents: "0",
      }),
    );
    process.exit(0);
  }

  const cl = new ClRateLimiter(key, plan.rateMs, Math.min(plan.safe, CANDIDATES.length + 1));
  const results = [];
  let hard429 = false;

  for (const c of CANDIDATES) {
    if (cl.quotaExhausted) {
      results.push({ ...c, status: "quota_paused", http: null });
      break;
    }
    const res = await cl.fetch(`${CL_BASE}/courts/${encodeURIComponent(c.cl)}/`);
    if (res.status === 429) {
      hard429 = true;
      results.push({
        ...c,
        status: "rate_limited",
        http: 429,
        retryAfterSec: cl.lastRetryAfterSec,
      });
      break;
    }
    let fullName = null;
    if (res.status === 200) {
      const body = await res.json().catch(() => ({}));
      fullName = body.full_name || body.name || null;
    }
    const status =
      res.status === 200 ? "VERIFIED" : res.status === 404 ? "MAPPING_INVALID" : `http_${res.status}`;
    results.push({
      ...c,
      status,
      http: res.status,
      fullName,
      ingestEnabled: res.status === 200,
    });
    if (hard429) break;
  }

  const verified = results.filter((r) => r.status === "VERIFIED");
  console.log(
    JSON.stringify({
      ok: true,
      hard429,
      quotaExhausted: cl.quotaExhausted,
      apiCalls: cl.apiCalls,
      verifiedCount: verified.length,
      verified: verified.map((v) => v.cl),
      results,
      plan: {
        safe: plan.safe,
        rateMs: plan.rateMs,
        hourTarget: plan.hourTarget,
        dayTarget: plan.dayTarget,
      },
      featureAgents: process.env.FEATURE_AGENTS || "0",
    }),
  );
}

main().catch((e) => {
  console.log(JSON.stringify({ ok: false, err: String(e.message || e), featureAgents: "0" }));
  process.exit(1);
});
