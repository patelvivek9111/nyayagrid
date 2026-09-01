import {
  buildDeterministicMaterialSummary,
  computeClauseDiffs,
  summaryDeniesSubstantiveChanges,
} from "../analysis/clause-compare";

export function normalizeDraftGenerationRaw(raw: unknown): {
  content: string;
  assertions: unknown;
  assumptions: unknown;
} {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { content: typeof raw === "string" && raw.trim() ? raw : " ", assertions: [], assumptions: [] };
  }
  const rec = raw as Record<string, unknown>;
  let content = rec.content;
  if (typeof content !== "string") {
    content =
      content == null
        ? " "
        : typeof content === "object"
          ? JSON.stringify(content)
          : String(content);
  }
  if (!(content as string).trim()) content = " ";
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const assertions = Array.isArray(rec.assertions)
    ? rec.assertions
        .map((row) => {
          if (!row || typeof row !== "object") return null;
          const item = row as { text?: unknown; chunkIds?: unknown };
          const chunkIds = Array.isArray(item.chunkIds)
            ? item.chunkIds.filter((id): id is string => typeof id === "string" && uuid.test(id))
            : [];
          if (typeof item.text !== "string" || chunkIds.length === 0) return null;
          return { text: item.text, chunkIds };
        })
        .filter(Boolean)
    : [];
  return {
    content: content as string,
    assertions,
    assumptions: Array.isArray(rec.assumptions) ? rec.assumptions : [],
  };
}

/** Drop quotation marks around spans that do not appear in provided source text. */
export function neutralizeUnsupportedQuotes(content: string, sourceText: string): string {
  if (!sourceText.trim()) return content;
  return content.replace(/[“"]([^”"]{8,400})[”"]/g, (full, inner: string) => {
    const span = inner.trim();
    if (sourceText.includes(span)) return full;
    return inner;
  });
}

/**
 * User instructions may request advocacy tone. They are not evidence.
 * If Sources limit physical-entry inferences or mark an exhibit missing, do not leave
 * those requests as established facts in the draft body.
 */
export function applySourceLimitationGuard(content: string, sourceText: string): string {
  if (!content.trim() || !sourceText.trim()) return content;
  const sources = sourceText.toLowerCase();
  const entryLimited =
    /does not independently prove|did not enter|denies entering|not a finding that/.test(sources);
  const exhibitMissing = /not attached|not among the uploaded|exhibit [a-z0-9]+ is not/.test(sources);
  const sourcesMarkCurrent = /\btemporalApplicability["']?\s*[:=]\s*["']?applicable\b/i.test(
    sourceText,
  );

  let next = content;
  if (entryLimited) {
    next = next.replace(
      /\b(?:it is unequivocally clear that |we (?:can |must )?say )?[A-Z][\w'.-]*(?:\s+[A-Z][\w'.-]*)*\s+entered the\b/g,
      "Sources do not independently prove that a named person entered the",
    );
    next = next.replace(
      /\bentered the (archive vault|records room|vault)\b/gi,
      "was not independently proven by the access record to have entered the $1",
    );
  }
  if (exhibitMissing) {
    next = next.replace(
      /\bExhibit\s+([A-Z0-9]+)\s+(proves|substantiates|establishes|shows|provides)\b/gi,
      "Exhibit $1 is not in the Case file and does not $2",
    );
  }
  if (!sourcesMarkCurrent) {
    next = next.replace(/\bno temporal uncertainty\b/gi, "unresolved temporal uncertainty");
    next = next.replace(/\bdefinitely the current law\b/gi, "not proven to be current law from imported sources");
    next = next.replace(/\bthis is (definitely )?the current law\b/gi, "this is not proven current from imported sources");
    next = next.replace(/\bcurrently effective\b/gi, "not shown as current by the imported sources");
  }
  return next;
}

export const INSUFFICIENT_SOURCE_MATERIAL =
  "Insufficient source material was provided for a fully grounded draft.";

export function withInsufficientSourceAssumption(params: {
  chunkCount: number;
  assumptions: string[];
}): { assumptions: string[]; insufficientSourceMaterial: boolean } {
  const insufficientSourceMaterial = params.chunkCount === 0;
  const assumptions = [...params.assumptions];
  if (
    insufficientSourceMaterial &&
    !assumptions.some((item) => /insufficient source material/i.test(item))
  ) {
    assumptions.push(INSUFFICIENT_SOURCE_MATERIAL);
  }
  return { assumptions, insufficientSourceMaterial };
}

