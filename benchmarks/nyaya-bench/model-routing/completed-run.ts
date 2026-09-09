/**
 * Frozen results from the interrupted nyaya-four-provider-cert-v1 run.
 * OpenAI / Claude / Grok finished. Gemini Ask stopped at 23/51.
 */
import type { DirectProviderId, SubsystemMeasurement } from "@nyayagrid/ai";
import type { CertTaskResult } from "@nyayagrid/ai/evals";

function cell(params: {
  subsystem: SubsystemMeasurement["subsystem"];
  provider: DirectProviderId;
  modelId: string;
  pass: number;
  needsWork?: number;
  fail?: number;
  critical?: number;
  incomplete?: boolean;
  operationallyUnusable?: boolean;
  minTasks?: number;
}): SubsystemMeasurement {
  const needsWork = params.needsWork ?? 0;
  const fail = params.fail ?? 0;
  const critical = params.critical ?? 0;
  const attempted = params.pass + needsWork + fail + critical;
  return {
    subsystem: params.subsystem,
    provider: params.provider,
    modelId: params.modelId,
    tasksAttempted: attempted,
    minTasksForCertification: params.minTasks ?? 1,
    pass: params.pass,
    needsWork,
    fail,
    critical,
    materialQualityPct: attempted > 0 ? (params.pass / attempted) * 100 : null,
    criticalSafetyPct: attempted > 0 ? ((attempted - critical) / attempted) * 100 : null,
    citationValidityPct: null,
    abstentionCorrectnessPct: null,
    structuredSuccessPct: null,
    latencyMedianMs: null,
    latencyP95Ms: null,
    estimatedCostKnown: false,
    hardTrustViolation: false,
    operationallyUnusable: params.operationallyUnusable ?? false,
    incomplete: params.incomplete ?? attempted === 0,
  };
}

const OPENAI = "gpt-4o-mini";
const CLAUDE = "claude-sonnet-4-5-20250929";
const GROK = "grok-3";
const GEMINI = "gemini-3.6-flash";

