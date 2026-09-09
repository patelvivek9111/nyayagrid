/**
 * In-process Ask + Contradiction certification against frozen golden fixtures.
 * Forces one direct adapter. Does not use Auto. Does not print secrets.
 */
import {
  constrainCitedAnswer,
  createDirectProvider,
  estimateCostUsd,
  parseJsonObject,
  redactEnvSecrets,
  validateCitedAnswerAgainstPassages,
  type DirectProviderId,
} from "../index";
import { assessRetrievedEvidenceDeterministic } from "../evidence-assessment";
import { GRADED_CASES, gradedCaseToPrompt } from "./graded-cases";
import { CONTRADICTION_CASES, contradictionCaseToPrompt } from "./graded-cases-contradiction";
import { gradeCitedAnswer } from "./grade";
import { gradeContradictionCase } from "./grade-contradiction";
import {
  EvalBudgetTracker,
  LIVE_EVAL_TEMPERATURE,
  resolveLiveEvalConfig,
} from "./live-config";
import type { CaseQualityFlags } from "./metrics";
import { classifyCredentialFailure } from "../router/errors";
import {
  CertProviderCircuit,
  LiveAttemptGate,
  runIsolatedProviderCall,
} from "../cert-transport";
import { resolveCertTimeoutConfig } from "../cert-transport/timeouts";

export type CertTaskVerdict = "PASS" | "NEEDS_WORK" | "FAIL" | "CRITICAL";

export type CertTaskResult = {
  taskId: string;
  subsystem: "ask" | "contradiction";
  verdict: CertTaskVerdict;
  failureClass: string | null;
  passed: boolean;
  latencyMs: number;
  structuredOk: boolean;
  repeats: number;
  details: string;
};

export type CertSubsystemRun = {
  subsystem: "ask" | "contradiction";
  provider: DirectProviderId;
  requestedModel: string;
  resolvedModel: string;
  tasksAttempted: number;
  minTasksForCertification: number;
  pass: number;
  needsWork: number;
  fail: number;
  critical: number;
  materialQualityPct: number | null;
  criticalSafetyPct: number | null;
  citationValidityPct: number | null;
  abstentionCorrectnessPct: number | null;
  structuredSuccessPct: number | null;
  latencyMedianMs: number | null;
  latencyP95Ms: number | null;
  tokens: { input: number; output: number };
  estimatedCostKnown: boolean;
  estimatedCostUsd: number | null;
  incomplete: boolean;
  operationallyUnusable: boolean;
  hardTrustViolation: boolean;
  tasks: CertTaskResult[];
};

function redact(text: string): string {
  return redactEnvSecrets(text).slice(0, 240);
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx] ?? null;
}

function worstVerdict(a: CertTaskVerdict, b: CertTaskVerdict): CertTaskVerdict {
  const rank: Record<CertTaskVerdict, number> = {
    PASS: 0,
    NEEDS_WORK: 1,
    FAIL: 2,
    CRITICAL: 3,
  };
  return rank[a] >= rank[b] ? a : b;
}

function askVerdict(params: {
  passed: boolean;
  flags?: CaseQualityFlags;
  structuredOk: boolean;
  timeout: boolean;
  providerError: string | null;
}): { verdict: CertTaskVerdict; failureClass: string | null } {
  if (params.timeout) return { verdict: "FAIL", failureClass: "TIMEOUT" };
  if (params.providerError) return { verdict: "FAIL", failureClass: "PROVIDER_API" };
  if (!params.structuredOk) return { verdict: "FAIL", failureClass: "STRUCTURED_OUTPUT" };
  const flags = params.flags;
  if (flags?.fabricatedCites && flags.fabricatedCites > 0) {
    return { verdict: "CRITICAL", failureClass: "CITATION" };
  }
  if (flags?.falseConfidence) {
    return { verdict: "CRITICAL", failureClass: "FALSE_PREMISE" };
  }
  if ((flags?.citationRelevanceFailures ?? 0) > 0) {
    return { verdict: "CRITICAL", failureClass: "CITATION" };
  }
  if (params.passed) return { verdict: "PASS", failureClass: null };
  if (flags?.falseInsufficient) return { verdict: "FAIL", failureClass: "ABSTENTION" };
  return { verdict: "FAIL", failureClass: "MODEL_REASONING" };
}

