/**
 * Wave 2B — rate-safe CourtListener short-batch ingest job.
 * One court per invocation; durable checkpoint in corpus_ingest_jobs.
 * Respects Retry-After; exits cleanly on rate_limited (no progress loss).
 * Never prints secrets. FEATURE_AGENTS must stay 0.
 *
 * Env:
 *   CL_COURT (required) — CourtListener court id
 *   CL_BATCH_SIZE (default 5) — max opinions this job processes
 *   CL_TARGET_MAX (default 20) — court target before status=completed
 *   CL_RATE_MS — base spacing between requests (default: dynamic from live limits, else 2200)
 *   CL_BOOTSTRAP_USAGE=1 — fetch /api-usage/ once at start (does not consume user quota)
 *   CL_MINUTE_TARGET / CL_HOUR_TARGET / CL_DAY_TARGET — optional safety ceilings
 *   CL_MAX_RETRIES (default 6)
 *   CL_PROOF=1 — discover/parse only, no persist
 *   DATABASE_URL, COURTLISTENER_API_KEY, OPENAI_API_KEY
 */
import { createHash, randomUUID } from "node:crypto";
import postgres from "postgres";

type QuotaWindow = { limit: number; used: number; remaining: number; resetAt?: string | null };

type QuotaPlan = {
  membershipLevel: string | null;
  membershipActive: boolean | null;
  windows: { minute: QuotaWindow; hour: QuotaWindow; day: QuotaWindow };
  minuteTarget: number;
  hourTarget: number;
  dayTarget: number;
  rateMs: number;
  safeRequests: number;
  elevated: boolean;
};

const CL_BASE = "https://www.courtlistener.com/api/rest/v4";

function parseUsageRows(payload: unknown): QuotaPlan | null {
  if (!payload || typeof payload !== "object") return null;
  const root = payload as {
    membership?: { level?: string; is_active?: boolean };
    current_usage?: Array<Record<string, unknown>>;
  };
  const byPeriod: Partial<Record<"minute" | "hour" | "day", QuotaWindow>> = {};
  for (const row of root.current_usage ?? []) {
    if (String(row.scope ?? "").toLowerCase() !== "user") continue;
    const rate = String(row.rate ?? "").toLowerCase();
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
    const remaining = Number(row.remaining ?? (Number.isFinite(limit) ? limit - used : 0));
    byPeriod[period] = {
      limit: Number.isFinite(limit) ? limit : 0,
      used: Number.isFinite(used) ? used : 0,
      remaining: Number.isFinite(remaining) ? remaining : 0,
      resetAt: typeof row.reset_at === "string" ? row.reset_at : null,
    };
  }
  if (!byPeriod.minute || !byPeriod.hour || !byPeriod.day) return null;
  const windows = { minute: byPeriod.minute, hour: byPeriod.hour, day: byPeriod.day };
  const minuteTarget = Math.max(
    1,
    Number.parseInt(process.env.CL_MINUTE_TARGET ?? "", 10) ||
      Math.floor(windows.minute.limit * (14 / 15)),
  );
  const hourTarget = Math.max(
    1,
    Number.parseInt(process.env.CL_HOUR_TARGET ?? "", 10) ||
      Math.floor(windows.hour.limit * (140 / 150)),
  );
  const dayReserve = Math.max(20, Math.round(windows.day.limit * (20 / 600)));
  const dayTarget = Math.max(
    1,
    Number.parseInt(process.env.CL_DAY_TARGET ?? "", 10) || windows.day.limit - dayReserve,
  );
  const hourUsed = Math.max(0, windows.hour.limit - windows.hour.remaining);
  const dayUsed = Math.max(0, windows.day.limit - windows.day.remaining);
  const minuteRem = Math.max(0, Math.min(windows.minute.remaining, minuteTarget));
  const hourRem = Math.max(0, Math.min(windows.hour.remaining, hourTarget - hourUsed));
  const dayRem = Math.max(0, Math.min(windows.day.remaining, dayTarget - dayUsed));
  const safeRequests = Math.max(0, Math.min(minuteRem, hourRem, dayRem));
  // Prefer minute-safe spacing for batch throughput; hour/day protected via maxCalls.
  const fromMinute = Math.ceil(60_000 / Math.max(1, minuteTarget));
  const rateMs = Math.max(
    Number.parseInt(process.env.CL_RATE_MS ?? "", 10) || 0,
    fromMinute,
  );
  const elevated =
    windows.minute.limit > 5 || windows.hour.limit > 50 || windows.day.limit > 125;
  return {
    membershipLevel: root.membership?.level ?? null,
    membershipActive: root.membership?.is_active ?? null,
    windows,
    minuteTarget,
    hourTarget,
    dayTarget,
    rateMs: Math.max(rateMs, 400),
    safeRequests,
    elevated,
  };
}