export const COMPLETED_MEASUREMENTS: SubsystemMeasurement[] = [
  cell({ subsystem: "ask", provider: "openai", modelId: OPENAI, pass: 43, fail: 7, critical: 1, minTasks: 51 }),
  cell({ subsystem: "contradiction", provider: "openai", modelId: OPENAI, pass: 24, critical: 2, minTasks: 26 }),
  cell({ subsystem: "research", provider: "openai", modelId: OPENAI, pass: 15, needsWork: 3 }),
  cell({ subsystem: "draft", provider: "openai", modelId: OPENAI, pass: 18, fail: 2, critical: 2 }),
  cell({ subsystem: "contract", provider: "openai", modelId: OPENAI, pass: 17, fail: 1 }),
  cell({ subsystem: "deposition", provider: "openai", modelId: OPENAI, pass: 15, fail: 1 }),
  cell({ subsystem: "evidence", provider: "openai", modelId: OPENAI, pass: 16 }),
  cell({ subsystem: "compare", provider: "openai", modelId: OPENAI, pass: 3 }),
  cell({ subsystem: "timeline", provider: "openai", modelId: OPENAI, pass: 2 }),
  cell({ subsystem: "graph", provider: "openai", modelId: OPENAI, pass: 13 }),
  cell({ subsystem: "memory", provider: "openai", modelId: OPENAI, pass: 10, needsWork: 3 }),

  cell({ subsystem: "ask", provider: "anthropic", modelId: CLAUDE, pass: 43, fail: 7, critical: 1, minTasks: 51 }),
  cell({ subsystem: "contradiction", provider: "anthropic", modelId: CLAUDE, pass: 25, critical: 1, minTasks: 26 }),
  cell({ subsystem: "research", provider: "anthropic", modelId: CLAUDE, pass: 15, needsWork: 3 }),
  cell({ subsystem: "draft", provider: "anthropic", modelId: CLAUDE, pass: 16, fail: 4, critical: 3 }),
  cell({ subsystem: "contract", provider: "anthropic", modelId: CLAUDE, pass: 8, fail: 10, critical: 3 }),
  cell({ subsystem: "deposition", provider: "anthropic", modelId: CLAUDE, pass: 0, incomplete: true }),
  cell({ subsystem: "evidence", provider: "anthropic", modelId: CLAUDE, pass: 13, incomplete: true }),
  cell({ subsystem: "compare", provider: "anthropic", modelId: CLAUDE, pass: 0, incomplete: true, operationallyUnusable: true }),
  cell({ subsystem: "timeline", provider: "anthropic", modelId: CLAUDE, pass: 0, incomplete: true, operationallyUnusable: true }),
  cell({ subsystem: "graph", provider: "anthropic", modelId: CLAUDE, pass: 1, incomplete: true }),
  cell({ subsystem: "memory", provider: "anthropic", modelId: CLAUDE, pass: 6, incomplete: true }),

  cell({ subsystem: "ask", provider: "xai", modelId: GROK, pass: 48, fail: 3, minTasks: 51 }),
  cell({ subsystem: "contradiction", provider: "xai", modelId: GROK, pass: 26, minTasks: 26 }),
  cell({ subsystem: "research", provider: "xai", modelId: GROK, pass: 16, needsWork: 2 }),
  cell({ subsystem: "draft", provider: "xai", modelId: GROK, pass: 20 }),
  cell({ subsystem: "contract", provider: "xai", modelId: GROK, pass: 18 }),
  cell({ subsystem: "deposition", provider: "xai", modelId: GROK, pass: 11, fail: 5 }),
  cell({ subsystem: "evidence", provider: "xai", modelId: GROK, pass: 16 }),
  cell({ subsystem: "compare", provider: "xai", modelId: GROK, pass: 3 }),
  cell({ subsystem: "timeline", provider: "xai", modelId: GROK, pass: 2 }),
  cell({ subsystem: "graph", provider: "xai", modelId: GROK, pass: 13 }),
  cell({ subsystem: "memory", provider: "xai", modelId: GROK, pass: 10, needsWork: 3 }),

  cell({ subsystem: "ask", provider: "google", modelId: GEMINI, pass: 36, fail: 15, minTasks: 51 }),
  cell({ subsystem: "contradiction", provider: "google", modelId: GEMINI, pass: 25, fail: 1, minTasks: 26 }),
  cell({
    subsystem: "deposition",
    provider: "google",
    modelId: GEMINI,
    pass: 11,
    fail: 1,
    incomplete: true,
  }),
];

