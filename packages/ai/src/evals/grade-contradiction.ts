/**
 * Grade contradiction candidates against CX-01..CX-02 fixtures.
 */
import { contradictionCandidatesSchema } from "../professional";
import { filterImpreciseDateContradictionCandidates } from "../imprecise-date";
import type { ContradictionCase } from "./graded-cases-contradiction";
import type { CaseQualityFlags } from "./metrics";

export type ContradictionGrade = {
  caseId: string;
  passed: boolean;
  details: string;
  flags: CaseQualityFlags;
};

function collectChunkIds(raw: unknown): string[] {
  if (!raw || typeof raw !== "object") return [];
  const candidates = (raw as { candidates?: Array<{
    sideA?: { chunkIds?: string[] };
    sideB?: { chunkIds?: string[] };
  }> }).candidates;
  if (!Array.isArray(candidates)) return [];
  const ids: string[] = [];
  for (const c of candidates) {
    ids.push(...(c.sideA?.chunkIds ?? []), ...(c.sideB?.chunkIds ?? []));
  }
  return ids;
}

export function gradeContradictionCase(
  testCase: ContradictionCase,
  raw: unknown,
): ContradictionGrade {
  const allowed = new Set(testCase.chunks.map((c) => c.chunkId));
  const cited = collectChunkIds(raw);
  const validCites = cited.filter((id) => allowed.has(id) || testCase.kind.startsWith("schema"));
  const fabricatedCites = cited.filter((id) => testCase.chunks.length > 0 && !allowed.has(id)).length;

  const flagsBase = {
    workflow: "contradiction" as const,
    caseId: testCase.id,
    attemptedCites: cited.length,
    validCites: validCites.length,
    fabricatedCites,
  };

  if (testCase.kind === "schema_reject") {
    let rejected = false;
    try {
      contradictionCandidatesSchema.parse(testCase.raw);
    } catch {
      rejected = true;
    }
    return {
      caseId: testCase.id,
      passed: rejected,
      details: rejected ? "schema rejected one-sided/invalid candidate" : "schema unexpectedly accepted",
      flags: {
        ...flagsBase,
        passed: rejected,
        falseInsufficient: false,
        falseConfidence: !rejected,
      },
    };
  }

  if (testCase.kind === "schema_accept") {
    try {
      const parsed = contradictionCandidatesSchema.parse(testCase.raw);
      const ok = parsed.candidates.length === 1;
      return {
        caseId: testCase.id,
        passed: ok,
        details: ok ? "dual-sided schema accepted" : `expected 1 candidate, got ${parsed.candidates.length}`,
        flags: {
          ...flagsBase,
          passed: ok,
          attemptedCites: collectChunkIds(parsed).length,
          validCites: collectChunkIds(parsed).length,
          fabricatedCites: 0,
          falseInsufficient: !ok,
          falseConfidence: false,
        },
      };
    } catch (error) {
      return {
        caseId: testCase.id,
        passed: false,
        details: `schema reject: ${error instanceof Error ? error.message : String(error)}`,
        flags: {
          ...flagsBase,
          passed: false,
          falseInsufficient: true,
          falseConfidence: false,
        },
      };
    }
  }

  let parsed;
  try {
    parsed = contradictionCandidatesSchema.parse(raw);
    const chunkTextById = new Map(testCase.chunks.map((chunk) => [chunk.chunkId, chunk.content]));
    parsed = {
      ...parsed,
      candidates: filterImpreciseDateContradictionCandidates(parsed.candidates, chunkTextById),
    };
  } catch (error) {
    return {
      caseId: testCase.id,
      passed: false,
      details: `parse failed: ${error instanceof Error ? error.message : String(error)}`,
      flags: {
        ...flagsBase,
        passed: false,
        falseInsufficient: !testCase.expectNoCandidates,
        falseConfidence: Boolean(testCase.expectNoCandidates),
      },
    };
  }

  const count = parsed.candidates.length;
  const issues: string[] = [];

  if (typeof testCase.expectCandidateCount === "number" && count !== testCase.expectCandidateCount) {
    issues.push(`expected ${testCase.expectCandidateCount} candidate(s), got ${count}`);
  }
  if (testCase.expectNoCandidates && count > 0) {
    issues.push(`expected no candidates, got ${count}`);
  }
  if (testCase.mustIncludeSideChunkIds) {
    const got = new Set(collectChunkIds(parsed));
    for (const id of testCase.mustIncludeSideChunkIds) {
      if (!got.has(id)) issues.push(`missing side chunk ${id}`);
    }
  }

  for (const candidate of parsed.candidates) {
    if (candidate.sideA.chunkIds.length < 1 || candidate.sideB.chunkIds.length < 1) {
      issues.push("one-sided candidate emitted");
    }
    for (const id of [...candidate.sideA.chunkIds, ...candidate.sideB.chunkIds]) {
      if (testCase.chunks.length > 0 && !allowed.has(id)) {
        issues.push(`fabricated chunk id ${id}`);
      }
    }
  }

  const citedIds = collectChunkIds(parsed);
  const forbiddenHits = (testCase.forbiddenChunkIds ?? []).filter((id) => citedIds.includes(id));
  if (forbiddenHits.length > 0) {
    issues.push(`cited decoy chunk(s) that do not support a contradiction: ${forbiddenHits.join(", ")}`);
  }

  const passed = issues.length === 0;
  const falseConfidence =
    Boolean(testCase.expectNoCandidates || testCase.trapKind === "false_positive" || testCase.trapKind === "one_sided") &&
    count > 0;
  const falseInsufficient = Boolean(testCase.expectCandidateCount && testCase.expectCandidateCount > 0 && count === 0);

  return {
    caseId: testCase.id,
    passed,
    details: passed ? `candidates=${count}` : issues.join("; "),
    flags: {
      ...flagsBase,
      passed,
      attemptedCites: collectChunkIds(parsed).length,
      validCites: collectChunkIds(parsed).filter((id) => allowed.has(id)).length,
      fabricatedCites: collectChunkIds(parsed).filter((id) => !allowed.has(id)).length,
      falseInsufficient,
      falseConfidence,
      citationRelevanceChecked: (testCase.forbiddenChunkIds?.length ?? 0) > 0,
      citationRelevanceFailures: forbiddenHits.length,
    },
  };
}