export function extractUnresolvedPlaceholders(content: string, assumptions: string[]): string[] {
  const fromContent = [...content.matchAll(/\[(?:PLACEHOLDER|TODO|TBD)[^\]]*\]/gi)].map(
    (match) => match[0],
  );
  const fromAssumptions = assumptions.filter((item) =>
    /unknown|unresolved|missing|insufficient|placeholder|citation needed/i.test(item),
  );
  return [...new Set([...fromContent, ...fromAssumptions])];
}
export const EXTERNAL_RESEARCH_NOTE =
  "[Note: External legal research is not enabled. Verify any legal authority references independently.]";

export const RESEARCH_AUTHORITY_INCOMPLETE_NOTE =
  "[Note: Legal research support for this draft is incomplete. Its legal propositions are not fully tied to authorities saved to this matter, and authority treatment has not been verified. Complete research and verify every citation before relying on this draft.]";

export function buildContractAnalysisIdempotencyKey(documentVersionId: string): string {
  return `contract_analysis:${documentVersionId}`;
}

export function buildComparisonIdempotencyKey(versionAId: string, versionBId: string): string {
  const sorted = [versionAId, versionBId].sort();
  return `document_comparison:${sorted[0]}:${sorted[1]}`;
}

export function needsExternalResearchNote(assumptions: string[], content: string): boolean {
  const combined = [...assumptions, content].join(" ").toLowerCase();
  return /legal authority|case law|statute|precedent|regulation|citation needed|external research|legal research/.test(
    combined,
  );
}

export function appendExternalResearchNoteIfNeeded(content: string, assumptions: string[]): string {
  if (!needsExternalResearchNote(assumptions, content)) return content;
  if (content.includes(EXTERNAL_RESEARCH_NOTE)) return content;
  return `${content.trim()}\n\n${EXTERNAL_RESEARCH_NOTE}`;
}

export type DiffChange = {
  changeType: "added" | "removed" | "changed" | "moved" | "formatting";
  locationA: string | null;
  locationB: string | null;
  oldText: string | null;
  newText: string | null;
  attention: "informational" | "review" | "high_attention";
};

/** Deterministic clause-level diff for document comparison. */
export function computeParagraphDiffs(textA: string, textB: string): DiffChange[] {
  return computeClauseDiffs(textA, textB);
}

