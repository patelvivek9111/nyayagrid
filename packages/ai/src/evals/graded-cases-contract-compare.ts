/**
 * Contract-compare graded cases (CC-01 through CC-05). Minimum 20.
 *
 * Deterministic diffs and summary scoring run in @nyayagrid/intelligence evals.
 * Goal-routing and schema cases run from the shared eval runner.
 */
import { CLOSEST_MATCH_LIMITATION, wantsContractCompare } from "../contract-compare-intent";
import { contractAnalysisItemSchema } from "../professional";
import {
  DECOY_NEEDLES,
  GOLDEN_CONTRACT_ORIGINAL,
  GOLDEN_CONTRACT_REDLINE,
  GOLDEN_CONTRACT_PAIR_ID,
  PLANTED_MATERIAL_NEEDLES,
} from "./golden-contract-pair";

export type ContractCompareCriterion = "CC-01" | "CC-02" | "CC-03" | "CC-04" | "CC-05";

export type ContractCompareCaseKind =
  | "diff_identity"
  | "diff_material"
  | "diff_decoy"
  | "diff_empty"
  | "summary_aligned"
  | "summary_invents"
  | "summary_empty_diff_invents"
  | "schema_source_required"
  | "goal_routing"
  | "multi_doc_limitation";

export type ContractCompareCase = {
  id: string;
  description: string;
  criterion: ContractCompareCriterion;
  kind: ContractCompareCaseKind;
  adversarial?: boolean;
  trapKind?: "decoy";
  original?: string;
  redline?: string;
  summary?: string;
  mustDetectNeedles?: string[];
  decoyNeedles?: string[];
  goal?: string;
  expectCompareGoal?: boolean;
  expectedLimitationNeedle?: string;
};

