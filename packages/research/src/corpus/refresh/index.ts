/**
 * Non-CL corpus refresh: cadence, change detection, health, dry-run runner.
 * Deterministic only — no LLMs, no CourtListener, no user Research coupling.
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type RefreshCadenceClass =
  | "regulatory_frequent"
  | "statute_periodic"
  | "court_rules_periodic"
  | "constitution_static"
  | "manual_only";

export type SourceHealthStatus =
  | "healthy"
  | "degraded"
  | "unavailable"
  | "blocked"
  | "parser_failed";

export type ChangeDetectionSignal =
  | "etag"
  | "last_modified"
  | "source_revision_date"
  | "content_hash"
  | "structured_version";

export type RefreshAuthorityTarget = {
  sourceExternalId: string;
  canonicalUrl: string;
  priorContentHash?: string | null;
  priorEtag?: string | null;
  priorLastModified?: string | null;
  citation?: string | null;
};

export type RefreshCheckResult = {
  sourceExternalId: string;
  outcome: "unchanged" | "changed" | "unavailable" | "failed" | "rate_limited";
  httpStatus?: number;
  etag?: string | null;
  lastModified?: string | null;
  contentHash?: string | null;
  signalUsed?: ChangeDetectionSignal;
  error?: string;
  bodyText?: string;
};

export type RefreshDryRunSummary = {
  sourceKey: string;
  jurisdiction: string;
  adapterName: string;
  cadenceClass: RefreshCadenceClass;
  attempted: number;
  unchanged: number;
  changed: number;
  unavailable: number;
  failed: number;
  rateLimited: number;
  httpFetches: number;
  results: RefreshCheckResult[];
};

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function contentHash(text: string): string {
  return sha256(normalizeForHash(text));
}

/** Whitespace-normalized hash input for stable change detection. */
export function normalizeForHash(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

export function detectChange(params: {
  priorHash?: string | null;
  newHash: string;
  priorEtag?: string | null;
  newEtag?: string | null;
  priorLastModified?: string | null;
  newLastModified?: string | null;
}): { changed: boolean; signal: ChangeDetectionSignal } {
  if (params.priorEtag && params.newEtag) {
    return {
      changed: params.priorEtag !== params.newEtag,
      signal: "etag",
    };
  }
  if (params.priorLastModified && params.newLastModified) {
    return {
      changed: params.priorLastModified !== params.newLastModified,
      signal: "last_modified",
    };
  }
  return {
    changed: !params.priorHash || params.priorHash !== params.newHash,
    signal: "content_hash",
  };
}

export type CadencePolicy = {
  classes: Record<
    RefreshCadenceClass,
    { intervalDays: number | null; notes: string }
  >;
};

export async function loadRefreshCadencePolicy(): Promise<CadencePolicy> {
  const here = dirname(fileURLToPath(import.meta.url));
  const path = join(here, "../../../corpus/reports/wave2e-refresh-cadence-policy.json");
  const raw = JSON.parse(await readFile(path, "utf8")) as {
    classes?: CadencePolicy["classes"];
  };
  if (raw.classes) return { classes: raw.classes };
  return {
    classes: {
      regulatory_frequent: { intervalDays: 7, notes: "eCFR / active regs" },
      statute_periodic: { intervalDays: 90, notes: "codified statutes" },
      court_rules_periodic: { intervalDays: 180, notes: "procedural rules" },
      constitution_static: { intervalDays: 365, notes: "rarely amended" },
      manual_only: { intervalDays: null, notes: "no automated refresh" },
    },
  };
}

export function nextEligibleAt(
  cadence: RefreshCadenceClass,
  policy: CadencePolicy,
  from = new Date(),
): Date | null {
  const interval = policy.classes[cadence]?.intervalDays;
  if (interval == null) return null;
  return new Date(from.getTime() + interval * 24 * 60 * 60 * 1000);
}

export function deriveHealthStatus(params: {
  consecutiveFailures: number;
  lastHttpStatus?: number | null;
  blocked?: boolean;
}): SourceHealthStatus {
  if (params.blocked) return "blocked";
  if (params.lastHttpStatus === 429) return "degraded";
  if (params.consecutiveFailures >= 5) return "unavailable";
  if (params.consecutiveFailures >= 2) return "degraded";
  if (params.lastHttpStatus && params.lastHttpStatus >= 500) return "degraded";
  if (params.lastHttpStatus && params.lastHttpStatus >= 400) return "parser_failed";
  return "healthy";
}

/**
 * HEAD/GET check against canonical URL. Never invents body when unavailable.
 */
export async function checkAuthorityUrl(
  target: RefreshAuthorityTarget,
  opts?: { timeoutMs?: number; userAgent?: string },
): Promise<RefreshCheckResult> {
  const timeoutMs = opts?.timeoutMs ?? 20_000;
  try {
    const head = await fetch(target.canonicalUrl, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        "User-Agent": opts?.userAgent ?? "NyayaGridCorpusRefresh/1.0",
        Accept: "*/*",
      },
    });

    if (head.status === 429) {
      return {
        sourceExternalId: target.sourceExternalId,
        outcome: "rate_limited",
        httpStatus: 429,
      };
    }

    if (head.status === 404 || head.status === 410) {
      return {
        sourceExternalId: target.sourceExternalId,
        outcome: "unavailable",
        httpStatus: head.status,
      };
    }

    const etag = head.headers.get("etag");
    const lastModified = head.headers.get("last-modified");

    // Conditional GET when we have validators
    const getHeaders: Record<string, string> = {
      "User-Agent": opts?.userAgent ?? "NyayaGridCorpusRefresh/1.0",
      Accept: "text/html,application/xhtml+xml,text/plain,*/*",
    };
    if (target.priorEtag) getHeaders["If-None-Match"] = target.priorEtag;
    if (target.priorLastModified) getHeaders["If-Modified-Since"] = target.priorLastModified;

    const get = await fetch(target.canonicalUrl, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
      headers: getHeaders,
    });

    if (get.status === 304) {
      return {
        sourceExternalId: target.sourceExternalId,
        outcome: "unchanged",
        httpStatus: 304,
        etag: etag ?? target.priorEtag,
        lastModified: lastModified ?? target.priorLastModified,
        contentHash: target.priorContentHash ?? null,
        signalUsed: target.priorEtag ? "etag" : "last_modified",
      };
    }

    if (get.status === 429) {
      return {
        sourceExternalId: target.sourceExternalId,
        outcome: "rate_limited",
        httpStatus: 429,
      };
    }

    if (!get.ok) {
      return {
        sourceExternalId: target.sourceExternalId,
        outcome: get.status >= 500 ? "failed" : "unavailable",
        httpStatus: get.status,
        error: `http_${get.status}`,
      };
    }

    const body = await get.text();
    const hash = contentHash(body);
    const detection = detectChange({
      priorHash: target.priorContentHash,
      newHash: hash,
      priorEtag: target.priorEtag,
      newEtag: get.headers.get("etag") ?? etag,
      priorLastModified: target.priorLastModified,
      newLastModified: get.headers.get("last-modified") ?? lastModified,
    });

    return {
      sourceExternalId: target.sourceExternalId,
      outcome: detection.changed ? "changed" : "unchanged",
      httpStatus: get.status,
      etag: get.headers.get("etag") ?? etag,
      lastModified: get.headers.get("last-modified") ?? lastModified,
      contentHash: hash,
      signalUsed: detection.signal,
      bodyText: detection.changed ? body.slice(0, 50_000) : undefined,
    };
  } catch (err) {
    return {
      sourceExternalId: target.sourceExternalId,
      outcome: "failed",
      error: String(err instanceof Error ? err.message : err).slice(0, 300),
    };
  }
}

export async function runRefreshDryRun(params: {
  sourceKey: string;
  jurisdiction: string;
  adapterName: string;
  cadenceClass: RefreshCadenceClass;
  targets: RefreshAuthorityTarget[];
  maxTargets?: number;
}): Promise<RefreshDryRunSummary> {
  const max = params.maxTargets ?? params.targets.length;
  const slice = params.targets.slice(0, max);
  const results: RefreshCheckResult[] = [];
  let httpFetches = 0;

  for (const target of slice) {
    const result = await checkAuthorityUrl(target);
    httpFetches += 1;
    results.push(result);
    if (result.outcome === "rate_limited") break;
  }

  return {
    sourceKey: params.sourceKey,
    jurisdiction: params.jurisdiction,
    adapterName: params.adapterName,
    cadenceClass: params.cadenceClass,
    attempted: results.length,
    unchanged: results.filter((r) => r.outcome === "unchanged").length,
    changed: results.filter((r) => r.outcome === "changed").length,
    unavailable: results.filter((r) => r.outcome === "unavailable").length,
    failed: results.filter((r) => r.outcome === "failed").length,
    rateLimited: results.filter((r) => r.outcome === "rate_limited").length,
    httpFetches,
    results,
  };
}
