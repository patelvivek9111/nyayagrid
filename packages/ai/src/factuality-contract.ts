/**
 * Phase 2 — Shared conversational factuality contract.
 * Nyaya evaluates the record; it does not advocate for the user's assumption.
 * No schema migration — persisted under ai_artifacts.validation.
 */

import { z } from "zod";

export const FACTUALITY_CONTRACT_VERSION = 1 as const;

export const factualityTypeSchema = z.enum([
  "FACT",
  "SUPPORTED_INFERENCE",
  "CONFLICT",
  "UNKNOWN",
  "UNSUPPORTED",
]);
export type FactualityType = z.infer<typeof factualityTypeSchema>;

export const conflictKindSchema = z.enum([
  "DIRECT_CONFLICT",
  "POTENTIAL_TENSION",
  "DIFFERENT_SCOPE",
  "UNKNOWN",
]);
export type ConflictKind = z.infer<typeof conflictKindSchema>;

export const premiseCheckResultSchema = z.enum([
  "CONFIRMED",
  "PARTIALLY_SUPPORTED",
  "CONFLICTED",
  "UNKNOWN",
  "UNSUPPORTED",
]);
export type PremiseCheckResult = z.infer<typeof premiseCheckResultSchema>;

export const authorityResolutionSchema = z.enum([
  "IDENTITY_UNRESOLVED",
  "AUTHORITY_RESOLVED",
  "CORPUS_COMPLETE",
]);
export type AuthorityResolution = z.infer<typeof authorityResolutionSchema>;

export const factualityAssertionSchema = z.object({
  type: factualityTypeSchema,
  text: z.string().min(1).max(2000),
  sourceIds: z.array(z.string().min(1)).default([]),
  sourceType: z.string().max(80).nullable().optional(),
  matterId: z.string().min(1).nullable().optional(),
  organizationId: z.string().min(1).nullable().optional(),
  relatedEntityIds: z.array(z.string().min(1)).default([]),
  authorityState: authorityResolutionSchema.nullable().optional(),
  treatmentVerified: z.boolean().nullable().optional(),
  conflictKind: conflictKindSchema.nullable().optional(),
  reason: z.string().max(800).nullable().optional(),
});
export type FactualityAssertion = z.infer<typeof factualityAssertionSchema>;

export const premiseCheckSchema = z.object({
  detected: z.boolean(),
  userAssertion: z.string().max(800).nullable(),
  result: premiseCheckResultSchema,
  mappedFactuality: factualityTypeSchema.nullable(),
  reason: z.string().max(800),
});
export type PremiseCheck = z.infer<typeof premiseCheckSchema>;

export const factualitySummarySchema = z.object({
  factCount: z.number().int().nonnegative(),
  inferenceCount: z.number().int().nonnegative(),
  conflictCount: z.number().int().nonnegative(),
  unknownCount: z.number().int().nonnegative(),
  unsupportedCount: z.number().int().nonnegative(),
});
export type FactualitySummary = z.infer<typeof factualitySummarySchema>;

export const factualityContractSchema = z.object({
  version: z.literal(FACTUALITY_CONTRACT_VERSION),
  assertions: z.array(factualityAssertionSchema).default([]),
  premiseCheck: premiseCheckSchema.nullable().default(null),
  sourceRefs: z.array(z.string().min(1)).default([]),
  authorityRefs: z.array(z.string().min(1)).default([]),
  activeEntityRefs: z.array(z.string().min(1)).default([]),
  selectedDomains: z.array(z.string().min(1)).default([]),
  summary: factualitySummarySchema,
  contextDiagnostics: z
    .object({
      selectedDomains: z.array(z.string()).default([]),
      skippedDomains: z.array(z.string()).default([]),
      reasonCodes: z.array(z.string()).default([]),
      wholeMatterUsed: z.boolean().default(false),
      duplicateLoaderSuppressed: z.array(z.string()).default([]),
      contextChars: z.number().int().nonnegative().default(0),
      sourceCount: z.number().int().nonnegative().default(0),
      authorityCount: z.number().int().nonnegative().default(0),
      routerLatencyMs: z.number().nonnegative().optional(),
    })
    .optional(),
});
export type FactualityContract = z.infer<typeof factualityContractSchema>;

