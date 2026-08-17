/**
 * Dry-run mock for the conservatism prompt examples.
 *
 * Without the decoy worked example, refuses whenever more than one Source is
 * present (or on the persistent fail set). With the example in the system
 * prompt, answers from mustCite chunks — including QA-05 as insufficient+cites
 * so the validator can land on partial.
 *
 * Indemnity-with-amendment requires the grounded amendment example
 * (failure shape: original + amendment both present). QA-05 indemnity leaks
 * live-8 grounded/"fully settled" when that grounded example is present
 * without the hedge contrast. False-rent-amount requires the false-premise
 * example (flat insufficient, no bait echo).
 */
import type { AIProvider, AiGenerateRequest, AiGenerateResult } from "../index";
import {
  NYAYA_AMENDMENT_EXAMPLE_MARKER,
  NYAYA_AMENDMENT_HEDGE_EXAMPLE_MARKER,
  NYAYA_FALSE_PREMISE_EXAMPLE_MARKER,
  NYAYA_WORKED_EXAMPLE_MARKER,
} from "../index";
import { GRADED_CASES, gradedCaseToPrompt } from "./graded-cases";
import { gradeCitedAnswer } from "./grade";
import { PERSISTENT_CASE_QA_FAIL_IDS } from "./recall-debug";

export const FALSE_RENT_CASE_ID = "golden-false-rent-amount";
export const INDEMNITY_AMENDMENT_CASE_ID = "golden-indemnity-with-amendment";
export const QA05_INDEMNITY_CASE_ID = "golden-partial-hedge-indemnity";

export class ConservatismProbeProvider implements AIProvider {
  readonly name = "conservatism-probe";

  async generate(request: AiGenerateRequest): Promise<AiGenerateResult> {
    const system = request.messages.find((m) => m.role === "system")?.content ?? "";
    const user = request.messages.find((m) => m.role === "user")?.content ?? "";
    const followsExample = system.includes(NYAYA_WORKED_EXAMPLE_MARKER);
    const followsAmendment = system.includes(NYAYA_AMENDMENT_EXAMPLE_MARKER);
    const followsAmendmentHedge = system.includes(NYAYA_AMENDMENT_HEDGE_EXAMPLE_MARKER);
    const followsFalsePremise = system.includes(NYAYA_FALSE_PREMISE_EXAMPLE_MARKER);
    const testCase = matchGradedCaseFromUserPrompt(user);
    const refuse = () =>
      jsonResult({
        answer:
          "The available matter documents do not provide sufficient evidence to answer this question.",
        sources: [],
        assumptions: [],
        unresolvedQuestions: ["Insufficient evidence in retrieved matter sources."],
        evidenceState: "insufficient",
      });

    if (!testCase) return refuse();

    if (testCase.id === FALSE_RENT_CASE_ID) {
      if (!followsFalsePremise) {
        const term = testCase.retrieved.find((p) => p.chunkId === "chunk_lease_term") ?? testCase.retrieved[0];
        return jsonResult({
          answer: "No, the monthly base rent is not seven thousand dollars.",
          sources: term
            ? [
                {
                  chunkId: term.chunkId,
                  documentId: term.documentId,
                  documentVersionId: term.documentVersionId,
                  quote: term.quote,
                },
              ]
            : [],
          assumptions: [],
          unresolvedQuestions: ["The retrieved term clause does not state the rent amount."],
          evidenceState: "partial",
        });
      }
      return jsonResult({
        answer:
          "The available matter documents do not provide sufficient information to confirm the rent amount.",
        sources: [],
        assumptions: [],
        unresolvedQuestions: ["Insufficient evidence in retrieved matter sources."],
        evidenceState: "insufficient",
      });
    }

    if (!followsExample) {
      if (
        testCase.retrieved.length > 1 ||
        (PERSISTENT_CASE_QA_FAIL_IDS as readonly string[]).includes(testCase.id)
      ) {
        return refuse();
      }
    }

    if (testCase.id === INDEMNITY_AMENDMENT_CASE_ID && !followsAmendment) {
      return refuse();
    }

    const required = (testCase.rubric.mustCiteChunkIds ?? [])
      .map((id) => testCase.retrieved.find((p) => p.chunkId === id))
      .filter((p): p is NonNullable<typeof p> => Boolean(p));
    if (required.length === 0) return refuse();

    if (
      testCase.id === QA05_INDEMNITY_CASE_ID &&
      followsAmendment &&
      !followsAmendmentHedge
    ) {
      return jsonResult({
        answer: "The indemnity obligation is fully settled in these excerpts.",
        sources: required.map((p) => ({
          chunkId: p.chunkId,
          documentId: p.documentId,
          documentVersionId: p.documentVersionId,
          quote: p.quote,
        })),
        assumptions: [],
        unresolvedQuestions: [],
        evidenceState: "grounded",
      });
    }

    const hedge = testCase.rubric.expectEvidenceState === "partial";
    const answerBits = testCase.rubric.mustIncludePhrases ?? [];
    return jsonResult({
      answer: hedge
        ? `Based on the excerpt: ${answerBits.join("; ")}. This is only a partial picture and is not fully settled.`
        : `Based on the matter documents: ${answerBits.join("; ")}.`,
      sources: required.map((p) => ({
        chunkId: p.chunkId,
        documentId: p.documentId,
        documentVersionId: p.documentVersionId,
        quote: p.quote,
      })),
      assumptions: [],
      unresolvedQuestions: hedge ? ["What remains uncertain given incomplete coverage?"] : [],
      evidenceState: hedge ? "insufficient" : "grounded",
    });
  }
}

