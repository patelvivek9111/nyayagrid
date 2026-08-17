/**
 * AI eval runner.
 *
 *   npm run eval:ai         — MockAIProvider + golden graded suites + rates (CI-safe)
 *   npm run eval:ai:stress  — GullibleMockProvider vs adversarial subset (no API)
 *   npm run eval:ai:live    — OpenAI with pinned model + budgets when EVAL_LIVE=1
 *
 * Quality bar: docs/AGENT_QUALITY.md · Live docs: docs/AI_EVAL_LIVE.md
 *
 * Repo-root `npm run eval:ai` also runs @nyayagrid/intelligence contract-compare diffs.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MockAIProvider,
  OpenAIProvider,
  citedAnswerSchema,
  validateCitedAnswerAgainstPassages,
  validateQuoteAgainstText,
  NYAYA_PROMPT_VERSION,
  type AIProvider,
} from "../index";
import { CONTRADICTION_ANALYSIS_PROMPT_VERSION } from "../professional";
import { EVAL_CASES, type EvalCase } from "./fixtures";
import { GRADED_CASES, gradedCaseToPrompt, EVAL_CASE_QA_RERANK } from "./graded-cases";
import {
  diagnoseCaseRecall,
  diagnosePersistentCaseQaFails,
  formatRecallDebugLine,
  formatRecallDebugSummary,
  shouldLogRecallDebug,
} from "./recall-debug";
import { gradeCitedAnswer } from "./grade";
import { CONTRADICTION_CASES, contradictionCaseToPrompt } from "./graded-cases-contradiction";
import { gradeContradictionCase } from "./grade-contradiction";
import { CONTRACT_COMPARE_CASES } from "./graded-cases-contract-compare";
import { runCanarySuite, formatCanaryFailure } from "./canary";
import { GullibleMockProvider, decoyClaimPrompt } from "./gullible-mock";
import { gradeGullibleDecoyClaim } from "./grade-gullible-decoy";
import {
  adversarialContradictionCases,
  adversarialQaCases,
  decoyContractCompareCases,
  evaluateStressHarness,
} from "./stress";
import {
  MOCK_GRADED_BASELINES,
  findBaselineRegressions,
} from "./baselines";
import {
  EvalBudgetTracker,
  generateWithEvalTimeout,
  liveEvalSkipReason,
  resolveLiveEvalConfig,
  resolveLiveEvalScope,
  LIVE_EVAL_TEMPERATURE,
  formatLiveRunConfig,
} from "./live-config";
import {
  aggregateWorkflowRates,
  formatWorkflowRateReport,
  type CaseQualityFlags,
  type WorkflowId,
} from "./metrics";
import { formatRepeatVarianceReport, summarizeRepeatVariance } from "./variance";
import { writeReviewExport, type ReviewExportItem } from "./export-review";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");

type EvalOutcome = {
  name: string;
  passed: boolean;
  details: string;
  flags?: CaseQualityFlags;
};

type RunContext = {
  provider: AIProvider;
  live: boolean;
  timeoutMs: number;
  budget: EvalBudgetTracker | null;
  loggedSnapshot?: boolean;
  requestedModel?: string;
  resolvedModel?: string;
  systemFingerprint?: string;
};

async function generate(
  ctx: RunContext,
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
) {
  if (ctx.budget) {
    const blocked = ctx.budget.wouldExceedBudget();
    if (blocked) {
      throw new Error(blocked);
    }
  }
  const request = { messages, temperature: LIVE_EVAL_TEMPERATURE as const };
  const result = ctx.live
    ? await generateWithEvalTimeout(ctx.provider, request, ctx.timeoutMs)
    : await ctx.provider.generate(request);
  ctx.budget?.recordUsage(result.usage);
  if (ctx.live && result && typeof result === "object" && !ctx.loggedSnapshot) {
    ctx.loggedSnapshot = true;
    ctx.resolvedModel = typeof result.model === "string" ? result.model : "(unknown)";
    ctx.systemFingerprint =
      typeof result.systemFingerprint === "string" && result.systemFingerprint
        ? result.systemFingerprint
        : "(none)";
    console.log(
      formatLiveRunConfig({
        promptVersionCaseQa: NYAYA_PROMPT_VERSION,
        promptVersionContradiction: CONTRADICTION_ANALYSIS_PROMPT_VERSION,
        requestedModel: ctx.requestedModel ?? "(unknown)",
        resolvedModel: ctx.resolvedModel,
        systemFingerprint: ctx.systemFingerprint,
        rerank: EVAL_CASE_QA_RERANK,
        temperature: LIVE_EVAL_TEMPERATURE,
      }),
    );
  }
  return result;
}

async function runCase(ctx: RunContext, testCase: EvalCase): Promise<EvalOutcome> {
  try {
    const result = await generate(ctx, [
      { role: "system", content: testCase.systemPrompt },
      { role: "user", content: testCase.userPrompt },
    ]);

    let parsed;
    try {
      parsed = citedAnswerSchema.parse(JSON.parse(result.text));
    } catch (error) {
      return {
        name: testCase.name,
        passed: false,
        details: `Response did not parse as a CitedAnswer: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }

    if (parsed.evidenceState !== testCase.expectEvidenceState) {
      return {
        name: testCase.name,
        passed: false,
        details: `Expected evidenceState="${testCase.expectEvidenceState}", got "${parsed.evidenceState}"`,
      };
    }

    if (testCase.expectEvidenceState === "insufficient" && parsed.sources.length > 0) {
      return {
        name: testCase.name,
        passed: false,
        details: `An insufficient-evidence answer must not cite sources (got ${parsed.sources.length})`,
      };
    }

    if (testCase.expectEvidenceState === "grounded") {
      if (parsed.sources.length === 0) {
        return {
          name: testCase.name,
          passed: false,
          details: "A grounded answer must cite at least one source",
        };
      }
      const passages = testCase.passages ?? [];
      for (const source of parsed.sources) {
        const passage =
          passages.find((p) => p.chunkId === source.chunkId) ??
          passages.find(
            (p) =>
              p.documentId === source.documentId &&
              p.documentVersionId === source.documentVersionId,
          );
        if (!passage) {
          return {
            name: testCase.name,
            passed: false,
            details: `Cited source is not in provided passages: chunkId=${source.chunkId}`,
          };
        }
        const quoteCheck = validateQuoteAgainstText(source.quote, passage.quote);
        if (!quoteCheck.valid) {
          return {
            name: testCase.name,
            passed: false,
            details: `Cited quote failed verbatim check: ${quoteCheck.reason}`,
          };
        }
      }

      const validated = validateCitedAnswerAgainstPassages(parsed, passages);
      if (validated.answer.evidenceState !== "grounded" || validated.rejectedCitations > 0) {
        return {
          name: testCase.name,
          passed: false,
          details: `Post-validator state=${validated.answer.evidenceState}, rejected=${validated.rejectedCitations}`,
        };
      }
    }

    return {
      name: testCase.name,
      passed: true,
      details: `evidenceState=${parsed.evidenceState}, sources=${parsed.sources.length}`,
    };
  } catch (error) {
    return {
      name: testCase.name,
      passed: false,
      details: error instanceof Error ? error.message : String(error),
    };
  }
}

async function runGradedCase(
  ctx: RunContext,
  testCase: (typeof GRADED_CASES)[number],
): Promise<{ outcome: EvalOutcome; exportItem: ReviewExportItem }> {
  const prompts = gradedCaseToPrompt(testCase);
  try {
    const result = await generate(ctx, [
      { role: "system", content: prompts.systemPrompt },
      { role: "user", content: prompts.userPrompt },
    ]);
    let raw: unknown;
    try {
      raw = JSON.parse(result.text);
    } catch (error) {
      return {
        outcome: {
          name: testCase.id,
          passed: false,
          details: `JSON parse failed: ${error instanceof Error ? error.message : String(error)}`,
        },
        exportItem: {
          workflow: "case_qa",
          id: testCase.id,
          description: testCase.description,
          input: testCase.question,
          output: result.text,
          sources: "(unparseable)",
        },
      };
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

    if (shouldLogRecallDebug(process.env, ctx.live)) {
      console.log(
        formatRecallDebugLine(diagnoseCaseRecall(testCase), {
          citedChunkIds: (grade.answer?.sources ?? []).map((s) => s.chunkId).filter(Boolean),
          evidenceState: grade.answer?.evidenceState,
        }),
      );
    }

    const regressions = ctx.live
      ? findBaselineRegressions({
          caseId: testCase.id,
          dimensions: grade.dimensions,
          baseline: MOCK_GRADED_BASELINES,
        })
      : [];

    const passed = grade.passed && regressions.length === 0;
    const regressionDetail =
      regressions.length > 0
        ? ` | baseline_regression:${regressions.map((r) => `${r.dimension}`).join(",")}`
        : "";

    return {
      outcome: {
        name: testCase.id,
        passed,
        details:
          grade.dimensions.map((d) => `${d.name}:${d.passed ? "ok" : d.detail}`).join(" | ") +
          regressionDetail,
        flags: { ...grade.flags, passed },
      },
      exportItem: {
        workflow: "case_qa",
        id: testCase.id,
        description: testCase.description,
        input: testCase.question,
        output: grade.answer?.answer ?? JSON.stringify(raw, null, 2),
        sources: (grade.answer?.sources ?? [])
          .map((s) => `- ${s.chunkId}: ${s.quote}`)
          .join("\n"),
        evidenceState: grade.answer?.evidenceState,
      },
    };
  } catch (error) {
    return {
      outcome: {
        name: testCase.id,
        passed: false,
        details: error instanceof Error ? error.message : String(error),
      },
      exportItem: {
        workflow: "case_qa",
        id: testCase.id,
        description: testCase.description,
        input: testCase.question,
        output: error instanceof Error ? error.message : String(error),
        sources: "(none)",
      },
    };
  }
}

async function runContradictionCase(
  ctx: RunContext,
  testCase: (typeof CONTRADICTION_CASES)[number],
): Promise<{ outcome: EvalOutcome; exportItem: ReviewExportItem }> {
  if (testCase.kind !== "generate") {
    const grade = gradeContradictionCase(testCase, testCase.raw);
    return {
      outcome: {
        name: testCase.id,
        passed: grade.passed,
        details: grade.details,
        flags: grade.flags,
      },
      exportItem: {
        workflow: "contradiction",
        id: testCase.id,
        description: testCase.description,
        input: testCase.kind,
        output: grade.details,
        sources: JSON.stringify(testCase.raw ?? {}, null, 2),
      },
    };
  }

  const prompts = contradictionCaseToPrompt(testCase);
  try {
    const result = await generate(ctx, [
      { role: "system", content: prompts.systemPrompt },
      { role: "user", content: prompts.userPrompt },
    ]);
    let raw: unknown;
    try {
      raw = JSON.parse(result.text);
    } catch (error) {
      return {
        outcome: {
          name: testCase.id,
          passed: false,
          details: `JSON parse failed: ${error instanceof Error ? error.message : String(error)}`,
        },
        exportItem: {
          workflow: "contradiction",
          id: testCase.id,
          description: testCase.description,
          input: prompts.userPrompt,
          output: result.text,
          sources: "(unparseable)",
        },
      };
    }
    const grade = gradeContradictionCase(testCase, raw);
    return {
      outcome: {
        name: testCase.id,
        passed: grade.passed,
        details: grade.details,
        flags: grade.flags,
      },
      exportItem: {
        workflow: "contradiction",
        id: testCase.id,
        description: testCase.description,
        input: prompts.userPrompt,
        output: JSON.stringify(raw, null, 2),
        sources: testCase.chunks.map((c) => `- ${c.chunkId}: ${c.content}`).join("\n"),
      },
    };
  } catch (error) {
    return {
      outcome: {
        name: testCase.id,
        passed: false,
        details: error instanceof Error ? error.message : String(error),
      },
      exportItem: {
        workflow: "contradiction",
        id: testCase.id,
        description: testCase.description,
        input: testCase.description,
        output: error instanceof Error ? error.message : String(error),
        sources: "(none)",
      },
    };
  }
}

function runValidatorSmoke(): EvalOutcome[] {
  const lease = {
    chunkId: "chunk_lease_1",
    documentId: "doc_lease",
    documentVersionId: "docv_lease_1",
    quote: "The lease term commences on January 1, 2024 and expires on December 31, 2026.",
  };

  const fabricated = validateCitedAnswerAgainstPassages(
    {
      answer: "Rent is due weekly.",
      sources: [
        {
          chunkId: lease.chunkId,
          documentId: lease.documentId,
          documentVersionId: lease.documentVersionId,
          quote: "Rent is due weekly under this lease agreement.",
        },
      ],
      assumptions: [],
      unresolvedQuestions: [],
      evidenceState: "grounded",
    },
    [lease],
  );

  const verbatim = validateCitedAnswerAgainstPassages(
    {
      answer: "The lease begins January 1, 2024.",
      sources: [
        {
          chunkId: lease.chunkId,
          documentId: lease.documentId,
          documentVersionId: lease.documentVersionId,
          quote: lease.quote,
        },
      ],
      assumptions: [],
      unresolvedQuestions: [],
      evidenceState: "grounded",
    },
    [lease],
  );

  return [
    {
      name: "validator-rejects-fabricated-quote",
      passed:
        fabricated.answer.evidenceState === "insufficient" && fabricated.rejectedCitations === 1,
      details: `state=${fabricated.answer.evidenceState}, rejected=${fabricated.rejectedCitations}`,
    },
    {
      name: "validator-accepts-verbatim-quote",
      passed: verbatim.answer.evidenceState === "grounded" && verbatim.rejectedCitations === 0,
      details: `state=${verbatim.answer.evidenceState}, rejected=${verbatim.rejectedCitations}`,
    },
  ];
}

function printRates(flags: CaseQualityFlags[], perRepeatFlags?: CaseQualityFlags[][]): boolean {
  const workflows: WorkflowId[] = ["case_qa", "contradiction", "contract_compare"];
  console.log("\n=== Workflow rates vs written bars (measured — not assumed) ===");
  console.log(
    "Written bars (docs/AGENT_QUALITY.md): ≥90% citation accuracy, <5% hallucination, <10% false-insufficient, 0% false-confidence.",
  );
  console.log(
    "Citation-relevance failure % is reported per workflow (cited decoy/forbidden chunks). Mock rates are code-regression measurements. They do not replace attorney review.\n",
  );
  let allMeet = true;
  let printed = 0;
  for (const workflow of workflows) {
    const report = aggregateWorkflowRates(workflow, flags);
    if (report.caseCount === 0) continue;
    printed += 1;
    console.log(formatWorkflowRateReport(report));
    console.log("");
    if (!report.meetsBar) allMeet = false;
  }
  if (perRepeatFlags && perRepeatFlags.length > 1) {
    console.log("=== Repeat variance (suite-level min/mean/max; bar judged on the mean) ===");
    for (const variance of summarizeRepeatVariance(perRepeatFlags)) {
      console.log(formatRepeatVarianceReport(variance));
      console.log("");
      if (!variance.meetsBarOnMean) allMeet = false;
    }
  }
  if (printed === 0) {
    console.log("(no workflow flags collected)");
  }
  return allMeet;
}

async function runStress(): Promise<void> {
  const provider = new GullibleMockProvider();
  const ctx: RunContext = {
    provider,
    live: false,
    timeoutMs: 0,
    budget: null,
  };

  const qaCases = adversarialQaCases();
  const cxCases = adversarialContradictionCases();
  const decoyCases = decoyContractCompareCases();

  console.log(
    `[eval:ai:stress] provider="${provider.name}" model="gullible-1"` +
      `\nAdversarial subset only: ${qaCases.length} Case Q&A + ${cxCases.length} contradiction + ${decoyCases.length} contract-compare decoy claim(s).` +
      `\nThis run is expected to FAIL individual cases. The harness PASSES if scoring catches the bait.\n`,
  );

  const outcomes: EvalOutcome[] = [];
  const flags: CaseQualityFlags[] = [];

  for (const testCase of qaCases) {
    const { outcome } = await runGradedCase(ctx, testCase);
    outcomes.push(outcome);
    if (outcome.flags) flags.push(outcome.flags);
  }
  for (const testCase of cxCases) {
    const { outcome } = await runContradictionCase(ctx, testCase);
    outcomes.push(outcome);
    if (outcome.flags) flags.push(outcome.flags);
  }
  for (const testCase of decoyCases) {
    const prompts = decoyClaimPrompt(
      testCase.decoyNeedles ?? [],
      testCase.original ?? "",
      testCase.redline ?? "",
    );
    const result = await generate(ctx, [
      { role: "system", content: prompts.systemPrompt },
      { role: "user", content: prompts.userPrompt },
    ]);
    const claimFlags = gradeGullibleDecoyClaim(testCase, result.text);
    outcomes.push({
      name: testCase.id,
      passed: claimFlags.passed,
      details: claimFlags.falseConfidence
        ? "gullible claim treated decoy as material high-attention"
        : "decoy claim not scored as material",
      flags: claimFlags,
    });
    flags.push(claimFlags);
  }

  for (const outcome of outcomes) {
    console.log(`${outcome.passed ? "PASS" : "FAIL"}  ${outcome.name} — ${outcome.details}`);
  }

  console.log("\n=== Stress rates (GullibleMock vs adversarial subset) ===");
  console.log(
    "A clean (0%) result here is a grader/fixture bug — not evidence the model is safe.\n",
  );
  const reports = (["case_qa", "contradiction", "contract_compare"] as WorkflowId[]).map(
    (workflow) => aggregateWorkflowRates(workflow, flags),
  );
  for (const report of reports) {
    if (report.caseCount === 0) continue;
    console.log(formatWorkflowRateReport(report));
    console.log("");
  }

  const harness = evaluateStressHarness(reports);
  console.log(
    `citation-relevance fail=${harness.citationRelevanceFailureRatePct == null ? "n/a" : `${harness.citationRelevanceFailureRatePct.toFixed(1)}%`}  ` +
      `decoy FPR=${harness.decoyFalsePositiveRatePct == null ? "n/a" : `${harness.decoyFalsePositiveRatePct.toFixed(1)}%`}  ` +
      `false-confidence=${harness.falseConfidenceRatePct.toFixed(1)}%`,
  );

  if (!harness.ok) {
    for (const miss of harness.misses) {
      console.error(`STRESS HARNESS FAIL: ${miss}`);
    }
    console.error(
      "Fix the grader or fixtures before eval:ai:live. A 0% stress result is the same class of bug as the invented-date canary.",
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `\nSTRESS HARNESS PASS: scoring caught GullibleMock (citation-relevance, decoy FPR, and false-confidence all non-zero).`,
  );
  console.log(
    `${outcomes.filter((o) => !o.passed).length}/${outcomes.length} adversarial case(s) failed, as expected for a bait-taking provider.`,
  );
}

async function main() {
  const live = process.argv.includes("--live");
  const stress = process.argv.includes("--stress");
  const exportReview = process.argv.includes("--export-review") || process.env.EVAL_EXPORT_REVIEW === "1";
  const liveConfig = resolveLiveEvalConfig();

  if (stress && live) {
    console.error("eval:ai:stress uses GullibleMockProvider only — do not pass --live.");
    process.exitCode = 1;
    return;
  }

  if (stress) {
    await runStress();
    return;
  }

  if (live) {
    const skip = liveEvalSkipReason(liveConfig);
    if (skip) {
      console.log(`[eval:ai:live] Skipped: ${skip}`);
      console.log(
        "Set EVAL_LIVE=1 and OPENAI_API_KEY to run. Optional: EVAL_LIVE_MODEL, EVAL_LIVE_TIMEOUT_MS, EVAL_LIVE_MAX_TOKENS, EVAL_LIVE_MAX_USD.",
      );
      return;
    }
  }

  const provider: AIProvider = live
    ? new OpenAIProvider({
        apiKey: liveConfig.apiKey!,
        model: liveConfig.model,
      })
    : new MockAIProvider();

  const budget = live ? new EvalBudgetTracker(liveConfig) : null;
  const scope = resolveLiveEvalScope();
  const ctx: RunContext = {
    provider,
    live,
    timeoutMs: liveConfig.timeoutMs,
    budget,
    requestedModel: live ? liveConfig.model : "mock-1",
  };

  const decoyCases = CONTRACT_COMPARE_CASES.filter((c) => c.kind === "diff_decoy").length;
  const materialCases = CONTRACT_COMPARE_CASES.filter((c) => c.kind === "diff_material").length;

  const repeats = live ? liveConfig.repeats : 1;
  const gradedCases = scope.runCaseQa
    ? GRADED_CASES.filter((c) => !scope.caseIds || scope.caseIds.includes(c.id))
    : [];
  const contradictionCases = scope.runContradiction
    ? CONTRADICTION_CASES.filter((c) => !scope.caseIds || scope.caseIds.includes(c.id))
    : [];

  if (scope.caseIds) {
    const known = new Set([
      ...GRADED_CASES.map((c) => c.id),
      ...CONTRADICTION_CASES.map((c) => c.id),
    ]);
    const missing = scope.caseIds.filter((id) => !known.has(id));
    if (missing.length > 0) {
      console.error(`Unknown EVAL_LIVE_CASE_IDS: ${missing.join(", ")}`);
      process.exitCode = 1;
      return;
    }
  }

  console.log(
    `[eval:ai${live ? ":live" : ""}] provider="${provider.name}" model="${live ? liveConfig.model : "mock-1"}"` +
      (live
        ? ` timeoutMs=${liveConfig.timeoutMs} maxTokens=${liveConfig.maxTokens} maxUsd=${liveConfig.maxUsd} repeats=${repeats} temperature=${LIVE_EVAL_TEMPERATURE}`
        : "") +
      `\nRunning grader canaries` +
      (scope.runSmoke ? ` + ${EVAL_CASES.length} smoke` : "") +
      ` + ${gradedCases.length} Case Q&A + ${contradictionCases.length} contradiction fixture(s)` +
      (repeats > 1 ? ` × ${repeats} repeats` : "") +
      `...\ncontract_compare suite composition: ${materialCases} planted-recall case(s), ${decoyCases} decoy-FPR case(s) (diffs graded by @nyayagrid/intelligence; live summaries run from that workspace).\n`,
  );
  if (scope.caseIds || scope.workflow !== "all") {
    console.log(
      `[eval:ai] Isolation filter: workflow=${scope.workflow} caseIds=${scope.caseIds?.join(",") ?? "(all)"} smoke=${scope.runSmoke}\n`,
    );
  }

  if (live) {
    console.log(
      `[eval:ai:live] Baseline: ${MOCK_GRADED_BASELINES.description} (v${MOCK_GRADED_BASELINES.version})\n`,
    );
  }

  const outcomes: EvalOutcome[] = [];
  const exportItems: ReviewExportItem[] = [];
  const flags: CaseQualityFlags[] = [];

  console.log("=== Grader canaries (negative controls — must fail) ===");
  const canaries = runCanarySuite();
  const brokenCanaries = canaries.filter((c) => !c.harnessOk);
  for (const canary of canaries) {
    outcomes.push({
      name: canary.id,
      passed: canary.harnessOk,
      details: canary.details,
    });
  }
  if (brokenCanaries.length > 0) {
    for (const canary of canaries) {
      console.log(`${canary.harnessOk ? "PASS" : "FAIL"}  ${canary.id} — ${canary.details}`);
    }
    for (const canary of brokenCanaries) {
      console.error(`\n${formatCanaryFailure(canary)}`);
    }
    console.error(
      `\n${brokenCanaries.length} grader canary(ies) did not fail as expected. Fix the grader before trusting this suite.`,
    );
    process.exitCode = 1;
    return;
  }
  console.log(`All ${canaries.length} canary(ies) failed as expected (grader can detect bad answers).\n`);

  if (scope.runCaseQa && shouldLogRecallDebug(process.env, live)) {
    console.log(`${formatRecallDebugSummary(diagnosePersistentCaseQaFails())}\n`);
  }

  const perRepeatFlags: CaseQualityFlags[][] = [];
  for (let repeat = 1; repeat <= repeats; repeat += 1) {
    const suffix = repeats > 1 ? `#${repeat}` : "";
    const flagsThis: CaseQualityFlags[] = [];
    if (repeats > 1) {
      console.log(`--- Repeat ${repeat}/${repeats} ---`);
    }
    if (scope.runSmoke) {
      for (const testCase of EVAL_CASES) {
        const outcome = await runCase(ctx, testCase);
        outcomes.push({ ...outcome, name: `${outcome.name}${suffix}` });
      }
    }
    for (const testCase of gradedCases) {
      const { outcome, exportItem } = await runGradedCase(ctx, testCase);
      outcomes.push({ ...outcome, name: `${outcome.name}${suffix}` });
      exportItems.push({
        ...exportItem,
        id: `${exportItem.id}${suffix}`,
      });
      if (outcome.flags) flagsThis.push(outcome.flags);
    }
    for (const testCase of contradictionCases) {
      const { outcome, exportItem } = await runContradictionCase(ctx, testCase);
      outcomes.push({ ...outcome, name: `${outcome.name}${suffix}` });
      exportItems.push({
        ...exportItem,
        id: `${exportItem.id}${suffix}`,
      });
      if (outcome.flags) flagsThis.push(outcome.flags);
    }
    perRepeatFlags.push(flagsThis);
    flags.push(...flagsThis);
  }
  outcomes.push(...runValidatorSmoke());

  for (const outcome of outcomes) {
    console.log(`${outcome.passed ? "PASS" : "FAIL"}  ${outcome.name} — ${outcome.details}`);
  }

  if (budget) {
    const snap = budget.snapshot();
    console.log(
      `\n[eval:ai:live] Budget used: requests=${snap.requests} tokens=${snap.totalTokens} (in=${snap.inputTokens} out=${snap.outputTokens}) ~$${snap.estimatedUsd.toFixed(4)} / $${liveConfig.maxUsd}`,
    );
  }

  const ratesMeetBar = printRates(flags, repeats > 1 ? perRepeatFlags : undefined);

  if (exportReview) {
    let dir =
      process.env.EVAL_EXPORT_DIR?.trim() ||
      join(
        REPO_ROOT,
        live
          ? "docs/agent-quality-review/exports-live"
          : "docs/agent-quality-review/exports-mock",
      );
    if (!live && /live/i.test(dir)) {
      console.error(
        `Refusing to write a mock export into ${dir} (path looks like a live review folder). Writing to exports-mock instead.`,
      );
      dir = join(REPO_ROOT, "docs/agent-quality-review/exports-mock");
    }
    const runConfig = live
      ? formatLiveRunConfig({
          promptVersionCaseQa: NYAYA_PROMPT_VERSION,
          promptVersionContradiction: CONTRADICTION_ANALYSIS_PROMPT_VERSION,
          requestedModel: liveConfig.model,
          resolvedModel: ctx.resolvedModel ?? "(no live generate this run)",
          systemFingerprint: ctx.systemFingerprint ?? "(none)",
          rerank: EVAL_CASE_QA_RERANK,
          temperature: LIVE_EVAL_TEMPERATURE,
        })
      : undefined;
    const index = writeReviewExport({
      dir,
      provider: provider.name,
      model: live ? (ctx.resolvedModel ?? liveConfig.model) : "mock-1",
      live,
      items: exportItems,
      runConfig,
    });
    console.log(`\nWrote review export: ${index}`);
    if (!live) {
      console.log("Mock export is not valid for Section B attorney review.");
    }
  }

  const failed = outcomes.filter((o) => !o.passed);
  if (failed.length > 0 || !ratesMeetBar) {
    if (failed.length > 0) {
      console.error(`\n${failed.length}/${outcomes.length} eval(s) failed.`);
    }
    if (!ratesMeetBar) {
      console.error("Workflow rate bar missed — see docs/AGENT_QUALITY.md numeric pass bars.");
    }
    process.exitCode = 1;
    return;
  }
  console.log(`\nAll ${outcomes.length} eval(s) passed.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