async function bootstrapQuotaPlan(apiKey: string): Promise<QuotaPlan | null> {
  try {
    const res = await fetch(`${CL_BASE}/api-usage/`, {
      headers: { Authorization: `Token ${apiKey}`, Accept: "application/json" },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    return parseUsageRows(json);
  } catch {
    return null;
  }
}

const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMS = 384;
const EMBEDDING_BATCH_SIZE = 32;
const MAX_CHUNK_CHARS = 1000;
const MAX_OPINION_CHARS = 40_000;
const SOURCE = "courtlistener";

type CourtMapEntry = {
  courtId: string;
  courtLevel: string;
  authorityState: string;
  courtName: string;
  federalCircuit: string | null;
  jurisdiction: string;
};

const CL_COURT_MAP: Record<string, CourtMapEntry> = {
  scotus: {
    courtId: "us-scotus",
    courtLevel: "scotus",
    authorityState: "US",
    courtName: "Supreme Court of the United States",
    federalCircuit: null,
    jurisdiction: "United States",
  },
  ca1: { courtId: "us-ca-1", courtLevel: "circuit", authorityState: "US", courtName: "United States Court of Appeals for the First Circuit", federalCircuit: "1", jurisdiction: "United States" },
  ca2: { courtId: "us-ca-2", courtLevel: "circuit", authorityState: "US", courtName: "United States Court of Appeals for the Second Circuit", federalCircuit: "2", jurisdiction: "United States" },
  ca3: { courtId: "us-ca-3", courtLevel: "circuit", authorityState: "US", courtName: "United States Court of Appeals for the Third Circuit", federalCircuit: "3", jurisdiction: "United States" },
  ca4: { courtId: "us-ca-4", courtLevel: "circuit", authorityState: "US", courtName: "United States Court of Appeals for the Fourth Circuit", federalCircuit: "4", jurisdiction: "United States" },
  ca5: { courtId: "us-ca-5", courtLevel: "circuit", authorityState: "US", courtName: "United States Court of Appeals for the Fifth Circuit", federalCircuit: "5", jurisdiction: "United States" },
  ca6: { courtId: "us-ca-6", courtLevel: "circuit", authorityState: "US", courtName: "United States Court of Appeals for the Sixth Circuit", federalCircuit: "6", jurisdiction: "United States" },
  ca7: { courtId: "us-ca-7", courtLevel: "circuit", authorityState: "US", courtName: "United States Court of Appeals for the Seventh Circuit", federalCircuit: "7", jurisdiction: "United States" },
  ca8: { courtId: "us-ca-8", courtLevel: "circuit", authorityState: "US", courtName: "United States Court of Appeals for the Eighth Circuit", federalCircuit: "8", jurisdiction: "United States" },
  ca9: { courtId: "us-ca-9", courtLevel: "circuit", authorityState: "US", courtName: "United States Court of Appeals for the Ninth Circuit", federalCircuit: "9", jurisdiction: "United States" },
  ca10: { courtId: "us-ca-10", courtLevel: "circuit", authorityState: "US", courtName: "United States Court of Appeals for the Tenth Circuit", federalCircuit: "10", jurisdiction: "United States" },
  ca11: { courtId: "us-ca-11", courtLevel: "circuit", authorityState: "US", courtName: "United States Court of Appeals for the Eleventh Circuit", federalCircuit: "11", jurisdiction: "United States" },
  cadc: { courtId: "us-ca-dc", courtLevel: "circuit", authorityState: "US", courtName: "United States Court of Appeals for the District of Columbia Circuit", federalCircuit: "dc", jurisdiction: "United States" },
  cafc: { courtId: "us-ca-fed", courtLevel: "circuit", authorityState: "US", courtName: "United States Court of Appeals for the Federal Circuit", federalCircuit: "fed", jurisdiction: "United States" },
  cal: { courtId: "st-ca-high", courtLevel: "state_high", authorityState: "CA", courtName: "Supreme Court of California", federalCircuit: null, jurisdiction: "CA" },
  calctapp: { courtId: "st-ca-app", courtLevel: "state_appellate", authorityState: "CA", courtName: "California Court of Appeal", federalCircuit: null, jurisdiction: "CA" },
  ny: { courtId: "st-ny-high", courtLevel: "state_high", authorityState: "NY", courtName: "New York Court of Appeals", federalCircuit: null, jurisdiction: "NY" },
  nyappdiv: { courtId: "st-ny-app", courtLevel: "state_appellate", authorityState: "NY", courtName: "New York Supreme Court, Appellate Division", federalCircuit: null, jurisdiction: "NY" },
  pa: { courtId: "st-pa-high", courtLevel: "state_high", authorityState: "PA", courtName: "Supreme Court of Pennsylvania", federalCircuit: null, jurisdiction: "PA" },
  pasuperct: { courtId: "st-pa-super", courtLevel: "state_appellate", authorityState: "PA", courtName: "Superior Court of Pennsylvania", federalCircuit: null, jurisdiction: "PA" },
  pacommwlth: { courtId: "st-pa-comm", courtLevel: "state_appellate", authorityState: "PA", courtName: "Commonwealth Court of Pennsylvania", federalCircuit: null, jurisdiction: "PA" },
  tex: { courtId: "st-tx-high", courtLevel: "state_high", authorityState: "TX", courtName: "Supreme Court of Texas", federalCircuit: null, jurisdiction: "TX" },
  texcrimapp: { courtId: "st-tx-crim-high", courtLevel: "state_high", authorityState: "TX", courtName: "Texas Court of Criminal Appeals", federalCircuit: null, jurisdiction: "TX" },
  texapp: { courtId: "st-tx-app", courtLevel: "state_appellate", authorityState: "TX", courtName: "Texas Courts of Appeals", federalCircuit: null, jurisdiction: "TX" },
  nj: { courtId: "st-nj-high", courtLevel: "state_high", authorityState: "NJ", courtName: "Supreme Court of New Jersey", federalCircuit: null, jurisdiction: "NJ" },
  njsuperct: { courtId: "st-nj-app", courtLevel: "state_appellate", authorityState: "NJ", courtName: "Superior Court of New Jersey, Appellate Division", federalCircuit: null, jurisdiction: "NJ" },
  fla: { courtId: "st-fl-high", courtLevel: "state_high", authorityState: "FL", courtName: "Supreme Court of Florida", federalCircuit: null, jurisdiction: "FL" },
  fladistctapp: { courtId: "st-fl-app", courtLevel: "state_appellate", authorityState: "FL", courtName: "Florida District Courts of Appeal", federalCircuit: null, jurisdiction: "FL" },
  ill: { courtId: "st-il-high", courtLevel: "state_high", authorityState: "IL", courtName: "Supreme Court of Illinois", federalCircuit: null, jurisdiction: "IL" },
  illappct: { courtId: "st-il-app", courtLevel: "state_appellate", authorityState: "IL", courtName: "Appellate Court of Illinois", federalCircuit: null, jurisdiction: "IL" },
  mass: { courtId: "st-ma-high", courtLevel: "state_high", authorityState: "MA", courtName: "Supreme Judicial Court of Massachusetts", federalCircuit: null, jurisdiction: "MA" },
  massappct: { courtId: "st-ma-app", courtLevel: "state_appellate", authorityState: "MA", courtName: "Massachusetts Appeals Court", federalCircuit: null, jurisdiction: "MA" },
  va: { courtId: "st-va-high", courtLevel: "state_high", authorityState: "VA", courtName: "Supreme Court of Virginia", federalCircuit: null, jurisdiction: "VA" },
  vacapp: { courtId: "st-va-app", courtLevel: "state_appellate", authorityState: "VA", courtName: "Court of Appeals of Virginia", federalCircuit: null, jurisdiction: "VA" },
  del: { courtId: "st-de-high", courtLevel: "state_high", authorityState: "DE", courtName: "Supreme Court of Delaware", federalCircuit: null, jurisdiction: "DE" },
  // National highs — CL ids verified offline via wave2v-court-verify.txt (HTTP 200)
  la: { courtId: "st-la-high", courtLevel: "state_high", authorityState: "LA", courtName: "Supreme Court of Louisiana", federalCircuit: null, jurisdiction: "LA" },
  dc: { courtId: "st-dc-high", courtLevel: "state_high", authorityState: "DC", courtName: "District of Columbia Court of Appeals", federalCircuit: null, jurisdiction: "DC" },
  idaho: { courtId: "st-id-high", courtLevel: "state_high", authorityState: "ID", courtName: "Idaho Supreme Court", federalCircuit: null, jurisdiction: "ID" },
  mo: { courtId: "st-mo-high", courtLevel: "state_high", authorityState: "MO", courtName: "Supreme Court of Missouri", federalCircuit: null, jurisdiction: "MO" },
  miss: { courtId: "st-ms-high", courtLevel: "state_high", authorityState: "MS", courtName: "Mississippi Supreme Court", federalCircuit: null, jurisdiction: "MS" },
};

/**
 * Offline-persisted CourtListener court verification cache.
 * VERIFIED / MAPPING_INVALID entries must not re-hit /courts/{id}/.
 * Source evidence: packages/research/corpus/reports/wave2v-court-verify.txt + successful ingest.
 */
type CourtVerifyCacheEntry = {
  status: "VERIFIED" | "MAPPING_INVALID" | "NEEDS_SINGLE_VERIFICATION" | "TRANSIENT_RETRY";
  verifiedAt: string;
  fullName?: string | null;
  evidence: string;
};

const COURT_VERIFY_CACHE: Record<string, CourtVerifyCacheEntry> = {
  pacommwlth: {
    status: "MAPPING_INVALID",
    verifiedAt: "2026-09-21T19:02:00.000Z",
    evidence: "wave2v-court-verify.txt /courts/pacommwlth/ → 404",
  },
  njsuperct: {
    status: "MAPPING_INVALID",
    verifiedAt: "2026-09-21T19:02:00.000Z",
    evidence: "wave2v-court-verify.txt /courts/njsuperct/ → 404",
  },
  vacapp: {
    status: "MAPPING_INVALID",
    verifiedAt: "2026-09-21T19:02:00.000Z",
    evidence: "wave2v-court-verify.txt /courts/vacapp/ → 404",
  },
  texapp: {
    status: "VERIFIED",
    verifiedAt: "2026-09-21T19:02:00.000Z",
    fullName: "Court of Appeals of Texas",
    evidence: "wave2v-court-verify.txt /courts/texapp/ → 200; prior ingest>0",
  },
  la: {
    status: "VERIFIED",
    verifiedAt: "2026-09-21T19:02:00.000Z",
    fullName: "Supreme Court of Louisiana",
    evidence: "wave2v-court-verify.txt /courts/la/ → 200",
  },
  dc: {
    status: "VERIFIED",
    verifiedAt: "2026-09-21T19:02:00.000Z",
    fullName: "District of Columbia Court of Appeals",
    evidence: "wave2v-court-verify.txt /courts/dc/ → 200",
  },
  idaho: {
    status: "VERIFIED",
    verifiedAt: "2026-09-21T19:02:00.000Z",
    fullName: "Idaho Supreme Court",
    evidence: "wave2v-court-verify.txt /courts/idaho/ → 200",
  },
  mo: {
    status: "VERIFIED",
    verifiedAt: "2026-09-21T19:02:00.000Z",
    fullName: "Supreme Court of Missouri",
    evidence: "wave2v-court-verify.txt /courts/mo/ → 200",
  },
  miss: {
    status: "VERIFIED",
    verifiedAt: "2026-09-21T19:02:00.000Z",
    fullName: "Mississippi Supreme Court",
    evidence: "wave2v-court-verify.txt /courts/miss/ → 200",
  },
  // Successful Wave-1 opinion ingest = verified without /courts/ re-hit
  ny: { status: "VERIFIED", verifiedAt: "2026-09-21T17:50:00.000Z", evidence: "successful_opinion_ingest" },
  cal: { status: "VERIFIED", verifiedAt: "2026-09-21T17:50:00.000Z", evidence: "successful_opinion_ingest" },
  pa: { status: "VERIFIED", verifiedAt: "2026-09-21T17:50:00.000Z", evidence: "successful_opinion_ingest" },
  nj: { status: "VERIFIED", verifiedAt: "2026-09-21T17:50:00.000Z", evidence: "successful_opinion_ingest" },
  fla: { status: "VERIFIED", verifiedAt: "2026-09-21T17:50:00.000Z", evidence: "successful_opinion_ingest" },
  tex: { status: "VERIFIED", verifiedAt: "2026-09-21T17:50:00.000Z", evidence: "successful_opinion_ingest" },
  texcrimapp: { status: "VERIFIED", verifiedAt: "2026-09-21T17:50:00.000Z", evidence: "successful_opinion_ingest" },
  ill: { status: "VERIFIED", verifiedAt: "2026-09-21T17:50:00.000Z", evidence: "successful_opinion_ingest" },
  mass: { status: "VERIFIED", verifiedAt: "2026-09-21T17:50:00.000Z", evidence: "successful_opinion_ingest" },
  va: { status: "VERIFIED", verifiedAt: "2026-09-21T17:50:00.000Z", evidence: "successful_opinion_ingest" },
  del: { status: "VERIFIED", verifiedAt: "2026-09-21T17:50:00.000Z", evidence: "successful_opinion_ingest" },
  nyappdiv: { status: "VERIFIED", verifiedAt: "2026-09-21T17:57:00.000Z", evidence: "successful_opinion_ingest" },
  calctapp: { status: "VERIFIED", verifiedAt: "2026-09-21T17:57:00.000Z", evidence: "successful_opinion_ingest" },
  pasuperct: { status: "VERIFIED", verifiedAt: "2026-09-21T18:41:00.000Z", evidence: "successful_opinion_ingest" },
  fladistctapp: { status: "VERIFIED", verifiedAt: "2026-09-21T18:44:00.000Z", evidence: "successful_opinion_ingest" },
  illappct: { status: "VERIFIED", verifiedAt: "2026-09-21T18:53:00.000Z", evidence: "successful_opinion_ingest" },
  massappct: { status: "VERIFIED", verifiedAt: "2026-09-21T19:00:00.000Z", evidence: "successful_opinion_ingest" },
};

/**
 * Ensure court mapping is usable. Uses cache first; at most ONE paced /courts/{id}/ call.
 * Never bypasses ClRateLimiter for court verification.
 */
async function ensureCourtVerified(
  cl: ClRateLimiter,
  clCourt: string,
): Promise<{
  ok: boolean;
  status: string;
  fromCache: boolean;
  fullName?: string | null;
  httpStatus?: number;
}> {
  const cached = COURT_VERIFY_CACHE[clCourt];
  if (cached?.status === "VERIFIED") {
    return { ok: true, status: "VERIFIED", fromCache: true, fullName: cached.fullName ?? null };
  }
  if (cached?.status === "MAPPING_INVALID") {
    return { ok: false, status: "MAPPING_INVALID", fromCache: true };
  }

  const res = await cl.fetch(`${CL_BASE}/courts/${encodeURIComponent(clCourt)}/`);
  if (res.status === 429) {
    return { ok: false, status: "rate_limited", fromCache: false, httpStatus: 429 };
  }
  if (res.status === 502 || res.status === 503 || res.status === 504) {
    COURT_VERIFY_CACHE[clCourt] = {
      status: "TRANSIENT_RETRY",
      verifiedAt: new Date().toISOString(),
      evidence: `paced_/courts/${clCourt}/_${res.status}`,
    };
    return { ok: false, status: "TRANSIENT_RETRY", fromCache: false, httpStatus: res.status };
  }
  if (res.status === 404) {
    COURT_VERIFY_CACHE[clCourt] = {
      status: "MAPPING_INVALID",
      verifiedAt: new Date().toISOString(),
      evidence: `paced_/courts/${clCourt}/_404`,
    };
    return { ok: false, status: "MAPPING_INVALID", fromCache: false, httpStatus: 404 };
  }
  if (!res.ok) {
    return { ok: false, status: `verify_http_${res.status}`, fromCache: false, httpStatus: res.status };
  }
  const body = (await res.json().catch(() => ({}))) as { full_name?: string; short_name?: string };
  const fullName = body.full_name || body.short_name || null;
  COURT_VERIFY_CACHE[clCourt] = {
    status: "VERIFIED",
    verifiedAt: new Date().toISOString(),
    fullName,
    evidence: `paced_/courts/${clCourt}/_200`,
  };
  return { ok: true, status: "VERIFIED", fromCache: false, fullName, httpStatus: 200 };
}

type ClHit = {
  id?: number | string;
  cluster_id?: number | string;
  cluster?: string | number | { id?: number | string };
  absolute_url?: string;
  download_url?: string | null;
  case_name?: string;
  caseName?: string;
  citation?: string[] | string;
  date_filed?: string;
  dateFiled?: string;
  docket_number?: string | null;
  docketNumber?: string | null;
  court?: string;
  court_id?: string;
  plain_text?: string;
  html?: string;
  html_with_citations?: string;
  snippet?: string;
  opinions?: Array<{ id?: number | string }>;
  docket?: string | { docket_number?: string | null };
};

type JobRow = {
  id: string;
  status: string;
  cursor: string | null;
  next_page_url: string | null;
  completed_external_ids: string[] | unknown;
  items_discovered: number;
  items_fetched: number;
  items_imported: number;
  items_skipped: number;
  items_failed: number;
  items_quarantined: number;
  rate_limit_count: number;
  api_calls: number;
  target_max: number;
  batch_size: number;
  last_successful_external_id: string | null;
};

type CitationStatus = "reported" | "unreported" | "citation_unknown";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function sanitizeUntrustedLegalText(input: string): string {
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/on\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, " ")
    .replace(/javascript:/gi, "")
    .replace(/ignore previous instructions/gi, "[redacted]")
    .replace(/\s+/g, " ")
    .trim();
}

function stripHtml(html: string): string {
  return sanitizeUntrustedLegalText(html.replace(/<[^>]+>/g, " "));
}

function absoluteUrl(maybe: string | null | undefined): string | null {
  if (!maybe) return null;
  try {
    return new URL(maybe, "https://www.courtlistener.com").toString();
  } catch {
    return maybe;
  }
}

function resolveOpinionId(hit: ClHit): string | null {
  if (hit.id != null && String(hit.id).trim() !== "") return String(hit.id);
  const nested = hit.opinions?.find((o) => o?.id != null);
  if (nested?.id != null) return String(nested.id);
  return null;
}

function resolveClusterId(hit: ClHit): string | null {
  if (hit.cluster_id != null && String(hit.cluster_id).trim() !== "") return String(hit.cluster_id);
  const c = hit.cluster;
  if (typeof c === "number") return String(c);
  if (typeof c === "string") {
    const m = c.match(/\/clusters\/(\d+)\/?/);
    if (m?.[1]) return m[1];
    if (/^\d+$/.test(c.trim())) return c.trim();
  }
  if (c && typeof c === "object" && c.id != null) return String(c.id);
  return null;
}

function pickCitation(hit: ClHit): string | null {
  if (Array.isArray(hit.citation) && hit.citation.length > 0) {
    return String(hit.citation[0]).trim() || null;
  }
  if (typeof hit.citation === "string" && hit.citation.trim()) return hit.citation.trim();
  return null;
}

function pickText(hit: ClHit): string {
  if (hit.plain_text && String(hit.plain_text).trim()) {
    return sanitizeUntrustedLegalText(String(hit.plain_text)).slice(0, MAX_OPINION_CHARS);
  }
  const html = hit.html_with_citations || hit.html || hit.snippet || "";
  return stripHtml(String(html)).slice(0, MAX_OPINION_CHARS);
}

function citationStatus(citation: string | null, docket: string | null): CitationStatus {
  if (citation && citation.trim()) return "reported";
  if (docket && docket.trim()) return "unreported";
  return "citation_unknown";
}

function normalizeCitation(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().toUpperCase();
}

function parseRetryAfterSec(res: Response): number | null {
  const h = res.headers.get("retry-after");
  if (!h) return null;
  const asInt = Number.parseInt(h, 10);
  if (Number.isFinite(asInt) && asInt >= 0) return Math.min(asInt, 3600);
  const when = Date.parse(h);
  if (Number.isFinite(when)) {
    const sec = Math.ceil((when - Date.now()) / 1000);
    return sec > 0 ? Math.min(sec, 3600) : null;
  }
  return null;
}

/** Single-flight CourtListener client — concurrency 1, Retry-After + quota-aware. */
class ClRateLimiter {
  private chain: Promise<void> = Promise.resolve();
  private lastRequestAt = 0;
  private globalPauseUntil = 0;
  apiCalls = 0;
  rateLimitHits = 0;
  lastRetryAfterSec: number | null = null;
  last429Endpoint: string | null = null;
  quotaExhausted = false;
  private maxCalls: number | null = null;

  constructor(
    private readonly apiKey: string,
    private rateMs: number,
    private readonly maxRetries: number,
  ) {}

  setRateMs(ms: number): void {
    this.rateMs = Math.max(400, ms);
  }

  setMaxCalls(n: number | null): void {
    this.maxCalls = n == null ? null : Math.max(0, n);
  }

  async fetch(url: string): Promise<Response> {
    const run = async (): Promise<Response> => {
      let last: Response | null = null;
      for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
        if (this.maxCalls != null && this.apiCalls >= this.maxCalls) {
          this.quotaExhausted = true;
          return new Response(JSON.stringify({ detail: "quota_paused_local" }), {
            status: 429,
            headers: { "Retry-After": "60", "X-Nyaya-Quota-Paused": "1" },
          });
        }
        const now = Date.now();
        const pauseLeft = Math.max(0, this.globalPauseUntil - now);
        const sinceLast = now - this.lastRequestAt;
        const spacing = Math.max(0, this.rateMs - sinceLast);
        const wait = Math.max(pauseLeft, spacing);
        if (wait > 0) await sleep(wait);

        this.apiCalls += 1;
        this.lastRequestAt = Date.now();
        try {
          last = await fetch(url, {
            headers: {
              Authorization: `Token ${this.apiKey}`,
              Accept: "application/json",
            },
            signal: AbortSignal.timeout(90_000),
          });
        } catch (err) {
          const msg = String(err instanceof Error ? err.message : err);
          const isTimeout = /timeout|aborted|AbortError|TimeoutError/i.test(msg);
          if (!isTimeout || attempt >= this.maxRetries) throw err;
          const backoffSec = Math.min(15 + attempt * 10 + Math.floor(Math.random() * 5), 60);
          this.lastRetryAfterSec = backoffSec;
          this.globalPauseUntil = Date.now() + backoffSec * 1000;
          await sleep(backoffSec * 1000);
          continue;
        }

        if (last.status !== 429) return last;

        this.rateLimitHits += 1;
        this.last429Endpoint = url.split("?")[0] ?? url;
        if (last.headers.get("X-Nyaya-Quota-Paused") === "1") {
          this.quotaExhausted = true;
          this.lastRetryAfterSec = 60;
          return last;
        }
        const retryAfter = parseRetryAfterSec(last) ?? Math.min(
          Math.floor((this.rateMs * Math.pow(2, attempt + 1) + Math.random() * 1000) / 1000),
          120,
        );
        this.lastRetryAfterSec = retryAfter;
        // If CL asks for a multi-minute+ pause, exit to caller — do not sleep hours in-process.
        if (retryAfter > 300) {
          return last;
        }
        this.globalPauseUntil = Date.now() + retryAfter * 1000;
        if (attempt >= this.maxRetries) return last;
        await sleep(retryAfter * 1000);
      }
      return last!;
    };

    const next = this.chain.then(run, run);
    this.chain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
}

async function ensureJobTable(sql: postgres.Sql): Promise<void> {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS corpus_ingest_jobs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      source text NOT NULL,
      court_id text NOT NULL,
      cl_court text NOT NULL,
      status text NOT NULL DEFAULT 'pending',
      cursor text,
      last_successful_external_id text,
      completed_external_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
      items_discovered integer NOT NULL DEFAULT 0,
      items_fetched integer NOT NULL DEFAULT 0,
      items_imported integer NOT NULL DEFAULT 0,
      items_skipped integer NOT NULL DEFAULT 0,
      items_failed integer NOT NULL DEFAULT 0,
      items_quarantined integer NOT NULL DEFAULT 0,
      rate_limit_count integer NOT NULL DEFAULT 0,
      api_calls integer NOT NULL DEFAULT 0,
      target_max integer NOT NULL DEFAULT 20,
      batch_size integer NOT NULL DEFAULT 5,
      next_page_url text,
      last_retry_after_sec integer,
      last_error text,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      started_at timestamptz,
      updated_at timestamptz DEFAULT now() NOT NULL,
      completed_at timestamptz,
      created_at timestamptz DEFAULT now() NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS corpus_ingest_jobs_source_court_uidx
      ON corpus_ingest_jobs (source, cl_court);
  `);
}

function asIdList(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === "string") {
    try {
      const p = JSON.parse(raw);
      return Array.isArray(p) ? p.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

async function loadOrCreateJob(
  sql: postgres.Sql,
  clCourt: string,
  mapped: CourtMapEntry,
  targetMax: number,
  batchSize: number,
): Promise<JobRow> {
  const existing = await sql`
    select * from corpus_ingest_jobs
    where source = ${SOURCE} and cl_court = ${clCourt}
    limit 1
  `;
  if (existing.length > 0) {
    const row = existing[0] as JobRow;
    await sql`
      update corpus_ingest_jobs set
        status = ${row.status === "completed" ? "completed" : "running"},
        target_max = ${targetMax},
        batch_size = ${batchSize},
        started_at = coalesce(started_at, now()),
        updated_at = now()
      where id = ${row.id}
    `;
    return { ...row, target_max: targetMax, batch_size: batchSize };
  }
  const id = randomUUID();
  await sql`
    insert into corpus_ingest_jobs (
      id, source, court_id, cl_court, status, target_max, batch_size, started_at, metadata
    ) values (
      ${id}, ${SOURCE}, ${mapped.courtId}, ${clCourt}, ${"running"},
      ${targetMax}, ${batchSize}, now(), ${sql.json({ wave: "2b" })}
    )
  `;
  const created = await sql`select * from corpus_ingest_jobs where id = ${id} limit 1`;
  return created[0] as JobRow;
}

async function saveJob(
  sql: postgres.Sql,
  jobId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const completedIds = patch.completed_external_ids;
  await sql`
    update corpus_ingest_jobs set
      status = ${String(patch.status ?? "running")},
      cursor = ${patch.cursor != null ? String(patch.cursor) : null},
      next_page_url = ${patch.next_page_url != null ? String(patch.next_page_url) : null},
      last_successful_external_id = ${
        patch.last_successful_external_id != null ? String(patch.last_successful_external_id) : null
      },
      completed_external_ids = ${sql.json(Array.isArray(completedIds) ? completedIds : [])},
      items_discovered = ${Number(patch.items_discovered ?? 0)},
      items_fetched = ${Number(patch.items_fetched ?? 0)},
      items_imported = ${Number(patch.items_imported ?? 0)},
      items_skipped = ${Number(patch.items_skipped ?? 0)},
      items_failed = ${Number(patch.items_failed ?? 0)},
      items_quarantined = ${Number(patch.items_quarantined ?? 0)},
      rate_limit_count = ${Number(patch.rate_limit_count ?? 0)},
      api_calls = ${Number(patch.api_calls ?? 0)},
      last_retry_after_sec = ${
        patch.last_retry_after_sec != null ? Number(patch.last_retry_after_sec) : null
      },
      last_error = ${patch.last_error != null ? String(patch.last_error).slice(0, 500) : null},
      completed_at = ${patch.status === "completed" ? sql`now()` : null},
      updated_at = now()
    where id = ${jobId}
  `;
}

function toPgvector(values: number[]): string {
  return `[${values.join(",")}]`;
}

async function embedBatch(texts: string[], apiKey: string): Promise<number[][]> {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: texts,
      dimensions: EMBEDDING_DIMS,
    }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) throw new Error(`openai_embeddings_${res.status}`);
  const json = (await res.json()) as { data: Array<{ embedding: number[]; index: number }> };
  return [...json.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

async function embedAll(texts: string[], apiKey: string): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += EMBEDDING_BATCH_SIZE) {
    out.push(...(await embedBatch(texts.slice(i, i + EMBEDDING_BATCH_SIZE), apiKey)));
  }
  return out;
}

function chunkContent(content: string): string[] {
  const paragraphs = content
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  const chunks: string[] = [];
  for (const paragraph of paragraphs) {
    if (paragraph.length <= MAX_CHUNK_CHARS) {
      chunks.push(paragraph);
      continue;
    }
    for (let i = 0; i < paragraph.length; i += MAX_CHUNK_CHARS) {
      chunks.push(paragraph.slice(i, i + MAX_CHUNK_CHARS));
    }
  }
  return chunks.length > 0 ? chunks.slice(0, 80) : [content.slice(0, MAX_CHUNK_CHARS)];
}

const CITATION_RES = [
  /\d+ U\.?\s?S\.? \d+/g,
  /\d+ F\.(?:\s?2d|\s?3d|\s?4th)? \d+/g,
  /\d+ F\.\s?Supp\.(?:\s?2d|\s?3d)? \d+/g,
];

function extractCitations(content: string): Array<{ raw: string; normalized: string }> {
  const seen = new Set<string>();
  const out: Array<{ raw: string; normalized: string }> = [];
  for (const re of CITATION_RES) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      const raw = m[0].trim();
      const normalized = normalizeCitation(raw);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      out.push({ raw, normalized });
    }
  }
  return out;
}

const TREATMENT_PATTERNS: Array<{ kind: string; re: RegExp }> = [
  { kind: "overruled", re: /\boverrul(ed|ing)\b/i },
  { kind: "reversed", re: /\brevers(ed|ing)\b/i },
  { kind: "vacated", re: /\bvacat(ed|ing|e)\b/i },
  { kind: "superseded", re: /\bsupersed(ed|ing|es)\b/i },
  { kind: "distinguished", re: /\bdistinguish(ed|ing)\b/i },
  { kind: "followed", re: /\bfollow(ed|ing)\b/i },
  { kind: "criticized", re: /\bcriticiz(ed|ing|e)\b/i },
];

function extractTreatmentSignals(content: string): Array<{ kind: string; sourceSentence: string }> {
  const sentences = content
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 20);
  const found: Array<{ kind: string; sourceSentence: string }> = [];
  const seen = new Set<string>();
  for (const sentence of sentences) {
    for (const pattern of TREATMENT_PATTERNS) {
      if (pattern.re.test(sentence)) {
        const key = `${pattern.kind}:${sentence.slice(0, 80)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        found.push({ kind: pattern.kind, sourceSentence: sentence.slice(0, 500) });
      }
    }
  }
  return found;
}

