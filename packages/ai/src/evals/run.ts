/**
 * AI eval runner.
 *
 *   npm run eval:ai       — runs EVAL_CASES against MockAIProvider. Deterministic, no network
 *                           calls, safe to run in CI on every commit.
 *   npm run eval:ai:live  — runs the same fixtures against the real OpenAI API. Skipped unless
 *                           both EVAL_LIVE=1 and OPENAI_API_KEY are set, so it never runs by
 *                           accident (in CI or locally) and never spends money silently.
 *
 * This is a smoke-level harness, not a statistical eval suite: each fixture is checked once and
 * pass/fail is exact-match on evidenceState plus a citation-grounding check on returned quotes.
 * It exists to catch prompt regressions (e.g. a prompt change that starts hallucinating sources
 * or stops declining unanswerable questions), not to measure answer quality.
 */
import { MockAIProvider, OpenAIProvider, citedAnswerSchema, type AIProvider } from "../index";
import { EVAL_CASES, type EvalCase } from "./fixtures";

type EvalOutcome = {
  name: string;
  passed: boolean;
  details: string;
};

async function runCase(provider: AIProvider, testCase: EvalCase): Promise<EvalOutcome> {
  const result = await provider.generate({
    messages: [
      { role: "system", content: testCase.systemPrompt },
      { role: "user", content: testCase.userPrompt },
    ],
  });

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
    const allowedQuotes = (testCase.passages ?? []).map((p) => p.quote);
    for (const source of parsed.sources) {
      const isGrounded = allowedQuotes.some(
        (quote) => quote.includes(source.quote) || source.quote.includes(quote.slice(0, 40)),
      );
      if (!isGrounded) {
        return {
          name: testCase.name,
          passed: false,
          details: `Cited quote is not grounded in any provided passage: "${source.quote}"`,
        };
      }
    }
  }

  return {
    name: testCase.name,
    passed: true,
    details: `evidenceState=${parsed.evidenceState}, sources=${parsed.sources.length}`,
  };
}

async function main() {
  const live = process.argv.includes("--live");

  if (live && (process.env.EVAL_LIVE !== "1" || !process.env.OPENAI_API_KEY)) {
    console.log(
      "[eval:ai:live] Skipped: set EVAL_LIVE=1 and OPENAI_API_KEY to run these fixtures against the real OpenAI API.",
    );
    return;
  }

  const provider: AIProvider = live
    ? new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY! })
    : new MockAIProvider();

  console.log(
    `[eval:ai] Running ${EVAL_CASES.length} fixture(s) against provider="${provider.name}"...\n`,
  );

  const outcomes: EvalOutcome[] = [];
  for (const testCase of EVAL_CASES) {
    outcomes.push(await runCase(provider, testCase));
  }

  for (const outcome of outcomes) {
    console.log(`${outcome.passed ? "PASS" : "FAIL"}  ${outcome.name} — ${outcome.details}`);
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
