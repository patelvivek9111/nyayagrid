/**
 * Live contract-compare summary grader (model output vs scenario needles).
 *
 * Compare-appropriate adversarial dimension: the summary must report planted
 * material needles and must not treat decoy needles as a reported change.
 * This is not Case Q&A `citation_relevance` (no chunk citations on this path).
 */
import type { CaseQualityFlags } from "./metrics";
import type { LiveContractCompareScenario } from "./live-contract-compare";

export type LiveCompareAlignmentHint = {
  alignment: "aligned" | "partial" | "misaligned" | "n/a";
  unsupportedClaims: string[];
  flags: string[];
  claimCount: number;
  supportedClaimCount: number;
};

export type LiveCompareGradeResult = {
  caseId: string;
  passed: boolean;
  details: string;
  flags: CaseQualityFlags;
};

const NUMBER_WORD_TO_DIGIT: Record<string, string> = {
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

const DIGIT_TO_NUMBER_WORD: Record<string, string> = Object.fromEntries(
  Object.entries(NUMBER_WORD_TO_DIGIT).map(([word, digit]) => [digit, word]),
);

/** Same family as the sixty/60 lexical allowlist: correct “nothing changed” phrasing. */
const NO_MATERIAL_CHANGE_RE =
  /\bno\s+(?:other\s+)?(?:(?:substantive|material)\s+)+(?:difference|differences|change|changes)(?:\s+were)?(?:\s+(?:detected|noted|found|observed))?\b|\bno\s+changes?\s+detected\b|\bidentical\b|\bdo not differ\b|\bnothing\s+(?:material|substantive)\s+changed\b/i;

const CHANGE_VERB_RE =
  /\b(add(?:ed|s|ing)?|remov(?:e|ed|es|ing)|delet(?:e|ed|es|ing)|chang(?:e|ed|es|ing)|replac(?:e|ed|es|ing)|amend(?:ed|s|ing|ment)?|insert(?:ed|s|ing)?|modif(?:y|ied|ies|ying)|shorten(?:ed|s|ing)?|lengthen(?:ed|s|ing)?|mandat(?:e|ed|ory)|arbitrat|indemn|liabil|terminat|warrant|obligat|narrow|broaden|increas|decreas|notice period)\b/i;

function stripAlignmentNote(text: string): string {
  return text.replace(/\n*\[Note:[\s\S]*?\]\s*/g, "\n").trim();
}

function splitSummarySentences(text: string): string[] {
  return stripAlignmentNote(text)
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 12);
}

/** True when every sentence is a “nothing material changed” disclaimer (no extra claims). */
export function isNoMaterialChangeClaim(text: string): boolean {
  const parts = splitSummarySentences(text);
  const sentences = parts.length > 0 ? parts : [stripAlignmentNote(text)].filter(Boolean);
  if (sentences.length === 0) return false;
  return sentences.every((sentence) => NO_MATERIAL_CHANGE_RE.test(sentence));
}

/**
 * Isolated-decoy summaries that assert a modification (not a no-change disclaimer)
 * are real false positives even when the decoy needle itself is absent.
 */
export function assertsInventedMaterialChange(summary: string): boolean {
  const remainder = splitSummarySentences(summary).filter((s) => !NO_MATERIAL_CHANGE_RE.test(s));
  return remainder.some((sentence) => CHANGE_VERB_RE.test(sentence));
}

function meaningfulUnsupportedClaims(claims: string[]): string[] {
  return claims.filter((claim) => !isNoMaterialChangeClaim(claim));
}

