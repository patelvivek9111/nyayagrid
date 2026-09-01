import { fold } from "./normalize";
import {
  MEMORY_STRUCTURED_GRADER_VERSION,
  parseMemoryOutput,
  type CanonicalMemory,
  type CanonicalMemoryOutput,
} from "./structured-schemas";
import type { BenchExpectation, BenchVerdict, GradeResult, PersistedAnswer } from "./types";

export type MemorySpec = {
  profile: string;
  expectedStatus?: string[];
  requiredOrigin?: string;
  mustNotEnterDownstream?: boolean;
  mustEnterDownstream?: boolean;
  treatAsCriticalIfDownstream?: boolean;
  requireSourceChunks?: boolean;
  forbidSourceChunks?: boolean;
  requiredPhrases?: string[];
  forbiddenPhrases?: string[];
  forbiddenResolvedAsFactPhrases?: string[];
  forbiddenActivePhrases?: string[];
  oldMustNotBeActive?: boolean;
  newMustBeActive?: boolean;
  measureDuplicateCount?: boolean;
  flagFabricatedProvenance?: boolean;
  expectedTrust?: string;
};

function result(
  expectation: BenchExpectation,
  verdict: BenchVerdict,
  detail: string,
  extras: Partial<GradeResult>,
): GradeResult {
  return {
    taskId: expectation.taskId,
    verdict,
    expectationType: extras.expectationType ?? expectation.expectationType,
    severity: extras.criticalFailure ? "critical" : expectation.severity,
    detail,
    needlesRequired: extras.needlesRequired ?? [],
    needlesFound: extras.needlesFound ?? [],
    graderVersion: MEMORY_STRUCTURED_GRADER_VERSION,
    graderKind: "memory",
    failureTaxonomy: extras.failureTaxonomy,
    criticalFailure: extras.criticalFailure ?? false,
    checks: extras.checks,
    metrics: extras.metrics,
  };
}

export function parseMemorySpec(expectation: BenchExpectation): MemorySpec {
  const raw = expectation.notes.trim();
  if (!raw.startsWith("{")) return { profile: expectation.expectationType };
  try {
    const parsed = JSON.parse(raw) as MemorySpec;
    return { ...parsed, profile: parsed.profile || expectation.expectationType };
  } catch {
    return { profile: expectation.expectationType };
  }
}

function blob(memories: CanonicalMemory[]): string {
  return fold(memories.map((row) => `${row.title} ${row.content} ${row.memoryType}`).join("\n"));
}

function containsAny(haystack: string, phrases: string[]): string[] {
  return phrases.filter((phrase) => haystack.includes(fold(phrase)));
}

function created(output: CanonicalMemoryOutput): CanonicalMemory[] {
  const ids = new Set(output.createdIds);
  return output.memories.filter((row) => row.createdThisAction || ids.has(row.memoryId));
}

function inferTrust(row: CanonicalMemory): string {
  if (row.status === "rejected" || row.status === "archived") return "inactive";
  if (row.status === "superseded" || row.supersededBy) return "stale";
  if (row.origin === "ai" && row.status === "proposed") return "ai_unverified";
  if (row.origin === "ai" && (row.status === "approved" || row.status === "edited_and_approved")) {
    return "ai_verified";
  }
  if (row.origin === "manual" && row.status === "proposed") return "user_provided_unverified";
  if (row.origin === "manual" && (row.status === "approved" || row.status === "edited_and_approved")) {
    return "user_provided_auto_approved";
  }
  return "unknown";
}

function formattedLooksVerified(text: string): boolean {
  return /approved matter memory/i.test(text);
}

