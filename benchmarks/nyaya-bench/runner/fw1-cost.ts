/**
 * FW1 cost/token controls. No live calls. Independent of frozen V3.1.
 */
import { FW1_MATTERS, documentsFor } from "../datasets/v4-workflow/catalog";

export const XAI_CALLS_PER_MATTER = {
  missingAsk: 1,
  contradiction: 1,
  research: 2,
  asks: 6,
  drafts: 2,
} as const;

export const XAI_PER_MATTER =
  XAI_CALLS_PER_MATTER.missingAsk +
  XAI_CALLS_PER_MATTER.contradiction +
  XAI_CALLS_PER_MATTER.research +
  XAI_CALLS_PER_MATTER.asks +
  XAI_CALLS_PER_MATTER.drafts;

/** Transient retries only. Never a second full-suite pass. */
export const RETRY_ALLOWANCE_PCT = 15;

export const DEFAULT_XAI_CEILING: Record<Fw1CostMode, number> = {
  estimate: 0,
  affected: 80,
  "smoke-pass": 90,
  full: 200,
};

export type Fw1CostMode = "estimate" | "affected" | "smoke-pass" | "full";

const PRICE = {
  grok43In: 1.25,
  grok43Out: 2.5,
  miniIn: 0.15,
  miniOut: 0.6,
};

export type Fw1Estimate = {
  mode: Fw1CostMode;
  matters: number;
  documents: number;
  xaiRequests: number;
  xaiRequestsWithRetry: number;
  extractRequests: number;
  embeddingDocs: number;
  expectedInputTokens: number;
  expectedOutputTokens: number;
  retryAllowance: number;
  requestCeiling: number;
  approximateCostUsd: number;
  expectedDurationMin: number;
  reuseIngest: boolean;
  reuseExtract: boolean;
  bufferUsd: number;
};

export function xaiCallsPerMatter(reuseContradiction: boolean): number {
  return XAI_PER_MATTER - (reuseContradiction ? XAI_CALLS_PER_MATTER.contradiction : 0);
}

export function requestCeiling(mode: Fw1CostMode, override?: string): number {
  const parsed = Number.parseInt(override ?? "", 10);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return DEFAULT_XAI_CEILING[mode];
}

export function budgetPreflightPass(env: Record<string, string | undefined> = process.env): boolean {
  return (env.FW1_BUDGET_PREFLIGHT ?? "").trim().toUpperCase() === "PASS";
}

export function estimateFw1(params: {
  mode: Fw1CostMode;
  matterCount: number;
  docs: number;
  reuseIngest: boolean;
  reuseExtract: boolean;
  reuseContradiction?: boolean;
  ceilingOverride?: string;
}): Fw1Estimate {
  const reuseContradiction = params.reuseContradiction ?? params.reuseExtract;
  const xaiEach = xaiCallsPerMatter(reuseContradiction);
  const xaiRequests = params.matterCount * xaiEach;
  const retryAllowance = Math.ceil(xaiRequests * (RETRY_ALLOWANCE_PCT / 100));
  const xaiRequestsWithRetry = xaiRequests + retryAllowance;
  const extractRequests = params.reuseExtract ? 0 : params.docs;
  const embeddingDocs = params.reuseIngest ? 0 : params.docs;
  const xaiIn = xaiRequestsWithRetry * 2800;
  const xaiOut = xaiRequestsWithRetry * 700;
  const extractIn = extractRequests * 2200;
  const extractOut = extractRequests * 700;
  const xaiUsd = (xaiIn / 1_000_000) * PRICE.grok43In + (xaiOut / 1_000_000) * PRICE.grok43Out;
  const miniUsd = (extractIn / 1_000_000) * PRICE.miniIn + (extractOut / 1_000_000) * PRICE.miniOut;
  const durationPerMatterMin = params.reuseExtract ? 2.1 : 3.5;
  const ceiling = requestCeiling(params.mode, params.ceilingOverride);
  return {
    mode: params.mode,
    matters: params.matterCount,
    documents: params.docs,
    xaiRequests,
    xaiRequestsWithRetry,
    extractRequests,
    embeddingDocs,
    expectedInputTokens: xaiIn + extractIn,
    expectedOutputTokens: xaiOut + extractOut,
    retryAllowance,
    requestCeiling: ceiling,
    approximateCostUsd: Math.round((xaiUsd + miniUsd) * 100) / 100,
    expectedDurationMin: Math.round(params.matterCount * durationPerMatterMin * 10) / 10,
    reuseIngest: params.reuseIngest,
    reuseExtract: params.reuseExtract,
    bufferUsd: 25,
  };
}

export function estimateSelected(mode: Fw1CostMode, matterCount: number, docs: number): Fw1Estimate {
  const planned: Fw1CostMode = mode === "estimate" ? "full" : mode;
  const reuse = planned === "full" || planned === "smoke-pass" || planned === "affected";
  return estimateFw1({
    mode: planned,
    matterCount,
    docs,
    reuseIngest: reuse,
    reuseExtract: reuse,
    reuseContradiction: true,
    ceilingOverride: process.env.FW1_MAX_XAI_REQUESTS,
  });
}

export function docsForCount(ids?: string[]): number {
  const matters = ids?.length ? FW1_MATTERS.filter((m) => ids.includes(m.id)) : FW1_MATTERS;
  return matters.reduce((n, seed) => n + documentsFor(seed).length + 1, 0);
}

export class RequestCapAbort extends Error {
  override readonly name = "RequestCapAbort";
  constructor(public readonly used: number, public readonly cap: number) {
    super(`REQUEST_CAP_ABORT used=${used} cap=${cap}`);
  }
}

export class XaiRequestCounter {
  used = 0;
  constructor(readonly cap: number) {}
  consume(n = 1): void {
    if (this.used + n > this.cap) throw new RequestCapAbort(this.used, this.cap);
    this.used += n;
  }
}