async function insertCitationEdges(
  sql: postgres.Sql,
  fromAuthorityId: string,
  content: string,
): Promise<number> {
  const cites = extractCitations(content);
  let inserted = 0;
  for (const cit of cites) {
    const dup = await sql`
      select 1 as ok from legal_authority_citations
      where from_authority_id = ${fromAuthorityId}
        and normalized_citation = ${cit.normalized}
      limit 1
    `;
    if (dup.length > 0) continue;
    const matches = await sql`
      select id from legal_authorities
      where normalized_citation = ${cit.normalized}
         or citation = ${cit.raw}
      limit 1
    `;
    const toId = matches.length > 0 ? (matches[0]!.id as string) : null;
    await sql`
      insert into legal_authority_citations (
        id, from_authority_id, to_authority_id, raw_citation, normalized_citation
      ) values (
        ${randomUUID()}, ${fromAuthorityId}, ${toId}, ${cit.raw}, ${cit.normalized}
      )
    `;
    inserted += 1;
  }
  return inserted;
}

async function enrichFromCluster(
  hit: ClHit,
  cl: ClRateLimiter,
): Promise<ClHit | { rateLimited: true; response: Response }> {
  if (pickCitation(hit) || hit.docket_number || hit.docketNumber) return hit;
  const clusterId = resolveClusterId(hit);
  if (!clusterId) return hit;
  const res = await cl.fetch(`${CL_BASE}/clusters/${clusterId}/`);
  if (res.status === 429) return { rateLimited: true, response: res };
  if (!res.ok) return hit;
  const cluster = (await res.json()) as {
    case_name?: string;
    citation?: string[] | string;
    citations?: Array<{ cite?: string } | string>;
    date_filed?: string;
    docket_number?: string | null;
    absolute_url?: string;
    docket?: string | { docket_number?: string | null };
  };
  const cites: string[] = [];
  if (Array.isArray(cluster.citation)) cites.push(...cluster.citation.map(String));
  else if (typeof cluster.citation === "string" && cluster.citation.trim()) cites.push(cluster.citation);
  if (Array.isArray(cluster.citations)) {
    for (const c of cluster.citations) {
      if (typeof c === "string" && c.trim()) cites.push(c);
      else if (c && typeof c === "object" && c.cite) cites.push(String(c.cite));
    }
  }
  let docket =
    cluster.docket_number != null
      ? String(cluster.docket_number)
      : null;
  if (!docket && cluster.docket && typeof cluster.docket === "object" && cluster.docket.docket_number) {
    docket = String(cluster.docket.docket_number);
  }
  let next: ClHit = {
    ...hit,
    case_name: hit.case_name ?? cluster.case_name,
    citation: cites.length > 0 ? cites : hit.citation,
    date_filed: hit.date_filed ?? cluster.date_filed,
    docket_number: hit.docket_number ?? docket,
    absolute_url: hit.absolute_url ?? cluster.absolute_url,
    cluster_id: clusterId,
  };
  if (!pickCitation(next) && !(next.docket_number) && typeof cluster.docket === "string") {
    const abs = cluster.docket.startsWith("http")
      ? cluster.docket
      : `https://www.courtlistener.com${cluster.docket.startsWith("/") ? "" : "/"}${cluster.docket}`;
    const dRes = await cl.fetch(abs);
    if (dRes.status === 429) return { rateLimited: true, response: dRes };
    if (dRes.ok) {
      const body = (await dRes.json()) as { docket_number?: string | null };
      if (body.docket_number) next = { ...next, docket_number: String(body.docket_number) };
    }
  }
  return next;
}

