/**
 * Bounded CourtListener citation-lookup identity client.
 * Default mode: dry-run / mock only. Live fetch requires explicit enableLive=true.
 *
 * Existing ingest posts `{ text }` one citation at a time to POST /citation-lookup/.
 * Batching = unique-target pacing across requests, not multi-cite payload packing,
 * unless a future API contract is verified.
 */

import type { ClIdentityLookupResult } from "./types.js";

export const CL_CITATION_LOOKUP_PATH = "/api/rest/v4/citation-lookup/";
export const CL_DEFAULT_BASE = "https://www.courtlistener.com";

/** Verified from repository ingest tooling: one citation text per POST body. */
export const CL_LOOKUP_TEXTS_PER_REQUEST = 1;

export const CL_QUOTA_DEFAULTS = Object.freeze({
  limitMin: 25,
  limitHour: 300,
  limitDay: 1400,
});

export type ClIdentityClientOptions = {
  apiKey?: string;
  baseUrl?: string;
  /** Hard gate — must be true for any network call. */
  enableLive?: boolean;
  rateLimitMs?: number;
  fetchImpl?: typeof fetch;
  maxCalls?: number;
};

export type ClLookupCheckpoint = {
  completedTargetKeys: string[];
  resolved: number;
  ambiguous: number;
  notFound: number;
  failed: number;
  requestsConsumed: number;
  lastTargetKey?: string | null;
  updatedAt: string;
};

export function emptyCheckpoint(): ClLookupCheckpoint {
  return {
    completedTargetKeys: [],
    resolved: 0,
    ambiguous: 0,
    notFound: 0,
    failed: 0,
    requestsConsumed: 0,
    lastTargetKey: null,
    updatedAt: new Date().toISOString(),
  };
}

export function buildCitationLookupPayload(text: string): { text: string } {
  return { text: String(text || "").trim() };
}

/** Deduplicate target texts while preserving first-seen order. */
export function dedupeLookupTexts(texts: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of texts) {
    const key = String(t || "").trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(String(t).trim());
  }
  return out;
}

/**
 * Parse CourtListener citation-lookup JSON defensively.
 * Multiple plausible clusters → ambiguous (never auto-pick).
 */
export function parseCitationLookupResponse(body: unknown): ClIdentityLookupResult {
  const rows = Array.isArray(body)
    ? body
    : Array.isArray((body as { results?: unknown })?.results)
      ? ((body as { results: unknown[] }).results as unknown[])
      : [];

  if (!rows.length) return { status: "not_found", evidence: ["empty_response"] };

  type Cand = { clusterId: string | null; citations: string[]; caseName: string | null; court: string | null; dateFiled: string | null };
  const candidates: Cand[] = [];

  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const statusOk = r.status == null || Number(r.status) === 200;
    if (!statusOk && Number(r.status) === 404) continue;

    const clusters = Array.isArray(r.clusters)
      ? r.clusters
      : r.cluster
        ? [r.cluster]
        : [];
    const normCites = Array.isArray(r.normalized_citations)
      ? r.normalized_citations.map(String)
      : [];

    for (const cluster of clusters) {
      if (!cluster || typeof cluster !== "object") continue;
      const c = cluster as Record<string, unknown>;
      const clusterId = c.id != null ? String(c.id) : c.cluster_id != null ? String(c.cluster_id) : null;
      const cites = [
        ...normCites,
        ...(Array.isArray(c.citations) ? c.citations.map(String) : []),
        ...(typeof c.citation === "string" ? [c.citation] : []),
      ];
      candidates.push({
        clusterId,
        citations: [...new Set(cites.filter(Boolean))],
        caseName: c.case_name != null ? String(c.case_name) : c.caseName != null ? String(c.caseName) : null,
        court: c.court_id != null ? String(c.court_id) : c.court != null ? String(c.court) : null,
        dateFiled: c.date_filed != null ? String(c.date_filed) : null,
      });
    }
  }

  const withId = candidates.filter((c) => c.clusterId);
  if (withId.length === 0) return { status: "not_found", evidence: ["no_cluster_id"] };
  const uniqueClusterIds = [...new Set(withId.map((c) => c.clusterId!))];
  if (uniqueClusterIds.length > 1) {
    return {
      status: "ambiguous",
      candidates: withId.map((c) => ({ clusterId: c.clusterId, citations: c.citations })),
      evidence: [`clusters:${uniqueClusterIds.join(",")}`],
    };
  }

  const best = withId[0]!;
  return {
    status: "resolved",
    clusterId: best.clusterId!,
    opinionIds: [],
    citations: best.citations,
    caseName: best.caseName,
    court: best.court,
    dateFiled: best.dateFiled,
    evidence: [`cluster:${best.clusterId}`, ...best.citations.slice(0, 4).map((c) => `cite:${c}`)],
  };
}

