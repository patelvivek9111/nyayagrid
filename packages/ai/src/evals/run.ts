/**
 * AI eval runner.
 *
 *   npm run eval:ai       — MockAIProvider + golden graded suite + validator smoke (CI-safe, every PR)
 *   npm run eval:ai:live  — OpenAI with pinned model + budgets when EVAL_LIVE=1 (manual/nightly only)
 *
 * Quality bar: docs/AGENT_QUALITY.md · Live docs: docs/AI_EVAL_LIVE.md
 */
import {
  MockAIProvider,
  OpenAIProvider,
  citedAnswerSchema,
  validateCitedAnswerAgainstPassages,
  validateQuoteAgainstText,
  type AIProvider,
} from "../index";
import { EVAL_CASES, type EvalCase } from "./fixtures";
import { GRADED_CASES, gradedCaseToPrompt } from "./graded-cases";
import { gradeCitedAnswer } from "./grade";
import {
  MOCK_GRADED_BASELINES,
  findBaselineRegressions,
} from "./baselines";
import {
  EvalBudgetTracker,
  generateWithEvalTimeout,
  liveEvalSkipReason,
  resolveLiveEvalConfig,
} from "./live-config";

type EvalOutcome = {
  name: string;
  passed: boolean;
  details: string;
};

type RunContext = {
  provider: AIProvider;
  live: boolean;
  timeoutMs: number;
  budget: EvalBudgetTracker | null;
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
  const request = { messages, temperature: 0 as const };
  const result = ctx.live
    ? await generateWithEvalTimeout(ctx.provider, request, ctx.timeoutMs)
    : await ctx.provider.generate(request);
  ctx.budget?.recordUsage(result.usage);
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
): Promise<EvalOutcome> {
  try {
    const prompts = gradedCaseToPrompt(testCase);
    const result = await generate(ctx, [
      { role: "system", content: prompts.systemPrompt },
      { role: "user", content: prompts.userPrompt },
    ]);
    let raw: unknown;
    try {
      raw = JSON.parse(result.text);
    } catch (error) {
      return {
        name: testCase.id,
        passed: false,
        details: `JSON parse failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    const grade = gradeCitedAnswer({
      caseId: testCase.id,
      raw,
      retrieved: testCase.retrieved,
      rubric: testCase.rubric,
      question: testCase.question,
    });

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
      name: testCase.id,
      passed,
      details:
        grade.dimensions.map((d) => `${d.name}:${d.passed ? "ok" : d.detail}`).join(" | ") +
        regressionDetail,
    };
  } catch (error) {
    return {
      name: testCase.id,
      passed: false,
      details: error instanceof Error ? error.message : String(error),
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

async function main() {
  const live = process.argv.includes("--live");
  const liveConfig = resolveLiveEvalConfig();

  if (live) {
    const skip = liveEvalSkipReason(liveConfig);
    if (skip) {
      console.log(`[eval:ai:live] Skipped: ${skip}`);
      console.log(
        "Set EVAL_LIVE=1 and OPENAI_API_KEY to run. Optional: EVAL_LIVE_MODEL, EVAL_LIVE_TIMEOUT_MS, EVAL_LIVE_MAX_TOKENS, EVAL_LIVE_MAX_USD.",
      );
      // Exit 0 so optional CI jobs can soft-skip when secrets are absent.
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
  const ctx: RunContext = {
    provider,
    live,
    timeoutMs: liveConfig.timeoutMs,
    budget,
  };

  console.log(
    `[eval:ai${live ? ":live" : ""}] provider="${provider.name}" model="${live ? liveConfig.model : "mock-1"}"` +
      (live
        ? ` timeoutMs=${liveConfig.timeoutMs} maxTokens=${liveConfig.maxTokens} maxUsd=${liveConfig.maxUsd}`
        : "") +
      `\nRunning ${EVAL_CASES.length} smoke + ${GRADED_CASES.length} golden graded fixture(s)...\n`,
  );

  if (live) {
    console.log(
      `[eval:ai:live] Baseline: ${MOCK_GRADED_BASELINES.description} (v${MOCK_GRADED_BASELINES.version})\n`,
    );
  }

  const outcomes: EvalOutcome[] = [];
  for (const testCase of EVAL_CASES) {
    outcomes.push(await runCase(ctx, testCase));
  }
  for (const testCase of GRADED_CASES) {
    outcomes.push(await runGradedCase(ctx, testCase));
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

  const failed = outcomes.filter((o) => !o.passed);
  if (failed.length > 0) {
    console.error(`\n${failed.length}/${outcomes.length} eval(s) failed.`);
    process.exitCode = 1;
    return;
  }
  console.log(`\nAll ${outcomes.length} eval(s) passed.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