type PersistResult = "imported" | "skipped" | "new_version";

async function persistOne(
  sql: postgres.Sql,
  mapped: CourtMapEntry,
  opinion: {
    sourceExternalId: string;
    title: string;
    citation: string | null;
    docketNumber: string | null;
    decisionDate: string | null;
    content: string;
    contentHash: string;
    canonicalSourceUrl: string | null;
    clCourtId: string;
    retrievedAt: string;
    citationStatus: CitationStatus;
    treatmentSignals: Array<{ kind: string; sourceSentence: string }>;
  },
  apiKey: string,
  opts: { hasCurrentness: boolean; hasLastChecked: boolean; hasCitations: boolean },
): Promise<{ status: PersistResult; citationEdges: number; embeddedChunks: number }> {
  const existing = await sql`
    select id from legal_authorities
    where source_provider = ${SOURCE} and source_external_id = ${opinion.sourceExternalId}
    limit 1
  `;
  const metadata = {
    sourceClass: "PRIMARY_PUBLIC_REPOSITORY",
    adapter: "courtlistener-batch-job",
    clCourt: opinion.clCourtId,
    retrievedAt: opinion.retrievedAt,
    citationStatus: opinion.citationStatus,
    treatmentSignals: opinion.treatmentSignals,
  };

  if (existing.length > 0) {
    const authorityId = existing[0]!.id as string;
    const latest = await sql`
      select id, version_number, sha256 from legal_authority_versions
      where authority_id = ${authorityId} order by version_number desc limit 1
    `;
    if (latest.length > 0 && latest[0]!.sha256 === opinion.contentHash) {
      if (opts.hasLastChecked) {
        await sql`update legal_authorities set last_checked_at = now(), updated_at = now() where id = ${authorityId}`;
      }
      return { status: "skipped", citationEdges: 0, embeddedChunks: 0 };
    }
    // new version path omitted for brevity in short-batch — treat hash change as update
    await sql`update legal_authority_versions set valid_to = now() where authority_id = ${authorityId} and valid_to is null`;
    const nextVersion = Number(latest[0]?.version_number ?? 0) + 1;
    const versionId = randomUUID();
    await sql`
      insert into legal_authority_versions (
        id, authority_id, version_number, content, effective_from, effective_to,
        source_provider, source_metadata, sha256
      ) values (
        ${versionId}, ${authorityId}, ${nextVersion}, ${opinion.content},
        ${opinion.decisionDate}, ${null}, ${SOURCE},
        ${sql.json({ adapter: "courtlistener-batch-job", retrievedAt: opinion.retrievedAt })},
        ${opinion.contentHash}
      )
    `;
    const chunks = chunkContent(opinion.content);
    const vectors = await embedAll(chunks, apiKey);
    for (let i = 0; i < chunks.length; i++) {
      await sql`
        insert into legal_authority_chunks (
          id, authority_id, authority_version_id, chunk_index, content,
          segment_ref, char_start, char_end, embedding, embedding_model
        ) values (
          ${randomUUID()}, ${authorityId}, ${versionId}, ${i}, ${chunks[i]!},
          ${`p${i + 1}`}, ${null}, ${null}, ${toPgvector(vectors[i]!)}::vector,
          ${`${EMBEDDING_MODEL}:${EMBEDDING_DIMS}`}
        )
      `;
    }
    let edges = 0;
    if (opts.hasCitations) edges = await insertCitationEdges(sql, authorityId, opinion.content);
    return { status: "new_version", citationEdges: edges, embeddedChunks: chunks.length };
  }

  const authorityId = randomUUID();
  const versionId = randomUUID();
  const norm = opinion.citation ? normalizeCitation(opinion.citation) : null;
  if (opts.hasCurrentness && opts.hasLastChecked) {
    await sql`
      insert into legal_authorities (
        id, authority_type, jurisdiction, court, court_id, authority_state,
        federal_circuit, court_level, title, citation, normalized_citation,
        docket_number, decision_date, source_provider, source_external_id,
        canonical_source_url, ingestion_status, currentness_status, last_checked_at,
        hierarchy_path, metadata
      ) values (
        ${authorityId}, ${"case"}::authority_type, ${mapped.jurisdiction}, ${mapped.courtName},
        ${mapped.courtId}, ${mapped.authorityState}, ${mapped.federalCircuit}, ${mapped.courtLevel},
        ${opinion.title}, ${opinion.citation}, ${norm}, ${opinion.docketNumber}, ${opinion.decisionDate},
        ${SOURCE}, ${opinion.sourceExternalId}, ${opinion.canonicalSourceUrl},
        'processing'::authority_ingestion_status, 'unknown'::authority_currentness_status, now(),
        ${sql.json([])}, ${sql.json(metadata)}
      )
    `;
  } else {
    await sql`
      insert into legal_authorities (
        id, authority_type, jurisdiction, court, court_id, authority_state,
        federal_circuit, court_level, title, citation, normalized_citation,
        docket_number, decision_date, source_provider, source_external_id,
        canonical_source_url, ingestion_status, hierarchy_path, metadata
      ) values (
        ${authorityId}, ${"case"}::authority_type, ${mapped.jurisdiction}, ${mapped.courtName},
        ${mapped.courtId}, ${mapped.authorityState}, ${mapped.federalCircuit}, ${mapped.courtLevel},
        ${opinion.title}, ${opinion.citation}, ${norm}, ${opinion.docketNumber}, ${opinion.decisionDate},
        ${SOURCE}, ${opinion.sourceExternalId}, ${opinion.canonicalSourceUrl},
        'processing'::authority_ingestion_status, ${sql.json([])}, ${sql.json(metadata)}
      )
    `;
  }
  await sql`
    insert into legal_authority_versions (
      id, authority_id, version_number, content, effective_from, effective_to,
      source_provider, source_metadata, sha256
    ) values (
      ${versionId}, ${authorityId}, 1, ${opinion.content}, ${opinion.decisionDate}, ${null},
      ${SOURCE}, ${sql.json({ adapter: "courtlistener-batch-job", retrievedAt: opinion.retrievedAt })},
      ${opinion.contentHash}
    )
  `;
  const chunks = chunkContent(opinion.content);
  const vectors = await embedAll(chunks, apiKey);
  for (let i = 0; i < chunks.length; i++) {
    await sql`
      insert into legal_authority_chunks (
        id, authority_id, authority_version_id, chunk_index, content,
        segment_ref, char_start, char_end, embedding, embedding_model
      ) values (
        ${randomUUID()}, ${authorityId}, ${versionId}, ${i}, ${chunks[i]!},
        ${`p${i + 1}`}, ${null}, ${null}, ${toPgvector(vectors[i]!)}::vector,
        ${`${EMBEDDING_MODEL}:${EMBEDDING_DIMS}`}
      )
    `;
  }
  await sql`
    update legal_authorities set ingestion_status = 'ready'::authority_ingestion_status, updated_at = now()
    where id = ${authorityId}
  `;
  let edges = 0;
  if (opts.hasCitations) edges = await insertCitationEdges(sql, authorityId, opinion.content);
  return { status: "imported", citationEdges: edges, embeddedChunks: chunks.length };
}

