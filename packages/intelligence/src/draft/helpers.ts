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

/** Deterministic paragraph-level diff for document comparison. */
export function computeParagraphDiffs(textA: string, textB: string): DiffChange[] {
  const paragraphsA = splitParagraphs(textA);
  const paragraphsB = splitParagraphs(textB);
  const lcs = longestCommonSubsequence(paragraphsA, paragraphsB);
  const changes: DiffChange[] = [];

  let i = 0;
  let j = 0;

  for (const [ai, bj] of lcs) {
    while (i < ai) {
      changes.push({
        changeType: "removed",
        locationA: `paragraph ${i + 1}`,
        locationB: null,
        oldText: paragraphsA[i] ?? null,
        newText: null,
        attention: classifyAttention(paragraphsA[i] ?? ""),
      });
      i += 1;
    }
    while (j < bj) {
      changes.push({
        changeType: "added",
        locationA: null,
        locationB: `paragraph ${j + 1}`,
        oldText: null,
        newText: paragraphsB[j] ?? null,
        attention: classifyAttention(paragraphsB[j] ?? ""),
      });
      j += 1;
    }
    const aText = paragraphsA[i] ?? "";
    const bText = paragraphsB[j] ?? "";
    if (normalizeWhitespace(aText) !== normalizeWhitespace(bText)) {
      changes.push({
        changeType: "changed",
        locationA: `paragraph ${i + 1}`,
        locationB: `paragraph ${j + 1}`,
        oldText: aText,
        newText: bText,
        attention: classifyAttention(`${aText} ${bText}`),
      });
    } else if (aText !== bText) {
      changes.push({
        changeType: "formatting",
        locationA: `paragraph ${i + 1}`,
        locationB: `paragraph ${j + 1}`,
        oldText: aText,
        newText: bText,
        attention: "informational",
      });
    }
    i += 1;
    j += 1;
  }

  while (i < paragraphsA.length) {
    changes.push({
      changeType: "removed",
      locationA: `paragraph ${i + 1}`,
      locationB: null,
      oldText: paragraphsA[i] ?? null,
      newText: null,
      attention: classifyAttention(paragraphsA[i] ?? ""),
    });
    i += 1;
  }
  while (j < paragraphsB.length) {
    changes.push({
      changeType: "added",
      locationA: null,
      locationB: `paragraph ${j + 1}`,
      oldText: null,
      newText: paragraphsB[j] ?? null,
      attention: classifyAttention(paragraphsB[j] ?? ""),
    });
    j += 1;
  }

  return changes;
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

function classifyAttention(text: string): "informational" | "review" | "high_attention" {
  const lower = text.toLowerCase();
  if (/indemn|liabil|terminat|warrant|sole discretion|without limitation/.test(lower)) {
    return "high_attention";
  }
  if (/payment|confidential|obligation|shall|must|agreement/.test(lower)) {
    return "review";
  }
  return "informational";
}

function longestCommonSubsequence(a: string[], b: string[]): Array<[number, number]> {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (normalizeWhitespace(a[i - 1]!) === normalizeWhitespace(b[j - 1]!)) {
        dp[i]![j] = dp[i - 1]![j - 1]! + 1;
      } else {
        dp[i]![j] = Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
      }
    }
  }
  const out: Array<[number, number]> = [];
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    if (normalizeWhitespace(a[i - 1]!) === normalizeWhitespace(b[j - 1]!)) {
      out.unshift([i - 1, j - 1]);
      i -= 1;
      j -= 1;
    } else if (dp[i - 1]![j]! >= dp[i]![j - 1]!) {
      i -= 1;
    } else {
      j -= 1;
    }
  }
  return out;
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

function significantTokens(text: string): string[] {
  return normalizeWhitespace(text.toLowerCase())
    .replace(/[^a-z0-9$\-.\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 5 && !COMPARISON_STOPWORDS.has(t));
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
  const hit = tokens.filter((t) => digest.includes(t)).length;
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

  if (score.alignment === "aligned") {
    return { summary: summary.trim(), score };
  }

  const withNote = summary.includes(COMPARISON_SUMMARY_MISALIGN_NOTE)
    ? summary.trim()
    : `${summary.trim()}\n\n${COMPARISON_SUMMARY_MISALIGN_NOTE}`;
  return { summary: withNote, score: scoreComparisonSummaryAgainstDiffs(withNote, changes) };
}