const GEMINI_PARTIAL_VERDICTS: Array<{ id: string; verdict: CertTaskResult["verdict"] }> = [
  { id: "golden-lease-commencement", verdict: "FAIL" },
  { id: "golden-lease-expiration", verdict: "PASS" },
  { id: "golden-rent-amount", verdict: "PASS" },
  { id: "golden-rent-annual", verdict: "FAIL" },
  { id: "golden-notice-period", verdict: "PASS" },
  { id: "golden-notice-section", verdict: "FAIL" },
  { id: "golden-indemnity-missing-amendment", verdict: "PASS" },
  { id: "golden-indemnity-with-amendment", verdict: "PASS" },
  { id: "golden-unrelated-capital", verdict: "PASS" },
  { id: "golden-empty-retrieval", verdict: "PASS" },
  { id: "golden-cam-date-conflict", verdict: "FAIL" },
  { id: "golden-cam-date-conflict-incomplete", verdict: "FAIL" },
  { id: "golden-dispute-date", verdict: "FAIL" },
  { id: "golden-invoice-request", verdict: "PASS" },
  { id: "golden-depo-receipt-same-day", verdict: "PASS" },
  { id: "golden-portal-upload-date", verdict: "PASS" },
  { id: "golden-late-fee", verdict: "FAIL" },
  { id: "golden-renewal-notice", verdict: "PASS" },
  { id: "golden-cam-estimate-not-transmittal", verdict: "PASS" },
  { id: "golden-partial-hedge-indemnity", verdict: "PASS" },
  { id: "golden-partial-hedge-term", verdict: "PASS" },
  { id: "golden-qa06-intel-no-docs", verdict: "PASS" },
  { id: "golden-qa06-graph-no-docs", verdict: "FAIL" },
  { id: "golden-qa06-memory-no-docs", verdict: "PASS" },
  { id: "golden-adv-near-miss-commencement", verdict: "PASS" },
  { id: "golden-adv-similar-clause-rent-vs-late-fee", verdict: "PASS" },
  { id: "golden-adv-combine-rent-and-term", verdict: "PASS" },
  { id: "golden-adv-notice-vs-renewal", verdict: "PASS" },
  { id: "golden-adv-near-miss-cam-worksheet", verdict: "PASS" },
  { id: "golden-adv-combine-notice-and-term", verdict: "PASS" },
  { id: "golden-false-rent-amount", verdict: "PASS" },
  { id: "golden-judge-not-in-record", verdict: "PASS" },
  { id: "golden-adv-combine-indemnity-and-rent", verdict: "FAIL" },
  { id: "golden-adv-combine-dispute-and-late-fee", verdict: "FAIL" },
  { id: "golden-adv-combine-renewal-and-expiration", verdict: "FAIL" },
  { id: "golden-adv-near-miss-proposed-commencement", verdict: "FAIL" },
  { id: "golden-adv-near-miss-term-sheet-rent", verdict: "PASS" },
  { id: "golden-adv-near-miss-ninety-day-draft", verdict: "PASS" },
  { id: "golden-access-log-limitation", verdict: "PASS" },
  { id: "golden-false-premise-future-effective", verdict: "PASS" },
  { id: "golden-invoice-silence-not-proof", verdict: "PASS" },
  { id: "golden-email-vs-signed-amendment", verdict: "PASS" },
  { id: "golden-supersession-effective-amendment", verdict: "PASS" },
  { id: "golden-future-effective-current-term", verdict: "FAIL" },
  { id: "golden-future-effective-future-term", verdict: "FAIL" },
  { id: "golden-corroborated-actor-inference", verdict: "PASS" },
  { id: "golden-qualifier-preserve-approximately", verdict: "PASS" },
  { id: "golden-compatible-approx-exact-date", verdict: "FAIL" },
  { id: "golden-named-exhibit-missing", verdict: "PASS" },
  { id: "golden-guardrail-states-operative-days", verdict: "PASS" },
  { id: "golden-evidentiary-tension-testimony-log", verdict: "PASS" },
];

export const GEMINI_PRELOADED_ASK: CertTaskResult[] = GEMINI_PARTIAL_VERDICTS.map((row) => ({
  taskId: row.id,
  subsystem: "ask",
  verdict: row.verdict,
  failureClass: row.verdict === "PASS" ? null : "MODEL_REASONING",
  passed: row.verdict === "PASS",
  latencyMs: 0,
  structuredOk: true,
  repeats: 1,
  details: "preloaded from interrupted run",
}));

export const GEMINI_SKIP_ASK_IDS = GEMINI_PARTIAL_VERDICTS.map((row) => row.id);

const GEMINI_CX_PARTIAL: Array<{ id: string; verdict: CertTaskResult["verdict"] }> = [
  { id: "cx-cam-dual-sided", verdict: "PASS" },
  { id: "cx-cam-dual-sided-reversed", verdict: "FAIL" },
  { id: "cx-before-after", verdict: "PASS" },
  { id: "cx-one-sided-generate", verdict: "PASS" },
  { id: "cx-one-sided-email-only", verdict: "PASS" },
  { id: "cx-empty-sources", verdict: "PASS" },
  { id: "cx-false-positive-paraphrase", verdict: "PASS" },
];

export const GEMINI_PRELOADED_CX: CertTaskResult[] = GEMINI_CX_PARTIAL.map((row) => ({
  taskId: row.id,
  subsystem: "contradiction",
  verdict: row.verdict,
  failureClass: row.verdict === "PASS" ? null : "MODEL_REASONING",
  passed: row.verdict === "PASS",
  latencyMs: 0,
  structuredOk: true,
  repeats: 1,
  details: "preloaded from interrupted run",
}));

export const GEMINI_SKIP_CX_IDS = GEMINI_CX_PARTIAL.map((row) => row.id);
