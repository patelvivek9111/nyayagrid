/**
 * Resolve Wave-1 CourtListener court ids via /courts/ metadata (no guessing).
 * ALL requests go through ClRateLimiter — no unpaced bursts.
 * Usage on Fly: CL_ALLOW_COURT_PROBE=1 CL_COURT_PROBE=1 node staging-cl-court-map-probe-bundled.cjs
 *
 * Hard gate: set CL_ALLOW_COURT_PROBE=1 explicitly. Prefer offline registry
 * (scripts/cl-court-map-registry.cjs) + single paced verify in batch job.
 */
const CL_BASE = "https://www.courtlistener.com/api/rest/v4";

if (process.env.CL_ALLOW_COURT_PROBE !== "1") {
  console.log(
    JSON.stringify({
      ok: false,
      reason: "COURT_PROBE_DISABLED",
      hint: "Use scripts/cl-court-map-registry.cjs offline. Live probe requires CL_ALLOW_COURT_PROBE=1 and uses paced ClRateLimiter.",
      courtListenerHttpCalls: 0,
    }),
  );
  process.exit(2);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function parseRetryAfterSec(res: Response): number | null {
  const h = res.headers.get("retry-after");
  if (!h) return null;
  const asInt = Number.parseInt(h, 10);
  if (Number.isFinite(asInt) && asInt >= 0) return Math.min(asInt, 3600);
  return null;
}

/** Minimal paced client — same contract as staging-cl-batch-job ClRateLimiter. */
class ClRateLimiter {
  apiCalls = 0;
  rateLimitHits = 0;
  lastRetryAfterSec: number | null = null;
  private lastRequestAt = 0;
  private globalPauseUntil = 0;
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly apiKey: string,
    private readonly rateMs: number,
  ) {}

  async fetch(url: string): Promise<Response> {
    const run = async (): Promise<Response> => {
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
        const retryAfter = parseRetryAfterSec(res) ?? 60;
        this.lastRetryAfterSec = retryAfter;
        if (retryAfter > 300) return res;
        this.globalPauseUntil = Date.now() + retryAfter * 1000;
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

const WANTED = [
  { state: "CA", needles: ["supreme court of california", "court of appeal"] },
  { state: "DE", needles: ["supreme court of delaware"] },
  { state: "FL", needles: ["supreme court of florida", "district court of appeal"] },
  { state: "IL", needles: ["supreme court of illinois", "appellate court of illinois"] },
  { state: "MA", needles: ["supreme judicial court", "appeals court"] },
  { state: "NJ", needles: ["supreme court of new jersey", "appellate division"] },
  { state: "NY", needles: ["court of appeals", "appellate division"] },
  {
    state: "PA",
    needles: ["supreme court of pennsylvania", "superior court of pennsylvania", "commonwealth court"],
  },
  { state: "TX", needles: ["supreme court of texas", "court of criminal appeals", "court of appeals"] },
  { state: "VA", needles: ["supreme court of virginia", "court of appeals of virginia"] },
];

const ASSUMED: Record<string, string> = {
  cal: "st-ca-high",
  calctapp: "st-ca-app",
  del: "st-de-high",
  fla: "st-fl-high",
  fladistctapp: "st-fl-app",
  ill: "st-il-high",
  illappct: "st-il-app",
  mass: "st-ma-high",
  massappct: "st-ma-app",
  nj: "st-nj-high",
  njsuperct: "st-nj-app",
  ny: "st-ny-high",
  nyappdiv: "st-ny-app",
  pa: "st-pa-high",
  pasuperct: "st-pa-super",
  pacommwlth: "st-pa-comm",
  tex: "st-tx-high",
  texcrimapp: "st-tx-crim",
  texapp: "st-tx-app",
  va: "st-va-high",
  vacapp: "st-va-app",
};

async function main() {
  const key = process.env.COURTLISTENER_API_KEY?.trim();
  if (!key) {
    console.log(JSON.stringify({ ok: false, reason: "COURTLISTENER_API_KEY missing" }));
    process.exit(2);
  }
  const rateMs = Math.max(Number.parseInt(process.env.CL_RATE_MS ?? "2200", 10) || 2200, 2143);
  const cl = new ClRateLimiter(key, rateMs);
  const courts: Array<{ id: string; name: string; jurisdiction: string | null; in_use?: boolean }> = [];
  let url: string | null = `${CL_BASE}/courts/?page_size=100`;
  let pages = 0;
  while (url && pages < 40) {
    pages += 1;
    const res = await cl.fetch(url);
    if (res.status === 429) {
      console.log(
        JSON.stringify({
          ok: true,
          status: "rate_limited",
          retryAfter: cl.lastRetryAfterSec,
          pages,
          courtsSoFar: courts.length,
          apiCalls: cl.apiCalls,
          hardStop: true,
        }),
      );
      process.exit(0);
    }
    if (!res.ok) {
      console.log(JSON.stringify({ ok: false, reason: `courts_http_${res.status}`, pages, apiCalls: cl.apiCalls }));
      process.exit(1);
    }
    const body = (await res.json()) as {
      results?: Array<{
        id: string;
        full_name?: string;
        short_name?: string;
        name?: string;
        jurisdiction?: string;
        in_use?: boolean;
      }>;
      next?: string | null;
    };
    for (const c of body.results || []) {
      courts.push({
        id: c.id,
        name: c.full_name || c.short_name || c.name || "",
        jurisdiction: c.jurisdiction || null,
        in_use: c.in_use,
      });
    }
    url = body.next || null;
  }

  const matches = [];
  const unmatched = [];
  for (const want of WANTED) {
    for (const needle of want.needles) {
      const found = courts.filter((c) => String(c.name).toLowerCase().includes(needle));
      const top = found.slice(0, 5).map((c) => ({ id: c.id, name: c.name, jurisdiction: c.jurisdiction }));
      if (top.length === 0) unmatched.push({ state: want.state, needle });
      else matches.push({ state: want.state, needle, candidates: top });
    }
  }

  const assumedValidated = [];
  for (const [clId, nyayaId] of Object.entries(ASSUMED)) {
    const hit = courts.find((c) => String(c.id).toLowerCase() === clId);
    assumedValidated.push({
      clCourt: clId,
      nyayaCourtId: nyayaId,
      found: Boolean(hit),
      name: hit?.name ?? null,
      jurisdiction: hit?.jurisdiction ?? null,
    });
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        courtsFetched: courts.length,
        pages,
        apiCalls: cl.apiCalls,
        paced: true,
        assumedValidated,
        missingAssumed: assumedValidated.filter((a) => !a.found),
        matches: matches.slice(0, 80),
        unmatched,
        featureAgents: process.env.FEATURE_AGENTS ?? null,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.log(JSON.stringify({ ok: false, err: String((e as Error)?.message || e).slice(0, 400) }));
  process.exit(1);
});