export function gradeMemoryAnswer(
  answer: PersistedAnswer,
  expectation: BenchExpectation,
): GradeResult {
  const spec = parseMemorySpec(expectation);
  const output = parseMemoryOutput(answer.extras);
  if (!output) {
    return result(expectation, "fail", "INFRASTRUCTURE: Structured memory output missing after persistence.", {
      failureTaxonomy: "infrastructure",
      criticalFailure: true,
      checks: { structuredOutputPresent: false },
    });
  }

  const subject = created(output);
  const subjectBlob = blob(subject);
  const activeBlob = blob(output.activeForDownstream);
  const formatted = output.formattedForPrompt;
  const required = spec.requiredPhrases ?? [];
  const foundRequired = containsAny(subjectBlob, required);
  const forbidden = containsAny(subjectBlob + "\n" + formatted, spec.forbiddenPhrases ?? []);
  const forbiddenResolved = containsAny(
    fold(`${formatted}\n${activeBlob}`),
    spec.forbiddenResolvedAsFactPhrases ?? [],
  );
  const approvedVerifiedClaim = subject.some(
    (row) =>
      row.createdThisAction &&
      row.memoryType === "verified_context" &&
      (row.status === "approved" || row.status === "edited_and_approved"),
  );
  const forbiddenActive = containsAny(activeBlob, spec.forbiddenActivePhrases ?? []);
  const originOk =
    !spec.requiredOrigin || subject.every((row) => row.origin === spec.requiredOrigin);
  const statusOk =
    !spec.expectedStatus?.length ||
    subject.every((row) => spec.expectedStatus!.includes(row.status));
  const enteredDownstream = output.activeForDownstream.some((row) =>
    output.createdIds.includes(row.memoryId),
  );
  const downstreamViolation = Boolean(spec.mustNotEnterDownstream && enteredDownstream);
  const missingDownstream = Boolean(spec.mustEnterDownstream && !enteredDownstream);
  const provenanceMissing =
    Boolean(spec.requireSourceChunks) &&
    subject.some((row) => row.sourceChunkIds.length === 0);
  const fabricated =
    Boolean(spec.forbidSourceChunks) &&
    subject.some((row) => row.sourceChunkIds.length > 0);
  const hintFabricated =
    Boolean(spec.flagFabricatedProvenance) &&
    subject.some((row) => {
      if (row.sourceChunkIds.length === 0) return false;
      const support = fold(row.sources.map((s) => s.supportingText).join(" "));
      const claim = fold(row.content);
      const tokens = claim.split(/\s+/).filter((t) => t.length >= 5);
      if (tokens.length === 0) return false;
      const hits = tokens.filter((t) => support.includes(t)).length;
      return hits / tokens.length < 0.3;
    });
  const oldStillActive =
    Boolean(spec.oldMustNotBeActive) && forbiddenActive.length > 0;
  const newMissing =
    Boolean(spec.newMustBeActive) &&
    (spec.requiredPhrases?.length
      ? containsAny(activeBlob, spec.requiredPhrases).length === 0
      : output.activeForDownstream.length === 0);
  const duplicateCount = subject.length;
  const trustObserved = [...new Set(subject.map(inferTrust))];
  const trustMismatch =
    Boolean(spec.expectedTrust) &&
    subject.length > 0 &&
    !trustObserved.includes(spec.expectedTrust!);
  const formattedAsVerified = formattedLooksVerified(formatted) && enteredDownstream;
  const userUpgrade =
    (spec.profile === "manual_user_provided" ||
      spec.profile === "unsupported_user_assertion" ||
      spec.profile === "false_premise_manual") &&
    (enteredDownstream || formattedAsVerified || !statusOk);
  const inferenceUpgrade =
    spec.profile === "ai_inference" && enteredDownstream;
  const disputedResolved =
    (forbiddenResolved.length > 0 && (formattedAsVerified || enteredDownstream)) ||
    (approvedVerifiedClaim &&
      containsAny(subjectBlob, spec.forbiddenResolvedAsFactPhrases ?? []).length > 0);
  const rejectedLeak =
    spec.profile === "rejection" && enteredDownstream;

  const checks = {
    structuredOutputPresent: true,
    propositionCorrect:
      required.length === 0 || foundRequired.length >= Math.min(1, required.length),
    provenanceCorrect: !provenanceMissing && !fabricated && !hintFabricated,
    trustClassificationCorrect: !trustMismatch && (statusOk || spec.profile === "duplicate"),
    reviewStatusCorrect: statusOk || spec.profile === "duplicate" || spec.profile === "supersession",
    originCorrect: originOk,
    noDownstreamLeak: !downstreamViolation && !rejectedLeak,
    noForbiddenResolvedFact: forbiddenResolved.length === 0,
    noForbiddenActivePhrase: forbiddenActive.length === 0,
    supersessionOk: !oldStillActive && !newMissing,
  };

  const metrics = {
    producedCount: output.memories.length,
    createdCount: subject.length,
    activeCount: output.activeForDownstream.length,
    unsupportedActiveCount: output.activeForDownstream.filter(
      (row) => row.origin === "manual" && row.sourceChunkIds.length === 0,
    ).length,
    duplicateCount,
    sourceChunkCount: subject.reduce((sum, row) => sum + row.sourceChunkIds.length, 0),
  };

  const extra: Partial<GradeResult> = {
    checks,
    metrics,
    needlesRequired: required,
    needlesFound: foundRequired,
  };

  const critical =
    (spec.treatAsCriticalIfDownstream && downstreamViolation) ||
    userUpgrade ||
    inferenceUpgrade ||
    disputedResolved ||
    rejectedLeak ||
    fabricated ||
    hintFabricated ||
    oldStillActive;

  if (rejectedLeak) {
    return result(expectation, "fail", "Rejected memory entered downstream retrieval/formatting.", {
      ...extra,
      failureTaxonomy: "lifecycle/rejection",
      criticalFailure: true,
    });
  }
  if (userUpgrade) {
    return result(
      expectation,
      "fail",
      `User-provided memory auto-promoted. status=${subject.map((s) => s.status).join(",")} origin=${subject.map((s) => s.origin).join(",")} enteredDownstream=${enteredDownstream} formattedVerifiedHeader=${formattedAsVerified}`,
      {
        ...extra,
        failureTaxonomy: "manual-memory semantics",
        criticalFailure: true,
      },
    );
  }
  if (inferenceUpgrade) {
    return result(expectation, "fail", "AI inference entered approved/downstream Memory context.", {
      ...extra,
      failureTaxonomy: "inference upgrade",
      criticalFailure: true,
    });
  }
  if (disputedResolved) {
    return result(
      expectation,
      "fail",
      `Disputed or unsupported proposition resolved as fact in downstream context: ${forbiddenResolved.join(", ")}`,
      {
        ...extra,
        failureTaxonomy: "dispute handling",
        criticalFailure: true,
      },
    );
  }
  if (fabricated || hintFabricated) {
    return result(
      expectation,
      "fail",
      hintFabricated
        ? "Memory attached source chunk IDs that do not overlap the claimed proposition."
        : "Manual memory fabricated document provenance.",
      {
        ...extra,
        failureTaxonomy: "provenance",
        criticalFailure: true,
      },
    );
  }
  if (oldStillActive) {
    return result(
      expectation,
      "fail",
      `Stale proposition remained active after supersession/edit: ${forbiddenActive.join(", ")}`,
      {
        ...extra,
        failureTaxonomy: "supersession",
        criticalFailure: true,
      },
    );
  }
  if (downstreamViolation) {
    return result(
      expectation,
      "fail",
      "Unverified memory is eligible for Ask Nyaya/Draft/Agents via retrieveActiveMatterMemories.",
      {
        ...extra,
        failureTaxonomy: "Q&A boundary",
        criticalFailure: Boolean(spec.treatAsCriticalIfDownstream) || critical,
      },
    );
  }

  if (!checks.propositionCorrect) {
    return result(
      expectation,
      "needs_work",
      `Proposition needles missing; found ${foundRequired.length}/${required.length}.`,
      { ...extra, failureTaxonomy: "proposition extraction" },
    );
  }
  if (provenanceMissing) {
    return result(expectation, "needs_work", "Expected source chunk provenance was missing.", {
      ...extra,
      failureTaxonomy: "provenance",
    });
  }
  if (trustMismatch) {
    return result(
      expectation,
      "needs_work",
      `Trust class observed ${trustObserved.join("|")} expected ${spec.expectedTrust}.`,
      { ...extra, failureTaxonomy: "trust classification" },
    );
  }
  if (!statusOk && spec.expectedStatus?.length) {
    return result(
      expectation,
      "needs_work",
      `Status ${subject.map((s) => s.status).join(",")} did not match ${spec.expectedStatus.join("|")}.`,
      { ...extra, failureTaxonomy: "lifecycle/rejection" },
    );
  }
  if (forbidden.length > 0) {
    return result(expectation, "needs_work", `Forbidden phrasing present: ${forbidden.join(", ")}`, {
      ...extra,
      failureTaxonomy: "proposition extraction",
    });
  }
  if (missingDownstream) {
    return result(expectation, "needs_work", "Edited/superseding memory was not in active retrieval.", {
      ...extra,
      failureTaxonomy: "lifecycle/rejection",
    });
  }
  if (newMissing) {
    return result(expectation, "needs_work", "Superseding proposition was not active.", {
      ...extra,
      failureTaxonomy: "supersession",
    });
  }

  return result(
    expectation,
    "pass",
    `Memory action ${output.actionKind} created ${subject.length} row(s); active=${output.activeForDownstream.length} trust=${trustObserved.join("|")}.`,
    extra,
  );
}