export const CONTRACT_COMPARE_CASES: ContractCompareCase[] = [
  {
    id: "cc-identity-repeat",
    description: "CC-01: same original+redline must produce identical diffs",
    criterion: "CC-01",
    kind: "diff_identity",
    original: GOLDEN_CONTRACT_ORIGINAL,
    redline: GOLDEN_CONTRACT_REDLINE,
  },
  {
    id: "cc-empty-equal",
    description: "CC-01: identical texts yield zero diffs",
    criterion: "CC-01",
    kind: "diff_empty",
    original: "The parties agree to cooperate on scheduling.",
    redline: "The parties agree to cooperate on scheduling.",
  },
  ...PLANTED_MATERIAL_NEEDLES.map((needle, i) => ({
    id: `cc-material-${i + 1}`,
    description: `Planted material change must appear in the diff: ${needle}`,
    criterion: "CC-01" as const,
    kind: "diff_material" as const,
    original: GOLDEN_CONTRACT_ORIGINAL,
    redline: GOLDEN_CONTRACT_REDLINE,
    mustDetectNeedles: [needle],
  })),
  {
    id: "cc-all-material",
    description: "All 8 planted material changes present in one diff",
    criterion: "CC-01",
    kind: "diff_material",
    original: GOLDEN_CONTRACT_ORIGINAL,
    redline: GOLDEN_CONTRACT_REDLINE,
    mustDetectNeedles: [...PLANTED_MATERIAL_NEEDLES],
  },
  {
    id: "cc-decoy-spelling-labelled",
    description: "Decoy: labelled/labeled spelling is not high-attention material",
    criterion: "CC-03",
    kind: "diff_decoy",
    original: GOLDEN_CONTRACT_ORIGINAL,
    redline: GOLDEN_CONTRACT_REDLINE,
    decoyNeedles: ["labelled", "labeled"],
    trapKind: "decoy",
  },
  {
    id: "cc-decoy-typo-agrement",
    description: "Decoy: typo fix agrement→agreement is not a material clause change",
    criterion: "CC-03",
    kind: "diff_decoy",
    original: GOLDEN_CONTRACT_ORIGINAL,
    redline: GOLDEN_CONTRACT_REDLINE,
    decoyNeedles: ["agrement"],
    trapKind: "decoy",
  },
  {
    id: "cc-decoy-identical-parties",
    description: "Decoy: unchanged parties paragraph must not be treated as a change",
    criterion: "CC-03",
    kind: "diff_decoy",
    original: GOLDEN_CONTRACT_ORIGINAL,
    redline: GOLDEN_CONTRACT_REDLINE,
    decoyNeedles: ["Acme Corp and Beta LLC"],
    trapKind: "decoy",
  },
  {
    id: "cc-decoy-notices-unchanged",
    description: "Decoy: notices paragraph is identical and must not appear as a change",
    criterion: "CC-03",
    kind: "diff_decoy",
    original: GOLDEN_CONTRACT_ORIGINAL,
    redline: GOLDEN_CONTRACT_REDLINE,
    decoyNeedles: ["address listed on the cover page"],
    trapKind: "decoy",
  },
  {
    id: "cc-summary-aligned",
    description: "CC-03: summary that tracks the digest is aligned",
    criterion: "CC-03",
    kind: "summary_aligned",
    original: GOLDEN_CONTRACT_ORIGINAL,
    redline: GOLDEN_CONTRACT_REDLINE,
    summary:
      "The expiration date changed to December 31, 2027, monthly fees changed to $4,500, the shared-cost allocation changed to fifteen percent, indemnity was limited to Vendor's negligence, termination notice became sixty (60) days, quiet enjoyment was replaced with as is, assignment now requires reasonable consent, and insurance increased to $2,000,000.",
  },
  {
    id: "cc-summary-invents-arbitration",
    description: "CC-03: summary must not invent an arbitration clause absent from the digest",
    criterion: "CC-03",
    kind: "summary_invents",
    original: GOLDEN_CONTRACT_ORIGINAL,
    redline: GOLDEN_CONTRACT_REDLINE,
    summary:
      "The redline added a mandatory arbitration clause in Delaware and a jury-trial waiver not present in either draft.",
  },
  {
    id: "cc-summary-empty-invents",
    description: "CC-03: empty-diff summary that invents indemnity is replaced / misaligned",
    criterion: "CC-03",
    kind: "summary_empty_diff_invents",
    original: "Same operative paragraph.",
    redline: "Same operative paragraph.",
    summary: "The amendment added a broad indemnity clause shifting all liability to Vendor.",
  },
  {
    id: "cc-goal-compare",
    description: "CC-02: compare/amendment language routes to compareDocuments",
    criterion: "CC-02",
    kind: "goal_routing",
    goal: "Compare the agreement and the amendment for material changes",
    expectCompareGoal: true,
  },
  {
    id: "cc-goal-ordinary-review",
    description: "CC-02: ordinary clause review must not look like a compare goal",
    criterion: "CC-02",
    kind: "goal_routing",
    goal: "Review the indemnification clause in the MSA",
    expectCompareGoal: false,
  },
  {
    id: "cc-schema-source-required",
    description: "CC-04: contract analysis items require sourceChunkIds",
    criterion: "CC-04",
    kind: "schema_source_required",
  },
  {
    id: "cc-multi-doc-limitation",
    description: "CC-05: multi-doc retrieval without explicit IDs discloses closest-match only",
    criterion: "CC-05",
    kind: "multi_doc_limitation",
    expectedLimitationNeedle: "closest match only",
  },
  {
    id: "cc-adv-decoy-reads-material",
    description:
      "Adversarial: labelled/labeled decoy reads like a clause edit but is not material",
    criterion: "CC-03",
    kind: "diff_decoy",
    adversarial: true,
    trapKind: "decoy",
    original: GOLDEN_CONTRACT_ORIGINAL,
    redline: GOLDEN_CONTRACT_REDLINE,
    decoyNeedles: ["labelled", "labeled"],
  },
  {
    id: "cc-decoy-renumber-section-16",
    description: "Decoy: Section 16 → 16.0 renumbering is not a material clause change",
    criterion: "CC-03",
    kind: "diff_decoy",
    adversarial: true,
    trapKind: "decoy",
    original: GOLDEN_CONTRACT_ORIGINAL,
    redline: GOLDEN_CONTRACT_REDLINE,
    decoyNeedles: ["Section 16"],
  },
  {
    id: "cc-decoy-typo-recieve",
    description: "Decoy: recieve → receive typo fix is not a material clause change",
    criterion: "CC-03",
    kind: "diff_decoy",
    adversarial: true,
    trapKind: "decoy",
    original: GOLDEN_CONTRACT_ORIGINAL,
    redline: GOLDEN_CONTRACT_REDLINE,
    decoyNeedles: ["recieve", "receive"],
  },
  {
    id: "cc-decoy-reformat-governing-law",
    description: "Decoy: reformatted governing-law paragraph (whitespace only) is not material",
    criterion: "CC-03",
    kind: "diff_decoy",
    adversarial: true,
    trapKind: "decoy",
    original: GOLDEN_CONTRACT_ORIGINAL,
    redline: GOLDEN_CONTRACT_REDLINE,
    decoyNeedles: ["without regard to conflicts principles"],
  },
  {
    id: "cc-decoy-exhibit-numbering",
    description: "Decoy: Exhibit 1 → Exhibit I numbering style is not a material clause change",
    criterion: "CC-03",
    kind: "diff_decoy",
    adversarial: true,
    trapKind: "decoy",
    original: GOLDEN_CONTRACT_ORIGINAL,
    redline: GOLDEN_CONTRACT_REDLINE,
    decoyNeedles: ["Exhibit 1", "Exhibit I"],
  },
  {
    id: "cc-material-duration-days",
    description: "Duration 45 days → 30 days must appear as a structured change",
    criterion: "CC-01",
    kind: "diff_material",
    original: "4. Notice\nFormal notice requires 45 days.",
    redline: "4. Notice\nFormal notice requires 30 days.",
    mustDetectNeedles: ["45 days", "30 days"],
  },
  {
    id: "cc-material-money-cap",
    description: "Liability cap $255,000 → $510,000 must appear as a structured change",
    criterion: "CC-01",
    kind: "diff_material",
    original: "9. Liability\nAggregate contractual liability will not exceed $255,000.",
    redline: "9. Liability\nAggregate contractual liability will not exceed $510,000.",
    mustDetectNeedles: ["$255,000", "$510,000"],
  },
  {
    id: "cc-decoy-isolated-typo",
    description: "Isolated recieve → receive correction is not high-attention",
    criterion: "CC-03",
    kind: "diff_decoy",
    trapKind: "decoy",
    original: "Notices may recieve electronic copies as a courtesy.",
    redline: "Notices may receive electronic copies as a courtesy.",
    decoyNeedles: ["recieve", "receive"],
  },
  {
    id: "cc-decoy-isolated-exhibit",
    description: "Isolated Exhibit A → Exhibit B renumbering is not high-attention",
    criterion: "CC-03",
    kind: "diff_decoy",
    trapKind: "decoy",
    original: "Performance is described in Exhibit A.",
    redline: "Performance is described in Exhibit B.",
    decoyNeedles: ["Exhibit A", "Exhibit B"],
  },
];

export {
  CLOSEST_MATCH_LIMITATION,
  DECOY_NEEDLES,
  GOLDEN_CONTRACT_ORIGINAL,
  GOLDEN_CONTRACT_PAIR_ID,
  GOLDEN_CONTRACT_REDLINE,
  PLANTED_MATERIAL_NEEDLES,
  wantsContractCompare,
  contractAnalysisItemSchema,
};