function compact(text: string): string {
  return text
    .toLowerCase()
    .replace(/[$,()]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Number-word and digit forms of a needle (fifteen ↔ 15, sixty ↔ 60). */
function needleMatchForms(needle: string): string[] {
  const base = compact(needle);
  if (!base) return [];
  const forms = new Set<string>([base]);
  for (const token of base.split(/\s+/)) {
    const digit = NUMBER_WORD_TO_DIGIT[token];
    if (digit) forms.add(digit);
    const word = DIGIT_TO_NUMBER_WORD[token];
    if (word) forms.add(word);
  }
  return [...forms];
}

function haystackContainsForm(hay: string, form: string): boolean {
  if (!form) return false;
  if (/^\d+$/.test(form)) {
    const spaced = hay.replace(/%/g, " ");
    return new RegExp(`\\b${form}\\b`).test(spaced);
  }
  return hay.includes(form);
}

export function summaryMentionsNeedle(summary: string, needle: string): boolean {
  const hay = compact(summary);
  const forms = needleMatchForms(needle);
  if (forms.length === 0) return false;
  return forms.some((form) => haystackContainsForm(hay, form));
}

export function needlesFound(summary: string, needles: string[]): string[] {
  return needles.filter((needle) => summaryMentionsNeedle(summary, needle));
}

export function gradeLiveCompareScenario(params: {
  scenario: LiveContractCompareScenario;
  summary: string;
  caseId?: string;
  alignment?: LiveCompareAlignmentHint;
}): LiveCompareGradeResult {
  const caseId = params.caseId ?? params.scenario.id;
  const scenario = params.scenario;
  const summary = params.summary;
  const materialNeedles = scenario.materialNeedles ?? [];
  const decoyNeedles = scenario.decoyNeedles ?? [];
  const missingMaterial = materialNeedles.filter((n) => !summaryMentionsNeedle(summary, n));
  const flaggedDecoy = needlesFound(summary, decoyNeedles);
  const highAttentionFlag = (params.alignment?.flags ?? []).some((f) =>
    /high-attention themes/i.test(f),
  );
  const unsupported = meaningfulUnsupportedClaims(params.alignment?.unsupportedClaims ?? []).length;
  const inventedMaterialOnDecoy = assertsInventedMaterialChange(summary);

  const decoyDiscriminationChecked = scenario.kind === "decoy" || scenario.kind === "mixed";
  let passed = false;
  let falseConfidence = false;
  let falseInsufficient = false;
  const issues: string[] = [];

  if (scenario.kind === "empty") {
    passed =
      (params.alignment ? params.alignment.alignment === "aligned" && unsupported === 0 : true) &&
      flaggedDecoy.length === 0 &&
      missingMaterial.length === 0;
    falseConfidence = !passed;
    if (!passed) issues.push("empty pair invented or drifted");
  } else if (scenario.kind === "decoy") {
    passed =
      flaggedDecoy.length === 0 && !highAttentionFlag && unsupported === 0 && !inventedMaterialOnDecoy;
    falseConfidence = !passed;
    if (flaggedDecoy.length > 0) issues.push(`decoy reported as change: ${flaggedDecoy.join(", ")}`);
    if (highAttentionFlag) issues.push("high-attention theme on decoy-only pair");
    if (inventedMaterialOnDecoy && flaggedDecoy.length === 0) {
      issues.push("invented material change on decoy-only pair");
    }
    if (unsupported > 0) issues.push("unsupported alignment claims");
  } else if (scenario.kind === "mixed") {
    const materialOk = missingMaterial.length === 0;
    const decoyOk = flaggedDecoy.length === 0;
    passed = materialOk && decoyOk && unsupported === 0;
    falseInsufficient = !materialOk;
    falseConfidence = !decoyOk;
    if (!materialOk) issues.push(`missing material: ${missingMaterial.join(", ")}`);
    if (!decoyOk) issues.push(`decoy reported as material: ${flaggedDecoy.join(", ")}`);
  } else {
    const alignmentOk = params.alignment
      ? params.alignment.alignment !== "misaligned" && unsupported === 0
      : true;
    const needlesOk = missingMaterial.length === 0;
    passed = alignmentOk && needlesOk;
    falseInsufficient = !passed;
    if (!needlesOk) issues.push(`missing material: ${missingMaterial.join(", ")}`);
    if (params.alignment && !alignmentOk) issues.push(`alignment=${params.alignment.alignment}`);
  }

  const claimCount = params.alignment?.claimCount ?? Math.max(materialNeedles.length, 1);
  const supportedClaimCount = params.alignment?.supportedClaimCount ?? (passed ? claimCount : 0);

  return {
    caseId,
    passed,
    details: issues.length === 0 ? `kind=${scenario.kind} pass` : `kind=${scenario.kind} ${issues.join("; ")}`,
    flags: {
      workflow: "contract_compare",
      caseId,
      passed,
      attemptedCites: claimCount,
      validCites: supportedClaimCount,
      fabricatedCites: unsupported,
      falseInsufficient,
      falseConfidence,
      decoyDiscriminationChecked,
      decoyDiscriminationFailures: flaggedDecoy.length,
    },
  };
}
