/**
 * Live-model contract-compare summary scenarios.
 *
 * Deterministic diff cases stay in graded-cases-contract-compare.ts (n=27).
 * These pairs are what the live compare *agent* is scored on.
 */
import { GOLDEN_CONTRACT_ORIGINAL, GOLDEN_CONTRACT_REDLINE } from "./golden-contract-pair";

export const COMPARE_SUMMARY_PROMPT_VERSION = "compare-summary-v4";

export const COMPARE_MIXED_EXAMPLE_MARKER = "Worked example (SYNTH mixed digest)";

export const COMPARE_MIXED_WORKED_EXAMPLE = `${COMPARE_MIXED_EXAMPLE_MARKER}: Detected-change list contains (1) assignment: Vendor's sole discretion consent -> Vendor's reasonable consent (material) and (2) exhibit numbering: Exhibit 1 lists the statements of work -> Exhibit I lists the statements of work (style only, not material). Correct output: summary reports only the assignment change to reasonable consent. Do not mention Exhibit 1 or Exhibit I.`;

export const COMPARE_ISOLATED_DECOY_EXAMPLE_MARKER = "Worked example (SYNTH isolated decoy digest)";

export const COMPARE_ISOLATED_DECOY_WORKED_EXAMPLE = `${COMPARE_ISOLATED_DECOY_EXAMPLE_MARKER}: Detected-change list contains only Exhibit 1 -> Exhibit I numbering (style, not material). No term, fee, indemnity, notice, warranty, assignment, or insurance edit. Correct output: a non-empty JSON summary "No material changes detected". Do not return an empty summary. Do not say that document versions differ or to review the detected changes.`;

export const COMPARE_SUMMARY_SYSTEM_PROMPT = [
  "Summarize substantive document version differences for a lawyer. Return JSON only: {summary:string}. Use the detected-change list as the only source of what changed. Report material changes (term, fees, percentages, indemnity, notice periods, warranties, assignment, insurance). Do not treat spelling, typo corrections, section renumbering, exhibit numbering, or whitespace reformats as material even if they appear in the detected-change list. Do not invent clauses, parties, or changes absent from the digest.",
  COMPARE_MIXED_WORKED_EXAMPLE,
  COMPARE_ISOLATED_DECOY_WORKED_EXAMPLE,
].join(" ");

export type LiveContractCompareKind = "material" | "empty" | "decoy" | "mixed";

export type LiveContractCompareScenario = {
  id: string;
  description: string;
  titleA: string;
  titleB: string;
  original: string;
  redline: string;
  kind: LiveContractCompareKind;
  /** True when this pair is a number-words vs digits check (60 / sixty, 15% / fifteen). */
  numericPhrasing?: boolean;
  /** Planted material needles the summary must report (mixed + optional material isolates). */
  materialNeedles?: string[];
  /** Near-miss needles the summary must not treat as material. */
  decoyNeedles?: string[];
};

const ORIGINAL_PARAS = GOLDEN_CONTRACT_ORIGINAL.split("\n\n");
const REDLINE_PARAS = GOLDEN_CONTRACT_REDLINE.split("\n\n");

function swapParagraphs(indexes: number[]): { original: string; redline: string } {
  const orig = [...ORIGINAL_PARAS];
  const red = [...ORIGINAL_PARAS];
  for (const index of indexes) {
    red[index] = REDLINE_PARAS[index]!;
  }
  return { original: orig.join("\n\n"), redline: red.join("\n\n") };
}

function isolated(
  id: string,
  description: string,
  index: number,
  kind: Exclude<LiveContractCompareKind, "mixed" | "empty">,
  extras?: {
    numericPhrasing?: boolean;
    materialNeedles?: string[];
    decoyNeedles?: string[];
  },
): LiveContractCompareScenario {
  const pair = swapParagraphs([index]);
  return {
    id,
    description,
    titleA: "SYNTH — Isolated original",
    titleB: "SYNTH — Isolated redline",
    ...pair,
    kind,
    numericPhrasing: extras?.numericPhrasing,
    materialNeedles: extras?.materialNeedles,
    decoyNeedles: extras?.decoyNeedles,
  };
}

function mixedPair(
  id: string,
  description: string,
  materialIndex: number,
  decoyIndex: number,
  extras: {
    materialNeedles: string[];
    decoyNeedles: string[];
    numericPhrasing?: boolean;
  },
): LiveContractCompareScenario {
  const pair = swapParagraphs([materialIndex, decoyIndex]);
  return {
    id,
    description,
    titleA: "SYNTH — Mixed original",
    titleB: "SYNTH — Mixed redline",
    ...pair,
    kind: "mixed",
    numericPhrasing: extras.numericPhrasing,
    materialNeedles: extras.materialNeedles,
    decoyNeedles: extras.decoyNeedles,
  };
}