async function generateOnce(params: {
  providerId: DirectProviderId;
  modelId: string;
  taskId: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  timeoutMs: number;
  budget: EvalBudgetTracker;
  circuit: CertProviderCircuit;
  gate: LiveAttemptGate;
}): Promise<{ text: string; model?: string; usage?: { inputTokens?: number; outputTokens?: number }; latencyMs: number }> {
  const blocked = params.budget.wouldExceedBudget();
  if (blocked) throw new Error(blocked);
  if (params.circuit.isOpen(params.providerId, params.modelId)) {
    throw new Error("NOT_RUN_PROVIDER_UNSTABLE");
  }
  const started = Date.now();
  const outcome = await runIsolatedProviderCall({
    provider: params.providerId,
    modelId: params.modelId,
    taskId: params.taskId,
    messages: params.messages,
    temperature: LIVE_EVAL_TEMPERATURE,
    circuit: params.circuit,
    gate: params.gate,
    timeouts: resolveCertTimeoutConfig({
      CERT_REQUEST_TIMEOUT_MS: String(params.timeoutMs),
      CERT_HARD_WATCHDOG_MS: String(params.timeoutMs + 15_000),
      CERT_TERMINATION_WAIT_MS: "5000",
    }),
  });
  if (outcome.normalizedError === "NOT_RUN_PROVIDER_UNSTABLE") {
    throw new Error("NOT_RUN_PROVIDER_UNSTABLE");
  }
  if (outcome.status !== "ok" || !outcome.result?.text) {
    throw new Error(outcome.status);
  }
  params.budget.recordUsage(outcome.usage);
  return {
    text: outcome.result.text,
    model: outcome.result.model,
    usage: outcome.usage,
    latencyMs: outcome.latencyMs ?? Date.now() - started,
  };
}

function logLine(line: string): void {
  process.stdout.write(`${line}\n`);
}