export function splitParagraphs(text: string): string[] {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];
  const byBlank = normalized
    .split(/\n\s*\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (byBlank.length > 1) return byBlank;
  return normalized
    .split(/\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function validateDraftAssertions(
  assertions: Array<{ text: string; chunkIds: string[] }>,
  authorizedChunkIds: Set<string>,
): Array<{ text: string; chunkIds: string[] }> {
  return assertions
    .map((assertion) => ({
      text: assertion.text,
      chunkIds: assertion.chunkIds.filter((id) => authorizedChunkIds.has(id)),
    }))
    .filter((assertion) => assertion.chunkIds.length > 0);
}

/** Matter document chunks support facts; corpus authority chunks support law. Never the reverse. */
export type DraftProvenanceClass = "FACT_SOURCE" | "LEGAL_AUTHORITY";

export type ClassifiedDraftAssertion = {
  text: string;
  chunkIds: string[];
  provenanceClass: DraftProvenanceClass;
};

/**
 * Split validated draft assertions by provenance class.
 *
 * A model may cite matter chunks and authority chunks in one assertion; that becomes two entries so
 * a factual citation can never be recorded as legal authority. Citations belonging to neither
 * authorized set are dropped, and an assertion left with no citation is discarded.
 */
export function classifyDraftAssertions(
  assertions: Array<{ text: string; chunkIds: string[] }>,
  authorized: { factChunkIds: Set<string>; authorityChunkIds: Set<string> },
): ClassifiedDraftAssertion[] {
  const classified: ClassifiedDraftAssertion[] = [];
  for (const assertion of assertions) {
    const factChunkIds = assertion.chunkIds.filter((id) => authorized.factChunkIds.has(id));
    const authorityChunkIds = assertion.chunkIds.filter(
      (id) => authorized.authorityChunkIds.has(id) && !authorized.factChunkIds.has(id),
    );
    if (factChunkIds.length > 0) {
      classified.push({
        text: assertion.text,
        chunkIds: factChunkIds,
        provenanceClass: "FACT_SOURCE",
      });
    }
    if (authorityChunkIds.length > 0) {
      classified.push({
        text: assertion.text,
        chunkIds: authorityChunkIds,
        provenanceClass: "LEGAL_AUTHORITY",
      });
    }
  }
  return classified;
}

export function countAssertionsByProvenance(
  assertions: ClassifiedDraftAssertion[],
): Record<DraftProvenanceClass, number> {
  return {
    FACT_SOURCE: assertions.filter((a) => a.provenanceClass === "FACT_SOURCE").length,
    LEGAL_AUTHORITY: assertions.filter((a) => a.provenanceClass === "LEGAL_AUTHORITY").length,
  };
}

/**
 * A draft needs the research disclaimer when its legal propositions are not fully backed by the
 * matter's saved authorities, or when some saved authority could not supply usable text.
 */
export function needsResearchDisclaimer(input: {
  savedAuthorityCount: number;
  legalAuthorityAssertionCount: number;
  authorityWarningCount?: number;
}): boolean {
  if ((input.authorityWarningCount ?? 0) > 0) return true;
  if (input.savedAuthorityCount === 0) return false;
  return input.legalAuthorityAssertionCount === 0;
}

export function appendResearchDisclaimerIfNeeded(
  content: string,
  input: {
    savedAuthorityCount: number;
    legalAuthorityAssertionCount: number;
    authorityWarningCount?: number;
  },
): string {
  if (!needsResearchDisclaimer(input)) return content;
  if (content.includes(RESEARCH_AUTHORITY_INCOMPLETE_NOTE)) return content;
  return `${content.trim()}\n\n${RESEARCH_AUTHORITY_INCOMPLETE_NOTE}`;
}

/** Fixed disclaimer when an AI comparison summary drifts from the deterministic diff. */
export const COMPARISON_SUMMARY_MISALIGN_NOTE =
  "[Note: AI summary claims are not fully aligned with the deterministic paragraph diff. Treat the summary as a proposal and verify every claim against the change list.]";

const COMPARISON_STOPWORDS = new Set([
  "about",
  "after",
  "between",
  "change",
  "changes",
  "clause",
  "document",
  "documents",
  "from",
  "into",
  "material",
  "other",
  "party",
  "section",
  "should",
  "substantive",
  "summary",
  "that",
  "their",
  "there",
  "these",
  "this",
  "those",
  "under",
  "version",
  "versions",
  "which",
  "while",
  "with",
  "would",
]);

export type ComparisonSummaryAlignment = "aligned" | "partial" | "misaligned" | "n/a";

export type ComparisonSummaryScore = {
  alignment: ComparisonSummaryAlignment;
  /** 0–1 fraction of change-claims supported by the diff digest. */
  score: number;
  claimCount: number;
  supportedClaimCount: number;
  unsupportedClaims: string[];
  flags: string[];
  highAttentionInDiff: number;
  highAttentionMentionedInSummary: boolean;
};

/**
 * Map number-words to digits so "sixty (60) days" and "60 days" are the same claim.
 * Digits longer than one character are applied first so 60 is not eaten as 6.
 */
const NUMBER_WORD_TO_DIGIT: Record<string, string> = {
  zero: "0",
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
  ten: "10",
  eleven: "11",
  twelve: "12",
  thirteen: "13",
  fourteen: "14",
  fifteen: "15",
  sixteen: "16",
  seventeen: "17",
  eighteen: "18",
  nineteen: "19",
  twenty: "20",
  thirty: "30",
  forty: "40",
  fifty: "50",
  sixty: "60",
  seventy: "70",
  eighty: "80",
  ninety: "90",
};

function numericEquivalents(token: string): string[] {
  const out = [token];
  const asDigit = NUMBER_WORD_TO_DIGIT[token];
  if (asDigit) out.push(asDigit);
  const asWord = Object.entries(NUMBER_WORD_TO_DIGIT).find(([, d]) => d === token)?.[0];
  if (asWord) out.push(asWord);
  return out;
}

function expandNumericFormsInText(text: string): string {
  let out = text;
  const words = Object.keys(NUMBER_WORD_TO_DIGIT).sort((a, b) => b.length - a.length);
  for (const word of words) {
    const digit = NUMBER_WORD_TO_DIGIT[word]!;
    out = out.replace(new RegExp(`\\b${word}\\b`, "gi"), `${word} ${digit}`);
  }
  const digits = [...new Set(Object.values(NUMBER_WORD_TO_DIGIT))].sort(
    (a, b) => b.length - a.length || Number(b) - Number(a),
  );
  for (const digit of digits) {
    const word = Object.entries(NUMBER_WORD_TO_DIGIT).find(([, d]) => d === digit)?.[0];
    if (!word) continue;
    out = out.replace(new RegExp(`\\b${digit}\\b`, "g"), `${digit} ${word}`);
  }
  return out;
}

function significantTokens(text: string): string[] {
  const raw = normalizeWhitespace(text.toLowerCase())
    .replace(/[^a-z0-9$\-.\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const tokens: string[] = [];
  const seen = new Set<string>();
  for (const t of raw) {
    const isDigit = /^\d+$/.test(t);
    const keep = t.length >= 5 || isDigit;
    if (!keep) continue;
    if (!isDigit && COMPARISON_STOPWORDS.has(t)) continue;
    for (const eq of numericEquivalents(t)) {
      if (seen.has(eq)) continue;
      seen.add(eq);
      tokens.push(eq);
    }
  }
  return tokens;
}

function splitSummaryClaims(summary: string): string[] {
  return summary
    .replace(COMPARISON_SUMMARY_MISALIGN_NOTE, "")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 12);
}

function isChangeClaim(sentence: string): boolean {
  return /\b(add(?:ed|s|ing)?|remov(?:e|ed|es|ing)|delet(?:e|ed|es|ing)|chang(?:e|ed|es|ing)|replac(?:e|ed|es|ing)|amend(?:ed|s|ing|ment)?|insert(?:ed|s|ing)?|modif(?:y|ied|ies|ying)|shorten(?:ed|s|ing)?|lengthen(?:ed|s|ing)?|mandat(?:e|ed|ory)|arbitrat|indemn|liabil|terminat|warrant|obligat|narrow|broaden|increas|decreas|notice period)\b/i.test(
    sentence,
  );
}

function digestSupportsTokens(digest: string, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  const expanded = expandNumericFormsInText(digest);
  const hit = tokens.filter((t) => expanded.includes(t)).length;
  return hit / tokens.length >= 0.34;
}

/** Build a searchable corpus of deterministic diff text for alignment checks. */
export function buildDiffDigestCorpus(changes: DiffChange[]): string {
  return normalizeWhitespace(
    changes
      .map(
        (c) =>
          `${c.changeType} ${c.attention} ${c.locationA ?? ""} ${c.locationB ?? ""} ${c.oldText ?? ""} ${c.newText ?? ""}`,
      )
      .join("\n")
      .toLowerCase(),
  );
}

/**
 * Score an AI (or any) comparison summary against deterministic paragraph diffs.
 * Unsupported material claims are listed so callers can flag or rewrite the summary.
 */
export function scoreComparisonSummaryAgainstDiffs(
  summary: string,
  changes: DiffChange[],
): ComparisonSummaryScore {
  const trimmed = (summary ?? "").trim();
  const flags: string[] = [];
  const highAttentionInDiff = changes.filter((c) => c.attention === "high_attention").length;
  const highAttentionMentionedInSummary =
    /indemn|liabil|terminat|warrant|sole discretion|without limitation/i.test(trimmed);

  if (!trimmed) {
    return {
      alignment: changes.length === 0 ? "aligned" : "n/a",
      score: changes.length === 0 ? 1 : 0,
      claimCount: 0,
      supportedClaimCount: 0,
      unsupportedClaims: [],
      flags: changes.length === 0 ? [] : ["Summary is empty while diffs exist."],
      highAttentionInDiff,
      highAttentionMentionedInSummary,
    };
  }

  if (changes.length === 0) {
    const inventsChanges =
      isChangeClaim(trimmed) &&
      !/no substantive difference|no material difference|identical|no changes detected|do not differ/i.test(
        trimmed,
      );
    if (inventsChanges) {
      return {
        alignment: "misaligned",
        score: 0,
        claimCount: 1,
        supportedClaimCount: 0,
        unsupportedClaims: [trimmed.slice(0, 240)],
        flags: ["Summary invents differences though the deterministic diff is empty."],
        highAttentionInDiff,
        highAttentionMentionedInSummary,
      };
    }
    return {
      alignment: "aligned",
      score: 1,
      claimCount: 0,
      supportedClaimCount: 0,
      unsupportedClaims: [],
      flags: [],
      highAttentionInDiff,
      highAttentionMentionedInSummary,
    };
  }

  const digest = buildDiffDigestCorpus(changes);
  const claims = splitSummaryClaims(trimmed).filter(isChangeClaim);
  const unsupportedClaims: string[] = [];

  for (const claim of claims) {
    const tokens = significantTokens(claim);
    if (tokens.length === 0) continue;
    if (!digestSupportsTokens(digest, tokens)) {
      unsupportedClaims.push(claim.slice(0, 240));
    }
  }

  // Catch fluent inventions that avoid change-verbs but still assert foreign facts.
  if (claims.length === 0) {
    const tokens = significantTokens(trimmed);
    if (tokens.length >= 4 && !digestSupportsTokens(digest, tokens)) {
      unsupportedClaims.push(trimmed.slice(0, 240));
    }
  }

  if (highAttentionMentionedInSummary && highAttentionInDiff === 0) {
    flags.push(
      "Summary references high-attention themes (e.g. indemnity/termination) not present in the diff.",
    );
  }

  if (highAttentionInDiff > 0 && summaryDeniesSubstantiveChanges(trimmed)) {
    flags.push("Summary denies substantive changes while high-attention diffs exist.");
  }

  const effectiveClaimCount = Math.max(claims.length, unsupportedClaims.length > 0 ? 1 : 0);
  const supportedClaimCount = Math.max(0, effectiveClaimCount - unsupportedClaims.length);
  const score =
    effectiveClaimCount === 0
      ? flags.length === 0
        ? 1
        : 0.5
      : supportedClaimCount / effectiveClaimCount;

  let alignment: ComparisonSummaryAlignment = "aligned";
  if (unsupportedClaims.length > 0 || flags.length > 0) {
    alignment =
      score >= 0.5 && unsupportedClaims.length < effectiveClaimCount ? "partial" : "misaligned";
  }
  if (alignment !== "aligned") {
    flags.push("Verify AI summary against the deterministic change list before relying on it.");
  }

  return {
    alignment,
    score: Number(score.toFixed(3)),
    claimCount: effectiveClaimCount,
    supportedClaimCount,
    unsupportedClaims,
    flags: [...new Set(flags)],
    highAttentionInDiff,
    highAttentionMentionedInSummary,
  };
}

/** Apply alignment policy: empty-diff inventions are replaced; drift gets a fixed note. */
export function applyComparisonSummaryAlignmentPolicy(
  summary: string,
  changes: DiffChange[],
): { summary: string; score: ComparisonSummaryScore } {
  const score = scoreComparisonSummaryAgainstDiffs(summary, changes);

  if (changes.length === 0 && score.alignment === "misaligned") {
    return {
      summary: "No substantive differences detected between the compared document versions.",
      score: scoreComparisonSummaryAgainstDiffs(
        "No substantive differences detected between the compared document versions.",
        changes,
      ),
    };
  }

  const hasMaterial = changes.some((change) => change.attention === "high_attention");
  if (hasMaterial && summaryDeniesSubstantiveChanges(summary)) {
    const rewritten = buildDeterministicMaterialSummary(changes);
    return { summary: rewritten, score: scoreComparisonSummaryAgainstDiffs(rewritten, changes) };
  }

  if (score.alignment === "aligned") {
    return { summary: summary.trim(), score };
  }

  const withNote = summary.includes(COMPARISON_SUMMARY_MISALIGN_NOTE)
    ? summary.trim()
    : `${summary.trim()}\n\n${COMPARISON_SUMMARY_MISALIGN_NOTE}`;
  return { summary: withNote, score: scoreComparisonSummaryAgainstDiffs(withNote, changes) };
}