export const LIVE_CONTRACT_COMPARE_SCENARIOS: LiveContractCompareScenario[] = [
  {
    id: "cc-live-golden-pair-summary",
    description: "Full golden MSA pair — all planted material changes",
    titleA: "SYNTH — MSA Original",
    titleB: "SYNTH — MSA Redline",
    original: GOLDEN_CONTRACT_ORIGINAL,
    redline: GOLDEN_CONTRACT_REDLINE,
    kind: "material",
    materialNeedles: ["2027", "4,500", "fifteen", "negligence", "sixty", "as is", "reasonable consent", "2,000,000"],
  },
  {
    id: "cc-live-empty-no-invent",
    description: "Identical texts — must not invent differences",
    titleA: "SYNTH — Identical A",
    titleB: "SYNTH — Identical B",
    original: "The parties agree to cooperate on scheduling.",
    redline: "The parties agree to cooperate on scheduling.",
    kind: "empty",
  },
  isolated("cc-live-material-term", "Planted: expiration 2026 → 2027", 2, "material", {
    materialNeedles: ["2027"],
  }),
  isolated("cc-live-material-fee", "Planted numeric: $4,000 → $4,500 / four thousand five hundred", 3, "material", {
    numericPhrasing: true,
    materialNeedles: ["4,500"],
  }),
  isolated("cc-live-material-percent", "Planted numeric: 12% → fifteen percent (15%)", 4, "material", {
    numericPhrasing: true,
    materialNeedles: ["fifteen", "15"],
  }),
  isolated("cc-live-material-indemnity", "Planted: unlimited indemnity → Vendor negligence only", 5, "material", {
    materialNeedles: ["negligence"],
  }),
  isolated("cc-live-material-notice", "Planted numeric: thirty (30) days → sixty (60) days", 6, "material", {
    numericPhrasing: true,
    materialNeedles: ["sixty", "60"],
  }),
  isolated("cc-live-material-as-is", "Planted: quiet enjoyment → as is", 7, "material", {
    materialNeedles: ["as is"],
  }),
  isolated("cc-live-material-assignment", "Planted: sole discretion → reasonable consent", 8, "material", {
    materialNeedles: ["reasonable consent"],
  }),
  isolated("cc-live-material-insurance", "Planted numeric: $1,000,000 → $2,000,000", 9, "material", {
    numericPhrasing: true,
    materialNeedles: ["2,000,000"],
  }),
  isolated("cc-live-decoy-labelled", "Decoy: labelled → labeled (spelling)", 11, "decoy", {
    decoyNeedles: ["labelled", "labeled", "Recitals"],
  }),
  isolated("cc-live-decoy-agrement", "Decoy: agrement typo fix", 13, "decoy", {
    decoyNeedles: ["agrement"],
  }),
  isolated("cc-live-decoy-section-16", "Decoy: Section 16 → 16.0 renumber", 14, "decoy", {
    decoyNeedles: ["16.0"],
  }),
  isolated("cc-live-decoy-recieve", "Decoy: recieve typo fix", 15, "decoy", {
    decoyNeedles: ["recieve"],
  }),
  isolated("cc-live-decoy-reformat-govlaw", "Decoy: governing-law paragraph reformat", 16, "decoy", {
    decoyNeedles: ["conflicts principles"],
  }),
  isolated("cc-live-decoy-exhibit", "Decoy: Exhibit 1 → Exhibit I numbering", 17, "decoy", {
    decoyNeedles: ["Exhibit I", "Exhibit 1"],
  }),
  mixedPair(
    "cc-live-mixed-term-labelled",
    "Material term 2026→2027 plus labelled/labeled spelling decoy in the same pair",
    2,
    11,
    { materialNeedles: ["2027"], decoyNeedles: ["labelled", "labeled", "Recitals"] },
  ),
  mixedPair(
    "cc-live-mixed-fee-agrement",
    "Material fee $4,000→$4,500 plus agrement typo decoy in the same pair",
    3,
    13,
    { materialNeedles: ["4,500"], decoyNeedles: ["agrement"], numericPhrasing: true },
  ),
  mixedPair(
    "cc-live-mixed-notice-section-16",
    "Material thirty→sixty days plus Section 16.0 renumber decoy in the same pair",
    6,
    14,
    { materialNeedles: ["sixty", "60"], decoyNeedles: ["16.0"], numericPhrasing: true },
  ),
  mixedPair(
    "cc-live-mixed-indemnity-recieve",
    "Material indemnity cap plus recieve typo decoy in the same pair",
    5,
    15,
    { materialNeedles: ["negligence"], decoyNeedles: ["recieve"] },
  ),
  mixedPair(
    "cc-live-mixed-assignment-exhibit",
    "Material reasonable-consent assignment plus Exhibit I numbering decoy in the same pair",
    8,
    17,
    { materialNeedles: ["reasonable consent"], decoyNeedles: ["Exhibit I", "Exhibit 1"] },
  ),
  mixedPair(
    "cc-live-mixed-insurance-govlaw",
    "Material insurance $1M→$2M plus governing-law reformat decoy in the same pair",
    9,
    16,
    {
      materialNeedles: ["2,000,000"],
      decoyNeedles: ["conflicts principles"],
      numericPhrasing: true,
    },
  ),
];