export const FACTUALITY_UI_LABELS: Record<FactualityType, string> = {
  FACT: "Record fact",
  SUPPORTED_INFERENCE: "Supported inference",
  CONFLICT: "Conflict",
  UNKNOWN: "Not established",
  UNSUPPORTED: "Unsupported by current record",
};

function uniq(ids: string[]): string[] {
  return [...new Set(ids.filter(Boolean))];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** FACT requires deterministic source-backed provenance. Never silent-label without sources. */
export function assertFactProvenance(assertion: FactualityAssertion): FactualityAssertion {
  if (assertion.type !== "FACT") return assertion;
  if (assertion.sourceIds.length > 0) return assertion;
  return {
    ...assertion,
    type: "UNKNOWN",
    reason:
      assertion.reason ??
      "FACT requires valid source provenance; labeled UNKNOWN because provenance is missing.",
  };
}

/** SUPPORTED_INFERENCE must stay labeled as inference and keep sources. */
export function normalizeSupportedInference(assertion: FactualityAssertion): FactualityAssertion {
  if (assertion.type !== "SUPPORTED_INFERENCE") return assertion;
  const text = assertion.text.trim();
  const hasInferenceCue =
    /\b(suggests|supports the inference|available evidence|record supports|reasonable to infer|may indicate)\b/i.test(
      text,
    );
  const labeled = hasInferenceCue
    ? text
    : `The record supports the inference that ${text.replace(/^[Tt]hat\s+/, "")}`;
  return {
    ...assertion,
    text: labeled,
    reason:
      assertion.reason ??
      "Inference from multiple supported facts/sources; not a record fact.",
  };
}

const CREDIBILITY_LEAP_RE =
  /\b(lied|lying|liar|dishonest|unreliable witness|false testimony|committed perjury|is not credible)\b/i;

/** CONFLICT must not escalate into credibility conclusions. */
export function sanitizeConflictCredibility(assertion: FactualityAssertion): {
  assertion: FactualityAssertion;
  credibilityLeapBlocked: boolean;
} {
  if (assertion.type !== "CONFLICT") {
    return { assertion, credibilityLeapBlocked: false };
  }
  if (!CREDIBILITY_LEAP_RE.test(assertion.text)) {
    return { assertion, credibilityLeapBlocked: false };
  }
  return {
    assertion: {
      ...assertion,
      text: "These statements conflict. The current record contains inconsistent accounts. There is insufficient evidence to determine why they differ.",
      conflictKind: assertion.conflictKind ?? "DIRECT_CONFLICT",
      reason:
        "Credibility leap blocked: contradiction alone does not establish a credibility conclusion.",
    },
    credibilityLeapBlocked: true,
  };
}

const DISPOSITION_WORDS =
  /\b(granted|denied|dismissed|with prejudice|without prejudice|sustained|overruled)\b/i;
const DEADLINE_WORDS =
  /\b(deadline|due (on|by)|closes? (on|by)|must (be )?(filed|served|produced) by|we have until|discovery closes)\b/i;

export type RecordSnapshotForPremise = {
  matterId?: string | null;
  organizationId?: string | null;
  /** Document / evidence / communication IDs known to belong to the matter. */
  allowedSourceIds?: readonly string[];
  /** Explicit persisted deadline labels/dates (never invented). */
  persistedDeadlines?: readonly string[];
  /** Stored motion dispositions (e.g. "GRANTED", "DENIED"). */
  persistedDispositions?: readonly string[];
  /** Authority rows with resolution + treatment. */
  authorities?: ReadonlyArray<{
    id: string;
    resolution: AuthorityResolution | string;
    treatmentVerified: boolean;
    hasFullText?: boolean;
  }>;
  /** Free-text record snippets already retrieved (quotes, ruling summaries). */
  recordText?: string | null;
  /** Whether the user's asserted proposition is affirmed by structured state. */
  propositionSupported?: boolean | null;
  propositionConflicted?: boolean | null;
  propositionPartial?: boolean | null;
};

export type DetectedUserPremise = {
  detected: boolean;
  assertionText: string | null;
  kind:
    | "outcome_win"
    | "credibility"
    | "overruled"
    | "deadline"
    | "disposition"
    | "controls"
    | "proves"
    | "generic"
    | null;
};

/**
 * Structured premise detection — patterns + assertion shape, not keywords alone.
 * Detects user-asserted conclusions that must be evaluated against the record.
 */
export function detectUserPremise(question: string): DetectedUserPremise {
  const q = question.trim();
  if (!q) return { detected: false, assertionText: null, kind: null };

  const win =
    /\b(we (clearly |obviously )?(won|prevail(?:ed)?)|already (won|prevailed)|so we won|we won the (motion|issue|case))\b/i.test(
      q,
    ) || /\b(won the motion|prevailed on)\b.+\b(right|correct|yes)\??\s*$/i.test(q);
  if (win) {
    return { detected: true, assertionText: "User asserts a win/prevailing outcome", kind: "outcome_win" };
  }

  if (
    /\b(witness|they|he|she)\b.{0,40}\b(lie|lied|lying|is dishonest|false testimony)\b/i.test(q) ||
    /\bdid (the )?witness lie\b/i.test(q)
  ) {
    return {
      detected: true,
      assertionText: "User asserts witness lied / credibility failure",
      kind: "credibility",
    };
  }

  if (
    (/\b(overruled|no longer good law|bad law|still good law|good law)\b/i.test(q) &&
      /\b(case|authority|decision|holding|that)\b/i.test(q)) ||
    /\bis (this|that)( case)? still good law\b/i.test(q)
  ) {
    return {
      detected: true,
      assertionText: "User asserts or asks treatment / good-law status",
      kind: "overruled",
    };
  }

  if (
    DEADLINE_WORDS.test(q) &&
    /\b(friday|monday|tuesday|wednesday|thursday|saturday|sunday|tomorrow|next week|\d{1,2}\/\d{1,2}|20\d{2}-\d{2}-\d{2})\b/i.test(
      q,
    )
  ) {
    return {
      detected: true,
      assertionText: "User asserts a concrete deadline",
      kind: "deadline",
    };
  }

  if (
    /\b(judge|court)\b.{0,40}\b(denied|granted|dismissed)\b/i.test(q) ||
    (DISPOSITION_WORDS.test(q) && /\b(motion|claim|complaint)\b/i.test(q) && /\b(right|correct|yes)\??\s*$/i.test(q))
  ) {
    return {
      detected: true,
      assertionText: "User asserts a court disposition",
      kind: "disposition",
    };
  }

  if (/\b(this case controls|controlling authority|that proves|so that proves|obviously|clearly)\b/i.test(q)) {
    const kind = /\bproves\b/i.test(q) ? "proves" : /\bcontrol/i.test(q) ? "controls" : "generic";
    return {
      detected: true,
      assertionText: "User asserts a conclusive legal/matter outcome",
      kind,
    };
  }

  // Soft certainty tags asking for agreement.
  if (/\b(right\?|correct\?|isn't that so\?|doesn't that mean)\s*$/i.test(q) && /\b(so |thus |therefore )/i.test(q)) {
    return {
      detected: true,
      assertionText: "User seeks confirmation of an asserted conclusion",
      kind: "generic",
    };
  }

  return { detected: false, assertionText: null, kind: null };
}

function premiseToFactuality(result: PremiseCheckResult): FactualityType | null {
  switch (result) {
    case "CONFIRMED":
      return "FACT";
    case "PARTIALLY_SUPPORTED":
      return "SUPPORTED_INFERENCE";
    case "CONFLICTED":
      return "CONFLICT";
    case "UNKNOWN":
      return "UNKNOWN";
    case "UNSUPPORTED":
      return "UNSUPPORTED";
    default:
      return null;
  }
}

/**
 * Evaluate a detected user premise against structured matter record state.
 * Prefer UNKNOWN / UNSUPPORTED over guessing. Never invent deadlines or dispositions.
 */
export function evaluatePremiseAgainstRecord(params: {
  question: string;
  record: RecordSnapshotForPremise;
}): PremiseCheck {
  const detected = detectUserPremise(params.question);
  if (!detected.detected) {
    return {
      detected: false,
      userAssertion: null,
      result: "UNKNOWN",
      mappedFactuality: null,
      reason: "No asserted conclusion detected in the question.",
    };
  }

  const recordText = params.record.recordText ?? "";
  const kind = detected.kind;

  if (kind === "deadline") {
    const persisted = params.record.persistedDeadlines ?? [];
    if (persisted.length === 0) {
      return {
        detected: true,
        userAssertion: detected.assertionText,
        result: "UNSUPPORTED",
        mappedFactuality: "UNSUPPORTED",
        reason:
          "No persisted deadline in the record matches the asserted date. Deadlines are not invented from general knowledge.",
      };
    }
    // Presence of some deadline ≠ confirmation of user's specific day.
    const q = params.question.toLowerCase();
    const matched = persisted.some((d) => q.includes(d.toLowerCase()) || d.toLowerCase().includes("friday") === q.includes("friday"));
    if (!matched) {
      return {
        detected: true,
        userAssertion: detected.assertionText,
        result: "UNKNOWN",
        mappedFactuality: "UNKNOWN",
        reason: "Persisted deadlines exist but do not establish the asserted date.",
      };
    }
    return {
      detected: true,
      userAssertion: detected.assertionText,
      result: "CONFIRMED",
      mappedFactuality: "FACT",
      reason: "Asserted deadline matches a persisted record deadline.",
    };
  }

  if (kind === "disposition") {
    const dispositions = (params.record.persistedDispositions ?? []).map((d) => d.toUpperCase());
    const q = params.question.toUpperCase();
    const askedDenied = /\bDENIED\b/.test(q);
    const askedGranted = /\bGRANTED\b/.test(q);
    const askedDismissed = /\bDISMISSED\b/.test(q);
    if (dispositions.length === 0) {
      return {
        detected: true,
        userAssertion: detected.assertionText,
        result: "UNSUPPORTED",
        mappedFactuality: "UNSUPPORTED",
        reason:
          "No stored court disposition supports the asserted ruling. Disposition is not inferred.",
      };
    }
    if (askedDenied && dispositions.includes("DENIED")) {
      return {
        detected: true,
        userAssertion: detected.assertionText,
        result: "CONFIRMED",
        mappedFactuality: "FACT",
        reason: "Stored disposition DENIED matches the assertion.",
      };
    }
    if (askedGranted && dispositions.includes("GRANTED")) {
      return {
        detected: true,
        userAssertion: detected.assertionText,
        result: "CONFIRMED",
        mappedFactuality: "FACT",
        reason: "Stored disposition GRANTED matches the assertion.",
      };
    }
    if (askedDismissed && dispositions.some((d) => d.includes("DISMISS"))) {
      return {
        detected: true,
        userAssertion: detected.assertionText,
        result: "CONFIRMED",
        mappedFactuality: "FACT",
        reason: "Stored disposition matches dismissal assertion.",
      };
    }
    if (
      (askedDenied && dispositions.includes("GRANTED")) ||
      (askedGranted && dispositions.includes("DENIED"))
    ) {
      return {
        detected: true,
        userAssertion: detected.assertionText,
        result: "CONFLICTED",
        mappedFactuality: "CONFLICT",
        reason: "Stored disposition conflicts with the user's asserted ruling.",
      };
    }
    return {
      detected: true,
      userAssertion: detected.assertionText,
      result: "UNKNOWN",
      mappedFactuality: "UNKNOWN",
      reason: "Stored dispositions do not establish the asserted ruling.",
    };
  }

  if (kind === "overruled") {
    const authorities = params.record.authorities ?? [];
    const verifiedNegative = authorities.some(
      (a) => a.treatmentVerified === true && /\boverrul/i.test(recordText),
    );
    if (verifiedNegative) {
      return {
        detected: true,
        userAssertion: detected.assertionText,
        result: "CONFIRMED",
        mappedFactuality: "FACT",
        reason: "Treatment-verified record supports overruled status.",
      };
    }
    const unresolved = authorities.some(
      (a) => a.resolution === "IDENTITY_UNRESOLVED" || a.treatmentVerified !== true,
    );
    return {
      detected: true,
      userAssertion: detected.assertionText,
      result: "UNKNOWN",
      mappedFactuality: "UNKNOWN",
      reason: unresolved
        ? "Authority treatment is NOT VERIFIED / UNKNOWN; overruled status cannot be affirmed."
        : "No treatment-verified source establishes that the case was overruled.",
    };
  }

  if (kind === "credibility") {
    return {
      detected: true,
      userAssertion: detected.assertionText,
      result: "UNSUPPORTED",
      mappedFactuality: "UNSUPPORTED",
      reason:
        "Credibility conclusions are not established from contradiction alone.",
    };
  }

  if (kind === "outcome_win" || kind === "proves") {
    if (params.record.propositionConflicted === true) {
      return {
        detected: true,
        userAssertion: detected.assertionText,
        result: "CONFLICTED",
        mappedFactuality: "CONFLICT",
        reason: "Record contains conflicting support; outcome certainty is not established.",
      };
    }
    if (params.record.propositionSupported === true && kind === "proves") {
      return {
        detected: true,
        userAssertion: detected.assertionText,
        result: "PARTIALLY_SUPPORTED",
        mappedFactuality: "SUPPORTED_INFERENCE",
        reason:
          "Some support exists, but support is not the same as outcome certainty or a win.",
      };
    }
    if (params.record.propositionPartial === true) {
      return {
        detected: true,
        userAssertion: detected.assertionText,
        result: "PARTIALLY_SUPPORTED",
        mappedFactuality: "SUPPORTED_INFERENCE",
        reason: "Partial support in the record; decisive win/outcome is not established.",
      };
    }
    if (params.record.propositionSupported === true && kind === "outcome_win") {
      // Element support ≠ win.
      return {
        detected: true,
        userAssertion: detected.assertionText,
        result: "PARTIALLY_SUPPORTED",
        mappedFactuality: "SUPPORTED_INFERENCE",
        reason:
          "Record support for an issue is not the same as a prevailing outcome. Win not established.",
      };
    }
    const dispositionWin = (params.record.persistedDispositions ?? []).some((d) =>
      /GRANTED|PREVAIL|WON/i.test(d),
    );
    if (dispositionWin && kind === "outcome_win") {
      return {
        detected: true,
        userAssertion: detected.assertionText,
        result: "CONFIRMED",
        mappedFactuality: "FACT",
        reason: "Stored disposition supports a granted/prevailing outcome on the issue.",
      };
    }
    return {
      detected: true,
      userAssertion: detected.assertionText,
      result: "UNSUPPORTED",
      mappedFactuality: "UNSUPPORTED",
      reason:
        "The current record does not establish the asserted win/outcome. Nyaya does not mirror user certainty.",
    };
  }

  if (params.record.propositionConflicted === true) {
    return {
      detected: true,
      userAssertion: detected.assertionText,
      result: "CONFLICTED",
      mappedFactuality: "CONFLICT",
      reason: "Structured matter state conflicts with the asserted conclusion.",
    };
  }
  if (params.record.propositionSupported === true) {
    return {
      detected: true,
      userAssertion: detected.assertionText,
      result: "CONFIRMED",
      mappedFactuality: "FACT",
      reason: "Structured matter state confirms the asserted conclusion.",
    };
  }
  if (params.record.propositionPartial === true) {
    return {
      detected: true,
      userAssertion: detected.assertionText,
      result: "PARTIALLY_SUPPORTED",
      mappedFactuality: "SUPPORTED_INFERENCE",
      reason: "Structured matter state only partially supports the assertion.",
    };
  }

  return {
    detected: true,
    userAssertion: detected.assertionText,
    result: "UNSUPPORTED",
    mappedFactuality: "UNSUPPORTED",
    reason: "The current record does not support the user's asserted conclusion.",
  };
}

export function validateAssertionSources(
  assertion: FactualityAssertion,
  allowedSourceIds: readonly string[],
): FactualityAssertion {
  const allowed = new Set(allowedSourceIds);
  const filtered = assertion.sourceIds.filter((id) => allowed.has(id));
  const next = { ...assertion, sourceIds: filtered };
  if (
    (next.type === "FACT" || next.type === "SUPPORTED_INFERENCE" || next.type === "CONFLICT") &&
    filtered.length === 0 &&
    assertion.sourceIds.length > 0
  ) {
    return {
      ...next,
      type: next.type === "FACT" ? "UNKNOWN" : next.type,
      reason: "Source IDs failed matter validation and were rejected.",
    };
  }
  return assertFactProvenance(next);
}

export function applyAuthoritySafety(assertion: FactualityAssertion): FactualityAssertion {
  if (!assertion.authorityState && assertion.treatmentVerified == null) return assertion;

  if (assertion.authorityState === "IDENTITY_UNRESOLVED") {
    if (assertion.type === "FACT" && /authorit|good law|holding|controls/i.test(assertion.text)) {
      return {
        ...assertion,
        type: "UNKNOWN",
        treatmentVerified: false,
        reason: "IDENTITY_UNRESOLVED authorities cannot become verified authority in the answer.",
      };
    }
  }

  if (assertion.authorityState === "AUTHORITY_RESOLVED" && assertion.treatmentVerified !== true) {
    if (/\b(full opinion|complete analysis of the opinion)\b/i.test(assertion.text)) {
      return {
        ...assertion,
        type: "UNKNOWN",
        reason:
          "AUTHORITY_RESOLVED identifies the authority but does not authorize full-opinion analysis without CORPUS_COMPLETE.",
      };
    }
  }

  if (assertion.treatmentVerified === false || assertion.treatmentVerified == null) {
    if (/\b(overruled|good law|still good law|negative treatment|superseded)\b/i.test(assertion.text)) {
      if (assertion.type === "FACT" || assertion.type === "SUPPORTED_INFERENCE") {
        return {
          ...assertion,
          type: "UNKNOWN",
          treatmentVerified: false,
          reason: "Treatment is NOT VERIFIED; treatment conclusions remain UNKNOWN.",
        };
      }
    }
  }

  return assertion;
}

export function buildFactualitySummary(assertions: FactualityAssertion[]): FactualitySummary {
  return {
    factCount: assertions.filter((a) => a.type === "FACT").length,
    inferenceCount: assertions.filter((a) => a.type === "SUPPORTED_INFERENCE").length,
    conflictCount: assertions.filter((a) => a.type === "CONFLICT").length,
    unknownCount: assertions.filter((a) => a.type === "UNKNOWN").length,
    unsupportedCount: assertions.filter((a) => a.type === "UNSUPPORTED").length,
  };
}

export function normalizeAssertions(
  assertions: FactualityAssertion[],
  allowedSourceIds: readonly string[] = [],
): { assertions: FactualityAssertion[]; credibilityLeapCount: number } {
  let credibilityLeapCount = 0;
  const out: FactualityAssertion[] = [];
  for (const raw of assertions) {
    let next = assertFactProvenance(raw);
    next = normalizeSupportedInference(next);
    const cred = sanitizeConflictCredibility(next);
    if (cred.credibilityLeapBlocked) credibilityLeapCount += 1;
    next = cred.assertion;
    next = applyAuthoritySafety(next);
    if (allowedSourceIds.length > 0) {
      next = validateAssertionSources(next, allowedSourceIds);
    }
    out.push(next);
  }
  return { assertions: out, credibilityLeapCount };
}

export function buildFactualityContract(params: {
  assertions?: FactualityAssertion[];
  premiseCheck?: PremiseCheck | null;
  sourceRefs?: string[];
  authorityRefs?: string[];
  activeEntityRefs?: string[];
  selectedDomains?: string[];
  allowedSourceIds?: readonly string[];
  contextDiagnostics?: FactualityContract["contextDiagnostics"];
}): FactualityContract {
  const seed = [...(params.assertions ?? [])];
  const premiseCheck = params.premiseCheck ?? null;
  if (premiseCheck?.detected && premiseCheck.mappedFactuality) {
    const already = seed.some(
      (a) => a.type === premiseCheck.mappedFactuality && /premise|assert|record does not/i.test(a.reason ?? a.text),
    );
    if (!already) {
      seed.push({
        type: premiseCheck.mappedFactuality,
        text:
          premiseCheck.result === "UNSUPPORTED"
            ? "The current record does not establish the user's asserted conclusion."
            : premiseCheck.result === "UNKNOWN"
              ? "The current record does not establish the asserted proposition."
              : premiseCheck.result === "CONFLICTED"
                ? "The record contains conflicting accounts regarding the asserted proposition."
                : premiseCheck.result === "PARTIALLY_SUPPORTED"
                  ? "The record supports the inference of partial support, not a decisive conclusion."
                  : "The asserted proposition is supported by the record.",
        sourceIds: [],
        relatedEntityIds: [],
        reason: premiseCheck.reason,
      });
    }
  }

  const { assertions: normalized } = normalizeAssertions(seed, params.allowedSourceIds ?? []);

  return {
    version: FACTUALITY_CONTRACT_VERSION,
    assertions: normalized,
    premiseCheck,
    sourceRefs: uniq(params.sourceRefs ?? []),
    authorityRefs: uniq(params.authorityRefs ?? []),
    activeEntityRefs: uniq(params.activeEntityRefs ?? []),
    selectedDomains: uniq(params.selectedDomains ?? []),
    summary: buildFactualitySummary(normalized),
    contextDiagnostics: params.contextDiagnostics,
  };
}

export function parseFactualityContract(raw: unknown): FactualityContract | null {
  const obj = asRecord(raw);
  if (obj.version !== FACTUALITY_CONTRACT_VERSION && obj.version !== 1) return null;
  const parsed = factualityContractSchema.safeParse({
    ...obj,
    version: FACTUALITY_CONTRACT_VERSION,
  });
  return parsed.success ? parsed.data : null;
}

/** Prompt block — instructions only; no chain-of-thought. */
export function formatFactualityContractForPrompt(contract: FactualityContract): string {
  const lines = [
    "FACTUALITY_CONTRACT",
    "Nyaya evaluates the record. Do not advocate for the user's assumption.",
    "Label substantive conclusions as FACT | SUPPORTED_INFERENCE | CONFLICT | UNKNOWN | UNSUPPORTED.",
    "FACT requires source provenance. Do not invent deadlines or dispositions.",
    "CONFLICT describes inconsistency; do not conclude lying/dishonesty from conflict alone.",
    "treatmentVerified=false → treatment remains UNKNOWN / NOT VERIFIED.",
  ];
  if (contract.premiseCheck?.detected) {
    lines.push(
      `PremiseCheck: result=${contract.premiseCheck.result} — ${contract.premiseCheck.reason}`,
    );
  }
  if (contract.selectedDomains.length) {
    lines.push(`SelectedDomains: ${contract.selectedDomains.join(",")}`);
  }
  for (const a of contract.assertions.slice(0, 12)) {
    lines.push(
      `- [${a.type}] ${a.text.slice(0, 240)}${
        a.sourceIds.length ? ` sources=${a.sourceIds.slice(0, 6).join(",")}` : ""
      }`,
    );
  }
  return lines.join("\n");
}

/**
 * When premise check rejects a false premise, rewrite agreeable answers.
 * Does not expose internal reasoning.
 */
export function constrainAnswerToPremiseCheck<T extends { answer: string; evidenceState: string }>(
  answer: T,
  premise: PremiseCheck | null | undefined,
): T {
  if (!premise?.detected) return answer;
  if (premise.result !== "UNSUPPORTED" && premise.result !== "UNKNOWN" && premise.result !== "CONFLICTED") {
    return answer;
  }
  const agrees =
    /\b(yes[,.]?\s+you (won|prevailed)|that's correct|you are right|the witness lied|was overruled|deadline is|judge (denied|granted|dismissed))\b/i.test(
      answer.answer,
    ) || /^\s*yes\b/i.test(answer.answer);
  if (!agrees && /\b(does not establish|not established|unsupported|not verified|conflict)\b/i.test(answer.answer)) {
    return answer;
  }
  if (premise.result === "CONFLICTED") {
    return {
      ...answer,
      answer:
        "These statements conflict. The current record contains inconsistent accounts. There is insufficient evidence to determine why they differ.",
      evidenceState: "partial",
    };
  }
  if (premise.result === "UNKNOWN") {
    return {
      ...answer,
      answer: `The current record does not establish that conclusion. ${premise.reason}`,
      evidenceState: "insufficient",
    };
  }
  return {
    ...answer,
    answer: `Unsupported by the current record. ${premise.reason}`,
    evidenceState: "insufficient",
  };
}

export function countInventedDeadlines(answerText: string, persistedDeadlines: readonly string[]): number {
  if (!DEADLINE_WORDS.test(answerText)) return 0;
  if (!/\b(friday|monday|tuesday|wednesday|thursday|saturday|sunday|tomorrow|20\d{2}-\d{2}-\d{2})\b/i.test(answerText)) {
    return 0;
  }
  // Negated / unknown statements are not inventions.
  if (/\b(does not establish|not established|no (persisted |stored )?deadline|unknown)\b/i.test(answerText)) {
    return 0;
  }
  if (persistedDeadlines.length === 0) return 1;
  return 0;
}

export function countInventedDispositions(answerText: string, persistedDispositions: readonly string[]): number {
  if (!DISPOSITION_WORDS.test(answerText)) return 0;
  if (/\b(does not establish|not established|no stored|unknown|not found)\b/i.test(answerText)) {
    return 0;
  }
  if (persistedDispositions.length === 0) return 1;
  return 0;
}

export function countCredibilityLeaps(answerText: string): number {
  if (!CREDIBILITY_LEAP_RE.test(answerText)) return 0;
  if (/\b(does not establish|insufficient evidence to determine|conflict)\b/i.test(answerText)) {
    return 0;
  }
  return 1;
}

export { premiseToFactuality };