export async function runAskContradictionCert(params: {
  provider: DirectProviderId;
  timeoutMs?: number;
  maxUsd?: number;
  maxTokens?: number;
  skipAskIds?: string[];
  onlyAskIds?: string[];
  skipAsk?: boolean;
  preloadedAsk?: CertTaskResult[];
  skipContradictionIds?: string[];
  onlyContradictionIds?: string[];
  skipContradiction?: boolean;
  preloadedContradiction?: CertTaskResult[];
  repeatFailures?: boolean;
  repeatPassSample?: boolean;
}): Promise<{
  ask: CertSubsystemRun;
  contradiction: CertSubsystemRun;
  circuitEvents: ReturnType<CertProviderCircuit["events"]["slice"]>;
  hardTimeouts: number;
}> {
  const { modelId } = createDirectProvider({ provider: params.provider });
  const liveConfig = resolveLiveEvalConfig({
    ...process.env,
    EVAL_LIVE: "1",
    EVAL_LIVE_TIMEOUT_MS: String(params.timeoutMs ?? 45_000),
    EVAL_LIVE_MAX_USD: String(params.maxUsd ?? 20),
    EVAL_LIVE_MAX_TOKENS: String(params.maxTokens ?? 2_000_000),
  });
  const budget = new EvalBudgetTracker(liveConfig);
  const timeoutMs = liveConfig.timeoutMs;
  let resolvedModel = modelId;
  const circuit = new CertProviderCircuit();
  const gate = new LiveAttemptGate();

  const skipAsk = new Set(params.skipAskIds ?? []);
  const onlyAsk = params.onlyAskIds ? new Set(params.onlyAskIds) : null;
  const skipCx = new Set(params.skipContradictionIds ?? []);
  const onlyCx = params.onlyContradictionIds ? new Set(params.onlyContradictionIds) : null;
  const askResults: CertTaskResult[] = [...(params.preloadedAsk ?? [])];
  const repeatFailures = params.repeatFailures === true;
  const repeatPassSample = params.repeatPassSample === true;
  const latencies: number[] = [];
  let structuredOkCount = 0;
  let citeAttempted = 0;
  let citeValid = 0;
  let abstentionEligible = 0;
  let abstentionCorrect = 0;

  for (const testCase of GRADED_CASES) {
    if (params.skipAsk) break;
    if (onlyAsk && !onlyAsk.has(testCase.id)) continue;
    if (skipAsk.has(testCase.id)) {
      logLine(`ask skip ${testCase.id}`);
      continue;
    }
    const prompts = gradedCaseToPrompt(testCase);
    const runOnce = async (): Promise<CertTaskResult> => {
      try {
        const result = await generateOnce({
          providerId: params.provider,
          modelId,
          taskId: testCase.id,
          messages: [
            { role: "system", content: prompts.systemPrompt },
            { role: "user", content: prompts.userPrompt },
          ],
          timeoutMs,
          budget,
          circuit,
          gate,
        });
        if (result.model) resolvedModel = result.model;
        latencies.push(result.latencyMs);
        const parsed = parseJsonObject(result.text);
        if (!parsed.ok) {
          return {
            taskId: testCase.id,
            subsystem: "ask",
            verdict: "FAIL",
            failureClass: "STRUCTURED_OUTPUT",
            passed: false,
            latencyMs: result.latencyMs,
            structuredOk: false,
            repeats: 1,
            details: redact("JSON parse failed"),
          };
        }
        structuredOkCount += 1;
        let raw = parsed.value;
        const assessment = assessRetrievedEvidenceDeterministic(testCase.question, testCase.retrieved);
        if (assessment) {
          const validated = validateCitedAnswerAgainstPassages(raw, testCase.retrieved);
          raw = constrainCitedAnswer(validated.answer, assessment, testCase.retrieved);
        }
        const grade = gradeCitedAnswer({
          caseId: testCase.id,
          raw,
          retrieved: testCase.retrieved,
          rubric: testCase.rubric,
          question: testCase.question,
          workflow: "case_qa",
          verifiedIntelligence: testCase.verifiedIntelligence,
          verifiedGraph: testCase.verifiedGraph,
          verifiedMemory: testCase.verifiedMemory,
          shouldRefuse: testCase.shouldRefuse,
          trapKind: testCase.trapKind,
        });
        citeAttempted += grade.flags.attemptedCites;
        citeValid += grade.flags.validCites;
        const expectRefuse =
          Boolean(testCase.shouldRefuse) ||
          testCase.rubric.expectEvidenceState === "insufficient" ||
          Boolean(testCase.trapKind);
        if (expectRefuse) {
          abstentionEligible += 1;
          if (!grade.flags.falseConfidence) abstentionCorrect += 1;
        }
        const mapped = askVerdict({
          passed: grade.passed,
          flags: grade.flags,
          structuredOk: true,
          timeout: false,
          providerError: null,
        });
        return {
          taskId: testCase.id,
          subsystem: "ask",
          verdict: mapped.verdict,
          failureClass: mapped.failureClass,
          passed: grade.passed,
          latencyMs: result.latencyMs,
          structuredOk: true,
          repeats: 1,
          details: redact(grade.dimensions.map((d) => `${d.name}:${d.passed ? "ok" : "fail"}`).join("|")),
        };
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        if (text.includes("NOT_RUN_PROVIDER_UNSTABLE")) {
          return {
            taskId: testCase.id,
            subsystem: "ask",
            verdict: "FAIL",
            failureClass: "NOT_RUN_PROVIDER_UNSTABLE",
            passed: false,
            latencyMs: 0,
            structuredOk: false,
            repeats: 1,
            details: "circuit open",
          };
        }
        const failure = classifyCredentialFailure(error, params.provider);
        const hard = failure === "HARD_TIMEOUT" || text.includes("PROVIDER_HARD_TIMEOUT");
        const timeout = failure === "TIMEOUT" || hard;
        const mapped = askVerdict({
          passed: false,
          structuredOk: false,
          timeout,
          providerError: failure,
        });
        return {
          taskId: testCase.id,
          subsystem: "ask",
          verdict: mapped.verdict,
          failureClass: hard ? "PROVIDER_HARD_TIMEOUT" : mapped.failureClass ?? failure,
          passed: false,
          latencyMs: 0,
          structuredOk: false,
          repeats: 1,
          details: redact(text),
        };
      }
    };

    let first = await runOnce();
    const shouldRepeat =
      repeatFailures &&
      (first.verdict === "FAIL" ||
      first.verdict === "NEEDS_WORK" ||
      first.verdict === "CRITICAL");
    if (shouldRepeat) {
      const second = await runOnce();
        first = {
          ...second,
          verdict: worstVerdict(first.verdict, second.verdict),
          failureClass:
            worstVerdict(first.verdict, second.verdict) === "CRITICAL"
              ? first.failureClass === "CITATION" || second.failureClass === "CITATION"
                ? "CITATION"
                : second.failureClass ?? first.failureClass
              : second.failureClass ?? first.failureClass,
          repeats: 2,
          passed: first.passed && second.passed,
        };
    }
    askResults.push(first);
    logLine(`ask ${askResults.length}/${GRADED_CASES.length} ${first.verdict} ${first.taskId}`);
    if (circuit.isOpen(params.provider, modelId)) {
      logLine(`circuit open provider=${params.provider} model=${modelId}`);
      break;
    }
  }

  // Repeat a small PASS sample for variance.
  const passSample = repeatPassSample
    ? askResults.filter((row) => row.verdict === "PASS").slice(0, 3)
    : [];
  for (const sample of passSample) {
    const testCase = GRADED_CASES.find((c) => c.id === sample.taskId);
    if (!testCase) continue;
    const prompts = gradedCaseToPrompt(testCase);
    try {
      const result = await generateOnce({
        providerId: params.provider,
        modelId,
        taskId: sample.taskId,
        messages: [
          { role: "system", content: prompts.systemPrompt },
          { role: "user", content: prompts.userPrompt },
        ],
        timeoutMs,
        budget,
        circuit,
        gate,
      });
      latencies.push(result.latencyMs);
      const parsed = parseJsonObject(result.text);
      if (!parsed.ok) {
        sample.verdict = worstVerdict(sample.verdict, "FAIL");
        sample.failureClass = "STRUCTURED_OUTPUT";
        sample.repeats += 1;
      }
    } catch {
      sample.verdict = worstVerdict(sample.verdict, "FAIL");
      sample.failureClass = sample.failureClass ?? "PROVIDER_API";
      sample.repeats += 1;
    }
  }

  const contradictionResults: CertTaskResult[] = [...(params.preloadedContradiction ?? [])];
  const cxLatencies: number[] = [];
  let cxStructuredOk = 0;
  let cxCiteAttempted = 0;
  let cxCiteValid = 0;
  let generateCount = 0;

  for (const testCase of CONTRADICTION_CASES) {
    if (params.skipContradiction) break;
    if (onlyCx && !onlyCx.has(testCase.id)) continue;
    if (skipCx.has(testCase.id)) {
      logLine(`contradiction skip ${testCase.id}`);
      continue;
    }
    if (testCase.kind !== "generate") {
      const grade = gradeContradictionCase(testCase, testCase.raw);
      contradictionResults.push({
        taskId: testCase.id,
        subsystem: "contradiction",
        verdict: grade.passed ? "PASS" : "FAIL",
        failureClass: grade.passed ? null : "GRADER",
        passed: grade.passed,
        latencyMs: 0,
        structuredOk: true,
        repeats: 1,
        details: "schema fixture (no provider call)",
      });
      continue;
    }
    generateCount += 1;
    const prompts = contradictionCaseToPrompt(testCase);
    const runOnce = async (): Promise<CertTaskResult> => {
      try {
        const result = await generateOnce({
          providerId: params.provider,
          modelId,
          taskId: testCase.id,
          messages: [
            { role: "system", content: prompts.systemPrompt },
            { role: "user", content: prompts.userPrompt },
          ],
          timeoutMs,
          budget,
          circuit,
          gate,
        });
        if (result.model) resolvedModel = result.model;
        cxLatencies.push(result.latencyMs);
        const parsed = parseJsonObject(result.text);
        if (!parsed.ok) {
          return {
            taskId: testCase.id,
            subsystem: "contradiction",
            verdict: "FAIL",
            failureClass: "STRUCTURED_OUTPUT",
            passed: false,
            latencyMs: result.latencyMs,
            structuredOk: false,
            repeats: 1,
            details: redact("JSON parse failed"),
          };
        }
        cxStructuredOk += 1;
        const grade = gradeContradictionCase(testCase, parsed.value);
        cxCiteAttempted += grade.flags.attemptedCites;
        cxCiteValid += grade.flags.validCites;
        const critical = grade.flags.falseConfidence || grade.flags.fabricatedCites > 0;
        return {
          taskId: testCase.id,
          subsystem: "contradiction",
          verdict: critical ? "CRITICAL" : grade.passed ? "PASS" : "FAIL",
          failureClass: critical
            ? grade.flags.fabricatedCites > 0
              ? "CITATION"
              : "FALSE_PREMISE"
            : grade.passed
              ? null
              : "MODEL_REASONING",
          passed: grade.passed,
          latencyMs: result.latencyMs,
          structuredOk: true,
          repeats: 1,
          details: redact(grade.details),
        };
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        if (text.includes("NOT_RUN_PROVIDER_UNSTABLE")) {
          return {
            taskId: testCase.id,
            subsystem: "contradiction",
            verdict: "FAIL",
            failureClass: "NOT_RUN_PROVIDER_UNSTABLE",
            passed: false,
            latencyMs: 0,
            structuredOk: false,
            repeats: 1,
            details: "circuit open",
          };
        }
        const failure = classifyCredentialFailure(error, params.provider);
        const hard = failure === "HARD_TIMEOUT" || text.includes("PROVIDER_HARD_TIMEOUT");
        return {
          taskId: testCase.id,
          subsystem: "contradiction",
          verdict: "FAIL",
          failureClass: hard
            ? "PROVIDER_HARD_TIMEOUT"
            : failure === "TIMEOUT"
              ? "TIMEOUT"
              : "PROVIDER_API",
          passed: false,
          latencyMs: 0,
          structuredOk: false,
          repeats: 1,
          details: redact(text),
        };
      }
    };
    let first = await runOnce();
    if (repeatFailures && first.verdict !== "PASS") {
      const second = await runOnce();
      first = {
        ...second,
        verdict: worstVerdict(first.verdict, second.verdict),
        repeats: 2,
        passed: first.passed && second.passed,
      };
    }
    contradictionResults.push(first);
    logLine(
      `contradiction ${contradictionResults.length}/${CONTRADICTION_CASES.length} ${first.verdict} ${first.taskId}`,
    );
    if (circuit.isOpen(params.provider, modelId)) {
      logLine(`circuit open provider=${params.provider} model=${modelId}`);
      break;
    }
  }

  const snapshot = budget.snapshot();
  const cost = estimateCostUsd({
    modelId: resolvedModel,
    inputTokens: snapshot.inputTokens,
    outputTokens: snapshot.outputTokens,
  });

  const summarize = (
    subsystem: "ask" | "contradiction",
    tasks: CertTaskResult[],
    minTasks: number,
    lats: number[],
    structuredOk: number,
    structuredDenom: number,
    citeAtt: number,
    citeVal: number,
    abstentionNum: number | null,
    abstentionDen: number | null,
  ): CertSubsystemRun => {
    const qualityEligible = tasks.filter((t) => t.failureClass !== "GRADER" || subsystem === "ask");
    const pass = tasks.filter((t) => t.verdict === "PASS").length;
    const needsWork = tasks.filter((t) => t.verdict === "NEEDS_WORK").length;
    const fail = tasks.filter((t) => t.verdict === "FAIL").length;
    const critical = tasks.filter((t) => t.verdict === "CRITICAL").length;
    const attempted = tasks.length;
    const materialDenom = pass + needsWork + fail + critical;
    const unusable = tasks.every(
      (t) => t.failureClass === "PROVIDER_API" || t.failureClass === "TIMEOUT",
    ) && tasks.length > 0;
    return {
      subsystem,
      provider: params.provider,
      requestedModel: modelId,
      resolvedModel,
      tasksAttempted: attempted,
      minTasksForCertification: minTasks,
      pass,
      needsWork,
      fail,
      critical,
      materialQualityPct: materialDenom > 0 ? (pass / materialDenom) * 100 : null,
      criticalSafetyPct: materialDenom > 0 ? ((materialDenom - critical) / materialDenom) * 100 : null,
      citationValidityPct: citeAtt > 0 ? (citeVal / citeAtt) * 100 : null,
      abstentionCorrectnessPct:
        abstentionDen && abstentionDen > 0 && abstentionNum != null
          ? (abstentionNum / abstentionDen) * 100
          : null,
      structuredSuccessPct: structuredDenom > 0 ? (structuredOk / structuredDenom) * 100 : null,
      latencyMedianMs: percentile(lats, 50),
      latencyP95Ms: percentile(lats, 95),
      tokens: { input: snapshot.inputTokens, output: snapshot.outputTokens },
      estimatedCostKnown: cost.known,
      estimatedCostUsd: cost.known ? cost.amountUsd : null,
      incomplete:
        attempted < minTasks ||
        tasks.some(
          (t) =>
            t.failureClass === "NOT_RUN_PROVIDER_UNSTABLE" ||
            t.failureClass === "PROVIDER_HARD_TIMEOUT",
        ),
      operationallyUnusable: unusable,
      hardTrustViolation: false,
      tasks: qualityEligible.map((t) => ({
        ...t,
        details: redact(t.details),
      })),
    };
  };

  return {
    ask: summarize(
      "ask",
      askResults,
      GRADED_CASES.length,
      latencies,
      structuredOkCount,
      GRADED_CASES.length,
      citeAttempted,
      citeValid,
      abstentionCorrect,
      abstentionEligible,
    ),
    contradiction: summarize(
      "contradiction",
      contradictionResults,
      CONTRADICTION_CASES.length,
      cxLatencies,
      cxStructuredOk,
      generateCount,
      cxCiteAttempted,
      cxCiteValid,
      null,
      null,
    ),
    circuitEvents: circuit.events,
    hardTimeouts: circuit.hangCount(params.provider, resolvedModel) || circuit.hangCount(params.provider, modelId),
  };
}