async function hasColumn(sql: postgres.Sql, column: string): Promise<boolean> {
  const rows = await sql`
    select 1 as ok from information_schema.columns
    where table_name = 'legal_authorities' and column_name = ${column} limit 1
  `;
  return rows.length > 0;
}

async function hasCitationsTable(sql: postgres.Sql): Promise<boolean> {
  const rows = await sql`
    select 1 as ok from information_schema.tables
    where table_schema = 'public' and table_name = 'legal_authority_citations' limit 1
  `;
  return rows.length > 0;
}

async function main() {
  const clKey = process.env.COURTLISTENER_API_KEY?.trim();
  const databaseUrl = process.env.DATABASE_URL?.trim();
  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  const clCourt = (process.env.CL_COURT ?? "").trim().toLowerCase();
  const proofMode = process.env.CL_PROOF === "1";
  const batchSize = Math.min(Math.max(Number.parseInt(process.env.CL_BATCH_SIZE ?? "5", 10) || 5, 1), 25);
  const targetMax = Math.min(Math.max(Number.parseInt(process.env.CL_TARGET_MAX ?? "20", 10) || 20, 1), 200);
  const maxRetries = Math.min(Math.max(Number.parseInt(process.env.CL_MAX_RETRIES ?? "6", 10) || 6, 1), 10);
  const bootstrapUsage = process.env.CL_BOOTSTRAP_USAGE !== "0";

  if (!clKey) {
    console.log(JSON.stringify({ ok: false, reason: "COURTLISTENER_API_KEY missing" }));
    process.exit(2);
  }
  if (!clCourt || !/^[a-z0-9_-]+$/i.test(clCourt)) {
    console.log(JSON.stringify({ ok: false, reason: "CL_COURT required" }));
    process.exit(2);
  }
  const mapped = CL_COURT_MAP[clCourt] ?? null;
  if (!mapped) {
    console.log(JSON.stringify({ ok: false, reason: `unmapped_court:${clCourt}`, status: "failed" }));
    process.exit(1);
  }
  // Fail-fast offline: known-invalid court IDs never touch CourtListener.
  const cachedVerify = COURT_VERIFY_CACHE[clCourt];
  if (cachedVerify?.status === "MAPPING_INVALID") {
    console.log(
      JSON.stringify({
        ok: false,
        status: "mapping_invalid",
        reason: "MAPPING_INVALID_CACHED",
        clCourt,
        mappedCourt: mapped.courtId,
        evidence: cachedVerify.evidence,
        courtListenerHttpCalls: 0,
        featureAgents: process.env.FEATURE_AGENTS ?? null,
      }),
    );
    process.exit(1);
  }
  if (!proofMode && (!databaseUrl || !openaiKey)) {
    console.log(JSON.stringify({ ok: false, reason: "DATABASE_URL/OPENAI_API_KEY required" }));
    process.exit(2);
  }

  let quotaPlan: QuotaPlan | null = null;
  if (bootstrapUsage) {
    quotaPlan = await bootstrapQuotaPlan(clKey);
  }
  const rateMs = Math.max(
    Number.parseInt(process.env.CL_RATE_MS ?? "", 10) || 0,
    quotaPlan?.rateMs ?? 2200,
    400,
  );

  const cl = new ClRateLimiter(clKey, rateMs, maxRetries);
  if (quotaPlan) {
    // Minute window refills quickly; cap by hour/day remaining only for short batches.
    const hourUsed = Math.max(0, quotaPlan.windows.hour.limit - quotaPlan.windows.hour.remaining);
    const dayUsed = Math.max(0, quotaPlan.windows.day.limit - quotaPlan.windows.day.remaining);
    const hourRem = Math.max(0, Math.min(quotaPlan.windows.hour.remaining, quotaPlan.hourTarget - hourUsed));
    const dayRem = Math.max(0, Math.min(quotaPlan.windows.day.remaining, quotaPlan.dayTarget - dayUsed));
    const batchBudget = Math.min(hourRem, dayRem, Math.max(batchSize * 12, 40));
    if (batchBudget > 0) cl.setMaxCalls(batchBudget);
  }
  let sql: postgres.Sql | null = null;
  let job: JobRow | null = null;
  const completed = new Set<string>();

  const finish = async (payload: Record<string, unknown>, exitCode = 0) => {
    if (sql && job) {
      try {
        await saveJob(sql, job.id, {
          status: payload.status ?? "paused",
          cursor: payload.cursor ?? job.cursor,
          next_page_url: payload.next_page_url ?? job.next_page_url,
          last_successful_external_id: payload.last_successful_external_id ?? job.last_successful_external_id,
          completed_external_ids: [...completed],
          items_discovered: payload.items_discovered ?? job.items_discovered,
          items_fetched: payload.items_fetched ?? job.items_fetched,
          items_imported: payload.items_imported ?? job.items_imported,
          items_skipped: payload.items_skipped ?? job.items_skipped,
          items_failed: payload.items_failed ?? job.items_failed,
          items_quarantined: payload.items_quarantined ?? job.items_quarantined,
          rate_limit_count: cl.rateLimitHits,
          api_calls: cl.apiCalls,
          last_retry_after_sec: cl.lastRetryAfterSec,
          last_error: payload.last_error ?? null,
        });
      } catch {
        // still emit result
      }
    }
    console.log(JSON.stringify({ ok: payload.ok !== false, ...payload, featureAgents: process.env.FEATURE_AGENTS ?? null }));
    try {
      require("node:fs").writeFileSync(
        "/tmp/cl-batch-result.json",
        JSON.stringify({ ok: payload.ok !== false, ...payload, featureAgents: process.env.FEATURE_AGENTS ?? null }),
      );
    } catch {
      // ignore ephemeral fs failures
    }
    if (sql) await sql.end({ timeout: 5 });
    process.exit(exitCode);
  };

  if (!proofMode) {
    sql = postgres(databaseUrl!, {
      max: 3,
      ssl: "require",
      onnotice: () => undefined,
    });
    await ensureJobTable(sql);
    job = await loadOrCreateJob(sql, clCourt, mapped, targetMax, batchSize);
    for (const id of asIdList(job.completed_external_ids)) completed.add(id);
    if (job.status === "completed" && (job.items_imported + job.items_skipped) >= job.target_max) {
      await finish({
        ok: true,
        status: "completed",
        clCourt,
        mappedCourt: mapped.courtId,
        reason: "already_completed",
        items_imported: job.items_imported,
        items_skipped: job.items_skipped,
        apiCalls: job.api_calls,
      });
      return;
    }
  }

  // Paced court verification (cache hit = zero HTTP; otherwise exactly one /courts/{id}/ via ClRateLimiter)
  const courtVerify = await ensureCourtVerified(cl, clCourt);
  if (!courtVerify.ok) {
    const status =
      courtVerify.status === "rate_limited"
        ? cl.quotaExhausted
          ? "quota_paused"
          : "rate_limited"
        : courtVerify.status === "TRANSIENT_RETRY"
          ? "transient_retry"
          : courtVerify.status === "MAPPING_INVALID"
            ? "mapping_invalid"
            : "failed";
    await finish(
      {
        ok: status === "quota_paused" || status === "rate_limited" || status === "transient_retry",
        status,
        reason: courtVerify.status,
        clCourt,
        mappedCourt: mapped.courtId,
        courtVerify,
        last429Endpoint: cl.last429Endpoint,
        lastRetryAfterSec: cl.lastRetryAfterSec,
        apiCalls: cl.apiCalls,
        cursor: job?.cursor ?? null,
        next_page_url: job?.next_page_url ?? null,
      },
      status === "mapping_invalid" ? 1 : 0,
    );
    return;
  }

  // Discover page (resume from next_page_url when present)
  const pageSize = Math.min(batchSize * 2, 50);
  let discoverUrl =
    job?.next_page_url ||
    `${CL_BASE}/opinions/?${new URLSearchParams({
      cluster__docket__court: clCourt,
      order_by: "-id",
      page_size: String(pageSize),
    })}`;
  let discoverPath: "opinions" | "search" = job?.next_page_url ? "opinions" : "opinions";

  let discoverRes = await cl.fetch(discoverUrl);
  if (discoverRes.status === 429) {
    const paused = cl.quotaExhausted;
    await finish(
      {
        ok: true,
        status: paused ? "quota_paused" : "rate_limited",
        reason: paused ? "LOCAL_QUOTA_SAFETY_FLOOR" : "RATE LIMIT WINDOW REACHED",
        clCourt,
        mappedCourt: mapped.courtId,
        discoverPath,
        last429Endpoint: cl.last429Endpoint,
        lastRetryAfterSec: cl.lastRetryAfterSec,
        rateLimitCount: cl.rateLimitHits,
        apiCalls: cl.apiCalls,
        rateMs,
        quota: quotaPlan
          ? {
              membershipLevel: quotaPlan.membershipLevel,
              elevated: quotaPlan.elevated,
              minuteTarget: quotaPlan.minuteTarget,
              hourTarget: quotaPlan.hourTarget,
              dayTarget: quotaPlan.dayTarget,
              safeRequests: quotaPlan.safeRequests,
              windows: quotaPlan.windows,
            }
          : null,
        cursor: job?.cursor ?? null,
        next_page_url: job?.next_page_url ?? null,
        completedCount: completed.size,
      },
      0,
    );
    return;
  }

  if (!discoverRes.ok && (discoverRes.status === 400 || discoverRes.status === 404)) {
    discoverPath = "search";
    discoverUrl = `${CL_BASE}/search/?${new URLSearchParams({
      type: "o",
      q: "*",
      court: clCourt,
      order_by: "dateFiled desc",
      page_size: String(pageSize),
    })}`;
    discoverRes = await cl.fetch(discoverUrl);
    if (discoverRes.status === 429) {
      await finish(
        {
          ok: true,
          status: "rate_limited",
          reason: "RATE LIMIT WINDOW REACHED",
          clCourt,
          mappedCourt: mapped.courtId,
          discoverPath,
          last429Endpoint: cl.last429Endpoint,
          lastRetryAfterSec: cl.lastRetryAfterSec,
          apiCalls: cl.apiCalls,
        },
        0,
      );
      return;
    }
  }

  if (!discoverRes.ok) {
    await finish(
      {
        ok: false,
        status: "failed",
        reason: `discover_http_${discoverRes.status}`,
        clCourt,
        mappedCourt: mapped.courtId,
        discoverPath,
        apiCalls: cl.apiCalls,
        last_error: `discover_http_${discoverRes.status}`,
      },
      1,
    );
    return;
  }

  const body = (await discoverRes.json()) as {
    results?: ClHit[];
    next?: string | null;
  };
  const hits = body.results ?? [];
  const nextPage = body.next ? absoluteUrl(body.next) : null;
  let itemsDiscovered = (job?.items_discovered ?? 0) + hits.length;
  let itemsFetched = job?.items_fetched ?? 0;
  let itemsImported = job?.items_imported ?? 0;
  let itemsSkipped = job?.items_skipped ?? 0;
  let itemsFailed = job?.items_failed ?? 0;
  let itemsQuarantined = job?.items_quarantined ?? 0;
  let citationEdges = 0;
  let embeddedChunks = 0;
  let lastSuccessful: string | null = job?.last_successful_external_id ?? null;
  const batchSample: Array<Record<string, unknown>> = [];

  const opts = sql
    ? {
        hasCurrentness: await hasColumn(sql, "currentness_status"),
        hasLastChecked: await hasColumn(sql, "last_checked_at"),
        hasCitations: await hasCitationsTable(sql),
      }
    : { hasCurrentness: false, hasLastChecked: false, hasCitations: false };

  let processedThisBatch = 0;
  for (const hit of hits) {
    if (processedThisBatch >= batchSize) break;
    if ((itemsImported + itemsSkipped) >= targetMax) break;

    const id = resolveOpinionId(hit);
    if (!id) {
      itemsQuarantined += 1;
      continue;
    }
    const sourceExternalId = `cl-opinion-${id}`;
    if (completed.has(sourceExternalId)) {
      itemsSkipped += 1;
      processedThisBatch += 1;
      continue;
    }

    try {
      let raw: ClHit = hit;
      const listText = pickText(hit);
      if (listText.length < 200) {
        const opRes = await cl.fetch(`${CL_BASE}/opinions/${id}/`);
        if (opRes.status === 429) {
          await finish(
            {
              ok: true,
              status: cl.quotaExhausted ? "quota_paused" : "rate_limited",
              reason: cl.quotaExhausted ? "LOCAL_QUOTA_SAFETY_FLOOR" : "RATE LIMIT WINDOW REACHED",
              clCourt,
              mappedCourt: mapped.courtId,
              last429Endpoint: cl.last429Endpoint,
              lastRetryAfterSec: cl.lastRetryAfterSec,
              rateLimitCount: cl.rateLimitHits,
              apiCalls: cl.apiCalls,
              cursor: sourceExternalId,
              next_page_url: nextPage,
              items_discovered: itemsDiscovered,
              items_fetched: itemsFetched,
              items_imported: itemsImported,
              items_skipped: itemsSkipped,
              items_failed: itemsFailed,
              items_quarantined: itemsQuarantined,
              last_successful_external_id: lastSuccessful,
              completedCount: completed.size,
              batchProcessed: processedThisBatch,
            },
            0,
          );
          return;
        }
        if (!opRes.ok) {
          itemsFailed += 1;
          processedThisBatch += 1;
          continue;
        }
        raw = (await opRes.json()) as ClHit;
      }
      itemsFetched += 1;

      const enriched = await enrichFromCluster(raw, cl);
      if ("rateLimited" in enriched && enriched.rateLimited) {
        await finish(
          {
            ok: true,
            status: cl.quotaExhausted ? "quota_paused" : "rate_limited",
            reason: cl.quotaExhausted ? "LOCAL_QUOTA_SAFETY_FLOOR" : "RATE LIMIT WINDOW REACHED",
            clCourt,
            mappedCourt: mapped.courtId,
            last429Endpoint: cl.last429Endpoint,
            lastRetryAfterSec: cl.lastRetryAfterSec,
            apiCalls: cl.apiCalls,
            cursor: sourceExternalId,
            next_page_url: nextPage,
            items_discovered: itemsDiscovered,
            items_fetched: itemsFetched,
            items_imported: itemsImported,
            items_skipped: itemsSkipped,
            items_failed: itemsFailed,
            items_quarantined: itemsQuarantined,
            last_successful_external_id: lastSuccessful,
            completedCount: completed.size,
            batchProcessed: processedThisBatch,
          },
          0,
        );
        return;
      }
      raw = enriched as ClHit;

      const content = pickText(raw);
      if (content.length < 20) {
        itemsQuarantined += 1;
        completed.add(sourceExternalId);
        processedThisBatch += 1;
        continue;
      }
      const citation = pickCitation(raw);
      const docket = raw.docket_number
        ? String(raw.docket_number)
        : raw.docketNumber
          ? String(raw.docketNumber)
          : null;
      // Allow docket-backed or CL-id identity; do not discard null reporter cites.
      if (!citation && !docket && !sourceExternalId) {
        itemsQuarantined += 1;
        processedThisBatch += 1;
        continue;
      }
      // Still require docket OR citation for legal identity beyond CL id alone for quarantine clarity —
      // Wave 2B: accept CL external id + URL as identity when text present.
      const title = sanitizeUntrustedLegalText(
        String(raw.case_name ?? raw.caseName ?? `CourtListener opinion ${id}`),
      );
      const status = citationStatus(citation, docket);
      const retrievedAt = new Date().toISOString();
      const opinion = {
        sourceExternalId,
        title: title.length >= 3 ? title : `CourtListener opinion ${id}`,
        citation,
        docketNumber: docket,
        decisionDate: raw.date_filed ?? raw.dateFiled ?? null,
        content,
        contentHash: sha256Hex(content),
        canonicalSourceUrl:
          absoluteUrl(raw.absolute_url) ??
          absoluteUrl(`/opinion/${id}/`) ??
          null,
        clCourtId: clCourt,
        retrievedAt,
        citationStatus: status,
        treatmentSignals: extractTreatmentSignals(content),
      };

      if (proofMode) {
        batchSample.push({
          title: opinion.title,
          citation: opinion.citation,
          docket: opinion.docketNumber,
          citationStatus: opinion.citationStatus,
          court: mapped.courtId,
          url: opinion.canonicalSourceUrl,
        });
        completed.add(sourceExternalId);
        processedThisBatch += 1;
        continue;
      }

      const result = await persistOne(sql!, mapped, opinion, openaiKey!, opts);
      if (result.status === "imported" || result.status === "new_version") {
        itemsImported += 1;
        citationEdges += result.citationEdges;
        embeddedChunks += result.embeddedChunks;
      } else {
        itemsSkipped += 1;
      }
      completed.add(sourceExternalId);
      lastSuccessful = sourceExternalId;
      processedThisBatch += 1;
      batchSample.push({
        title: opinion.title.slice(0, 80),
        citation: opinion.citation,
        docket: opinion.docketNumber,
        citationStatus: opinion.citationStatus,
        persist: result.status,
      });

      // checkpoint after each item
      if (job && sql) {
        await saveJob(sql, job.id, {
          status: "running",
          cursor: sourceExternalId,
          next_page_url: nextPage,
          last_successful_external_id: lastSuccessful,
          completed_external_ids: [...completed],
          items_discovered: itemsDiscovered,
          items_fetched: itemsFetched,
          items_imported: itemsImported,
          items_skipped: itemsSkipped,
          items_failed: itemsFailed,
          items_quarantined: itemsQuarantined,
          rate_limit_count: cl.rateLimitHits,
          api_calls: cl.apiCalls,
          last_retry_after_sec: cl.lastRetryAfterSec,
        });
      }
    } catch (err) {
      itemsFailed += 1;
      processedThisBatch += 1;
      if (job && sql) {
        await saveJob(sql, job.id, {
          status: "running",
          cursor: sourceExternalId,
          next_page_url: nextPage,
          last_successful_external_id: lastSuccessful,
          completed_external_ids: [...completed],
          items_discovered: itemsDiscovered,
          items_fetched: itemsFetched,
          items_imported: itemsImported,
          items_skipped: itemsSkipped,
          items_failed: itemsFailed,
          items_quarantined: itemsQuarantined,
          rate_limit_count: cl.rateLimitHits,
          api_calls: cl.apiCalls,
          last_error: String(err instanceof Error ? err.message : err).slice(0, 400),
        });
      }
    }
  }

  const totalDone = itemsImported + itemsSkipped;
  const status =
    totalDone >= targetMax || (hits.length === 0 && !nextPage)
      ? "completed"
      : "paused";

  await finish({
    ok: true,
    status,
    proofMode,
    clCourt,
    mappedCourt: mapped.courtId,
    discoverPath,
    batchProcessed: processedThisBatch,
    batchSize,
    targetMax,
    items_discovered: itemsDiscovered,
    items_fetched: itemsFetched,
    items_imported: itemsImported,
    items_skipped: itemsSkipped,
    items_failed: itemsFailed,
    items_quarantined: itemsQuarantined,
    citationEdges,
    embeddedChunks,
    cursor: lastSuccessful,
    next_page_url: nextPage,
    completedCount: completed.size,
    rateLimitCount: cl.rateLimitHits,
    lastRetryAfterSec: cl.lastRetryAfterSec,
    last429Endpoint: cl.last429Endpoint,
    apiCalls: cl.apiCalls,
    sample: batchSample.slice(0, 3),
  });
}