export function simulateLookupFromFixture(
  text: string,
  fixtures: Record<string, unknown>,
): ClIdentityLookupResult {
  const key = String(text || "").trim();
  const body = fixtures[key] ?? fixtures[key.toLowerCase()];
  if (body === undefined) return { status: "not_found", evidence: ["fixture_miss"] };
  if (body && typeof body === "object" && "status" in (body as object) && (body as { status: string }).status === "failed") {
    return { status: "failed", reason: "fixture_failed", evidence: ["fixture_failed"] };
  }
  return parseCitationLookupResponse(body);
}

export class CourtListenerIdentityClient {
  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly enableLive: boolean;
  private readonly rateLimitMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly maxCalls: number;
  private lastAt = 0;
  calls = 0;

  constructor(opts: ClIdentityClientOptions = {}) {
    this.apiKey = opts.apiKey?.trim() || undefined;
    this.baseUrl = (opts.baseUrl ?? CL_DEFAULT_BASE).replace(/\/$/, "");
    this.enableLive = Boolean(opts.enableLive);
    this.rateLimitMs = opts.rateLimitMs ?? 5000;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.maxCalls = opts.maxCalls ?? 1;
  }

  async lookupText(text: string): Promise<ClIdentityLookupResult> {
    if (!this.enableLive) {
      return { status: "failed", reason: "live_disabled", evidence: ["enableLive=false"] };
    }
    if (!this.apiKey) {
      return { status: "failed", reason: "missing_api_key", evidence: ["no_token"] };
    }
    if (this.calls >= this.maxCalls) {
      return { status: "failed", reason: "budget_exhausted", evidence: [`maxCalls=${this.maxCalls}`] };
    }

    const wait = this.rateLimitMs - (Date.now() - this.lastAt);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));

    this.calls += 1;
    this.lastAt = Date.now();
    const url = `${this.baseUrl}${CL_CITATION_LOOKUP_PATH}`;
    try {
      const res = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          Authorization: `Token ${this.apiKey}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(buildCitationLookupPayload(text)),
      });
      if (res.status === 429) return { status: "failed", reason: "rate_limited", evidence: ["http_429"] };
      if (!res.ok) return { status: "failed", reason: `http_${res.status}`, evidence: [`http_${res.status}`] };
      const body = await res.json();
      return parseCitationLookupResponse(body);
    } catch (e) {
      return { status: "failed", reason: "network_error", evidence: [String((e as Error)?.message || e).slice(0, 200)] };
    }
  }
}

/**
 * Process unique targets with checkpointing. Live calls only when client.enableLive.
 * Default path uses fixtures for simulation.
 */
export async function runIdentityBatch(params: {
  texts: string[];
  checkpoint: ClLookupCheckpoint;
  client?: CourtListenerIdentityClient;
  fixtures?: Record<string, unknown>;
  maxRequests?: number;
}): Promise<{
  checkpoint: ClLookupCheckpoint;
  results: Array<{ text: string; result: ClIdentityLookupResult }>;
  edgesBackfillableEstimate: number;
}> {
  const maxRequests = params.maxRequests ?? params.texts.length;
  const completed = new Set(params.checkpoint.completedTargetKeys.map((k) => k.toLowerCase()));
  const results: Array<{ text: string; result: ClIdentityLookupResult }> = [];
  const cp: ClLookupCheckpoint = {
    ...params.checkpoint,
    completedTargetKeys: [...params.checkpoint.completedTargetKeys],
  };

  let requests = 0;
  for (const text of dedupeLookupTexts(params.texts)) {
    const key = text.toLowerCase();
    if (completed.has(key)) continue;
    if (requests >= maxRequests) break;

    let result: ClIdentityLookupResult;
    if (params.fixtures) {
      result = simulateLookupFromFixture(text, params.fixtures);
    } else if (params.client) {
      result = await params.client.lookupText(text);
    } else {
      result = { status: "failed", reason: "no_client_or_fixture", evidence: [] };
    }
    requests += 1;
    cp.requestsConsumed += 1;
    cp.lastTargetKey = key;
    cp.completedTargetKeys.push(key);
    completed.add(key);
    results.push({ text, result });

    if (result.status === "resolved") cp.resolved += 1;
    else if (result.status === "ambiguous") cp.ambiguous += 1;
    else if (result.status === "not_found") cp.notFound += 1;
    else cp.failed += 1;
  }
  cp.updatedAt = new Date().toISOString();
  return { checkpoint: cp, results, edgesBackfillableEstimate: cp.resolved };
}
