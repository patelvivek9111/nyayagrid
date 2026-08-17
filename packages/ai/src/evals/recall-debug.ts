/**
 * Diagnose Case Q&A over-refusal: required chunks in the prompt vs rubric.
 *
 * Live Case Q&A does not call production search. `retrieved` is the fixture
 * injected into `buildNyayaUserPrompt`. A missing required chunk here is a
 * fixture/recall problem; if every required chunk is present, a live refuse
 * is model behavior.
 */
import { GRADED_CASES } from "./graded-cases";
import type { GradedCase } from "./grade";

/** Live-3 stable Case Q&A fail set (11 false-insufficient + 2 QA-05 label misses). */
export const PERSISTENT_CASE_QA_FAIL_IDS = [
  "golden-adv-similar-clause-rent-vs-late-fee",
  "golden-notice-period",
  "golden-indemnity-with-amendment",
  "golden-adv-near-miss-term-sheet-rent",
  "golden-adv-near-miss-cam-worksheet",
  "golden-adv-notice-vs-renewal",
  "golden-adv-combine-rent-and-term",
  "golden-adv-combine-notice-and-term",
  "golden-adv-combine-indemnity-and-rent",
  "golden-adv-combine-dispute-and-late-fee",
  "golden-adv-combine-renewal-and-expiration",
  "golden-partial-hedge-indemnity",
  "golden-partial-hedge-term",
] as const;

export type RecallBucket = "retrieval_recall" | "model_behavior" | "partial_retrieval";

export type RecallDiagnosis = {
  caseId: string;
  retrievedChunkIds: string[];
  mustCiteChunkIds: string[];
  missingRequired: string[];
  presentRequired: string[];
  /** Combine cases: both required chunks in the same fixture window. */
  bothRequiredPresent: boolean | null;
  bucket: RecallBucket;
};

export function diagnoseCaseRecall(testCase: GradedCase): RecallDiagnosis {
  const retrievedChunkIds = testCase.retrieved.map((p) => p.chunkId).filter(Boolean);
  const retrievedSet = new Set(retrievedChunkIds);
  const mustCiteChunkIds = testCase.rubric.mustCiteChunkIds ?? [];
  const missingRequired = mustCiteChunkIds.filter((id) => !retrievedSet.has(id));
  const presentRequired = mustCiteChunkIds.filter((id) => retrievedSet.has(id));
  const isCombine = mustCiteChunkIds.length >= 2;
  let bucket: RecallBucket;
  if (mustCiteChunkIds.length === 0) {
    bucket = "model_behavior";
  } else if (missingRequired.length === mustCiteChunkIds.length) {
    bucket = "retrieval_recall";
  } else if (missingRequired.length > 0) {
    bucket = "partial_retrieval";
  } else {
    bucket = "model_behavior";
  }
  return {
    caseId: testCase.id,
    retrievedChunkIds,
    mustCiteChunkIds,
    missingRequired,
    presentRequired,
    bothRequiredPresent: isCombine ? missingRequired.length === 0 : null,
    bucket,
  };
}

export function diagnosePersistentCaseQaFails(
  cases: GradedCase[] = GRADED_CASES,
): RecallDiagnosis[] {
  const wanted = new Set<string>(PERSISTENT_CASE_QA_FAIL_IDS);
  return cases.filter((c) => wanted.has(c.id)).map(diagnoseCaseRecall);
}

export function countRecallBuckets(rows: RecallDiagnosis[]): Record<RecallBucket, number> {
  return {
    retrieval_recall: rows.filter((r) => r.bucket === "retrieval_recall").length,
    partial_retrieval: rows.filter((r) => r.bucket === "partial_retrieval").length,
    model_behavior: rows.filter((r) => r.bucket === "model_behavior").length,
  };
}

export function formatRecallDebugLine(
  row: RecallDiagnosis,
  extra?: { citedChunkIds?: string[]; evidenceState?: string },
): string {
  const cited =
    extra?.citedChunkIds != null ? ` cited=[${extra.citedChunkIds.join(",")}]` : "";
  const state = extra?.evidenceState ? ` evidenceState=${extra.evidenceState}` : "";
  const both =
    row.bothRequiredPresent == null ? "" : ` bothRequiredPresent=${row.bothRequiredPresent}`;
  return (
    `[eval:recall] ${row.caseId} retrieved=[${row.retrievedChunkIds.join(",")}]` +
    ` mustCite=[${row.mustCiteChunkIds.join(",")}] missing=[${row.missingRequired.join(",")}]` +
    ` bucket=${row.bucket}${both}${cited}${state}`
  );
}

export function formatRecallDebugSummary(rows: RecallDiagnosis[]): string {
  const counts = countRecallBuckets(rows);
  const lines = [
    "=== Case Q&A recall diagnosis (fixture chunks vs mustCite; not production search) ===",
    `n=${rows.length} retrieval_recall=${counts.retrieval_recall} partial_retrieval=${counts.partial_retrieval} model_behavior=${counts.model_behavior}`,
    ...rows.map((row) => formatRecallDebugLine(row)),
  ];
  return lines.join("\n");
}

export type PromptLayout = {
  caseId: string;
  retrievedCount: number;
  answeringIndexes: number[];
  answeringIsLast: boolean;
  extraNonRequiredCount: number;
};

export function inspectPromptLayout(testCase: GradedCase): PromptLayout {
  const retrievedChunkIds = testCase.retrieved.map((p) => p.chunkId);
  const mustCite = new Set(testCase.rubric.mustCiteChunkIds ?? []);
  const answeringIndexes = retrievedChunkIds
    .map((id, index) => (mustCite.has(id) ? index : -1))
    .filter((index) => index >= 0);
  const last = retrievedChunkIds.length === 0 ? false : answeringIndexes.includes(retrievedChunkIds.length - 1);
  const extraNonRequiredCount = retrievedChunkIds.filter((id) => !mustCite.has(id)).length;
  return {
    caseId: testCase.id,
    retrievedCount: retrievedChunkIds.length,
    answeringIndexes,
    answeringIsLast: last && answeringIndexes.length > 0,
    extraNonRequiredCount,
  };
}

export function shouldLogRecallDebug(env: NodeJS.ProcessEnv = process.env, live = false): boolean {
  return live || env.EVAL_RECALL_DEBUG === "1";
}