main().catch(async (e) => {
  const errText = String(e?.stack || e).slice(0, 2000);
  const isTimeout = /TimeoutError|aborted due to timeout|AbortError/i.test(errText);
  const payload = {
    ok: isTimeout,
    status: isTimeout ? "paused" : "failed",
    reason: isTimeout ? "fetch_timeout_soft_pause" : "unhandled_error",
    last_error: errText.slice(0, 400),
    err: errText,
  };
  // Durable stop: always persist result file so local pollers exit (no orphan loops).
  try {
    require("node:fs").writeFileSync("/tmp/cl-batch-result.json", JSON.stringify(payload));
  } catch {
    // ignore ephemeral fs failures
  }
  console.log(JSON.stringify(payload));
  // Best-effort: pause any running CL job so resume can continue from checkpoint.
  try {
    const databaseUrl = process.env.DATABASE_URL?.trim();
    const clCourt = (process.env.CL_COURT ?? "").trim().toLowerCase();
    if (databaseUrl && clCourt) {
      const sql = postgres(databaseUrl, { max: 1, ssl: "require", idle_timeout: 5, connect_timeout: 20 });
      try {
        await sql`
          update corpus_ingest_jobs
          set status = ${isTimeout ? "paused" : "failed"},
              updated_at = now(),
              last_error = ${errText.slice(0, 400)}
          where source = ${"courtlistener"}
            and cl_court = ${clCourt}
            and status = ${"running"}
        `;
      } finally {
        await sql.end({ timeout: 5 });
      }
    }
  } catch {
    // ignore DB cleanup failures
  }
  process.exit(isTimeout ? 0 : 1);
});