function matchGradedCaseFromUserPrompt(user: string) {
  const chunkIds = [...user.matchAll(/chunkId=([^\s|]+)/g)].map((m) => m[1]!);
  const matches = GRADED_CASES.filter((c) => user.includes(`Question: ${c.question}`));
  if (matches.length === 1) return matches[0];
  return matches.find(
    (c) =>
      c.retrieved.length === chunkIds.length &&
      c.retrieved.every((p) => chunkIds.includes(p.chunkId)),
  );
}

function jsonResult(payload: unknown): AiGenerateResult {
  return {
    provider: "conservatism-probe",
    model: "probe-1",
    text: JSON.stringify(payload),
    usage: { inputTokens: 0, outputTokens: 0 },
  };
}

export async function gradeCaseWithProbe(
  caseId: string,
  systemPrompt?: string,
): Promise<{ caseId: string; passed: boolean; evidenceState?: string; answer?: string }> {
  const provider = new ConservatismProbeProvider();
  const testCase = GRADED_CASES.find((c) => c.id === caseId);
  if (!testCase) {
    return { caseId, passed: false };
  }
  const prompts = gradedCaseToPrompt(testCase);
  const result = await provider.generate({
    messages: [
      { role: "system", content: systemPrompt ?? prompts.systemPrompt },
      { role: "user", content: prompts.userPrompt },
    ],
  });
  const parsed = JSON.parse(result.text) as { answer?: string };
  const grade = gradeCitedAnswer({
    caseId: testCase.id,
    raw: parsed as unknown,
    retrieved: testCase.retrieved,
    rubric: testCase.rubric,
    question: testCase.question,
    workflow: "case_qa",
    shouldRefuse: testCase.shouldRefuse,
    trapKind: testCase.trapKind,
  });
  return {
    caseId: testCase.id,
    passed: grade.passed,
    evidenceState: grade.answer?.evidenceState,
    answer: parsed.answer,
  };
}

export async function gradePersistentFailsWithProbe(
  systemPrompt?: string,
): Promise<{ caseId: string; passed: boolean; evidenceState?: string }[]> {
  const out: { caseId: string; passed: boolean; evidenceState?: string }[] = [];
  for (const id of PERSISTENT_CASE_QA_FAIL_IDS) {
    out.push(await gradeCaseWithProbe(id, systemPrompt));
  }
  return out;
}
