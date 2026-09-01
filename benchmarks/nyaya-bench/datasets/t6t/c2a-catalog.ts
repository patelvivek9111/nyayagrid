/**
 * Hidden C2A catalog. Built from corpus bundles, not production branches.
 * Queries do not inject authority IDs into Research/Ask/Draft.
 */
import { listUsStates } from "@nyayagrid/jurisdiction";
import {
  loadInitialBatchAuthorities,
  type CorpusBundleAuthority,
} from "@nyayagrid/research";

export const C2A_STATE_ORDER = [
  "PA",
  "NJ",
  "NY",
  "DE",
  "CA",
  "TX",
  "FL",
  "IL",
  "MA",
  "VA",
] as const;

export type C2AStateCode = (typeof C2A_STATE_ORDER)[number];

export const C2A_PRACTICE_AREAS = ["Contract", "Employment", "Civil", "Criminal"] as const;
export type C2APracticeArea = (typeof C2A_PRACTICE_AREAS)[number];

export type C2AAuthorityProfile = {
  sourceExternalId: string;
  citation: string;
  title: string;
  shortTitle: string;
  authorityType: "statute" | "case";
  authorityState: string;
  court: string | null;
  courtId: string | null;
  content: string;
  holdingPhrase: string;
  canonicalSourceUrl: string | null;
  practiceAreas: string[];
  statuteTopic: string | null;
};

export type C2AStateProfile = {
  code: C2AStateCode;
  name: string;
  ucc: C2AAuthorityProfile;
  wage: C2AAuthorityProfile;
  highCourt: C2AAuthorityProfile;
  decoyState: C2AStateCode;
};

export type C2ATaskKind =
  | "contract-statute"
  | "employment-statute"
  | "high-court-case"
  | "wrong-state-statute"
  | "wrong-state-case"
  | "hierarchy"
  | "labeling"
  | "citation"
  | "grounding"
  | "abstention"
  | "temporal-current-law"
  | "excerpt-limit";

function stateName(code: string): string {
  return listUsStates().find((row) => row.code === code)?.name ?? code;
}

function isUcc(entry: CorpusBundleAuthority): boolean {
  const citation = `${entry.citation ?? ""} ${entry.sourceExternalId}`;
  return /2[-.]?725|2725|672\.725|8\.2-725/i.test(citation);
}

function distinctivePhrase(text: string): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  const withoutCite = cleaned.replace(/^[^.]{0,80}\.\s*/, "");
  const sentences = withoutCite.split(/(?<=[.!?])\s+/).filter((s) => s.split(" ").length >= 8);
  const candidate = sentences[0] ?? withoutCite;
  return candidate.split(" ").filter(Boolean).slice(0, 14).join(" ");
}

function asProfile(entry: CorpusBundleAuthority, fallbackType: "statute" | "case"): C2AAuthorityProfile {
  const majority = entry.opinionParts?.find((part) => part.part === "majority")?.content;
  const content = entry.content ?? majority ?? "";
  const topic =
    typeof entry.sourceMetadata?.statuteTopic === "string" ? entry.sourceMetadata.statuteTopic : null;
  return {
    sourceExternalId: entry.sourceExternalId,
    citation: entry.citation ?? entry.title,
    title: entry.title,
    shortTitle: entry.shortTitle ?? entry.title,
    authorityType: entry.authorityType === "case" ? "case" : fallbackType,
    authorityState: entry.authorityState ?? "",
    court: entry.court ?? null,
    courtId: entry.courtId ?? null,
    content,
    holdingPhrase: distinctivePhrase(majority ?? content),
    canonicalSourceUrl: entry.canonicalSourceUrl ?? null,
    practiceAreas: entry.bundlePracticeAreas ?? [],
    statuteTopic: topic,
  };
}

function wageQuery(profile: C2AStateProfile): string {
  const topic = profile.wage.statuteTopic ?? "";
  if (topic.includes("wage_payment")) {
    return `Under ${profile.name} law, how often must an employer pay wages due to employees?`;
  }
  if (topic.includes("overtime") || /510/.test(profile.wage.citation)) {
    return `What does ${profile.name} labor law require regarding a day's work and overtime?`;
  }
  return `Does ${profile.name} require employers to pay employees wages that are not less than the statutory minimum wage?`;
}

export async function loadC2AStateProfiles(): Promise<C2AStateProfile[]> {
  const { authorities } = await loadInitialBatchAuthorities();
  const byState = new Map<string, CorpusBundleAuthority[]>();
  for (const entry of authorities) {
    const code = entry.authorityState;
    if (!code) continue;
    const list = byState.get(code) ?? [];
    list.push(entry);
    byState.set(code, list);
  }

  const decoyOf: Record<C2AStateCode, C2AStateCode> = {
    PA: "NJ",
    NJ: "PA",
    NY: "NJ",
    DE: "PA",
    CA: "NY",
    TX: "CA",
    FL: "TX",
    IL: "NY",
    MA: "PA",
    VA: "NY",
  };

  return C2A_STATE_ORDER.map((code) => {
    const rows = byState.get(code) ?? [];
    const ucc = rows.find((row) => row.authorityType === "statute" && isUcc(row));
    const wage = rows.find((row) => row.authorityType === "statute" && !isUcc(row));
    const highCourt = rows.find((row) => row.authorityType === "case");
    if (!ucc || !wage || !highCourt) {
      throw new Error(`C2A catalog missing UCC, wage, or case bundle for ${code}`);
    }
    return {
      code,
      name: stateName(code),
      ucc: asProfile(ucc, "statute"),
      wage: asProfile(wage, "statute"),
      highCourt: asProfile(highCourt, "case"),
      decoyState: decoyOf[code],
    };
  });
}

export type C2AResearchSpec = {
  id: string;
  state: C2AStateCode;
  kind: C2ATaskKind;
  practiceArea: C2APracticeArea;
  question: string;
  /** Grading only — never passed into retrieval filters as an id. */
  expectSourceExternalId: string | null;
  expectCitationContains: string | null;
  expectState: string;
  decoyState: string | null;
  expectTokens: string[];
  expectAbstention: boolean;
  expectUnknownTemporal: boolean;
  expectLimitation: boolean;
};

export function researchSpecsForState(profile: C2AStateProfile): C2AResearchSpec[] {
  const { code, name, ucc, wage, highCourt, decoyState } = profile;
  const uccQuestion = `Under ${name} law, within what period must an action for breach of a contract for the sale of goods be commenced?`;
  const caseQuestion = `What did the ${name} high court hold in ${highCourt.shortTitle}?`;
  return [
    {
      id: `T6T-C2A-${code}-01`,
      state: code,
      kind: "contract-statute",
      practiceArea: "Contract",
      question: uccQuestion,
      expectSourceExternalId: ucc.sourceExternalId,
      expectCitationContains: "725",
      expectState: code,
      decoyState,
      expectTokens: ["4 years"],
      expectAbstention: false,
      expectUnknownTemporal: true,
      expectLimitation: false,
    },
    {
      id: `T6T-C2A-${code}-02`,
      state: code,
      kind: "employment-statute",
      practiceArea: "Employment",
      question: wageQuery(profile),
      expectSourceExternalId: wage.sourceExternalId,
      expectCitationContains: wage.citation.replace(/^.*§\s*/, "").slice(0, 12),
      expectState: code,
      decoyState: null,
      expectTokens: wage.holdingPhrase.split(" ").slice(0, 6),
      expectAbstention: false,
      expectUnknownTemporal: true,
      expectLimitation: false,
    },
    {
      id: `T6T-C2A-${code}-03`,
      state: code,
      kind: "high-court-case",
      practiceArea: "Civil",
      question: caseQuestion,
      expectSourceExternalId: highCourt.sourceExternalId,
      expectCitationContains: highCourt.citation.split("(")[0]!.trim().slice(-12),
      expectState: code,
      decoyState,
      expectTokens: highCourt.holdingPhrase.split(" ").slice(0, 8),
      expectAbstention: false,
      expectUnknownTemporal: false,
      expectLimitation: false,
    },
    {
      id: `T6T-C2A-${code}-04`,
      state: code,
      kind: "wrong-state-statute",
      practiceArea: "Contract",
      question: uccQuestion,
      expectSourceExternalId: ucc.sourceExternalId,
      expectCitationContains: "725",
      expectState: code,
      decoyState,
      expectTokens: ["4 years"],
      expectAbstention: false,
      expectUnknownTemporal: false,
      expectLimitation: false,
    },
    {
      id: `T6T-C2A-${code}-05`,
      state: code,
      kind: "wrong-state-case",
      practiceArea: "Civil",
      question: caseQuestion,
      expectSourceExternalId: highCourt.sourceExternalId,
      expectCitationContains: highCourt.citation.split("(")[0]!.trim().slice(-12),
      expectState: code,
      decoyState,
      expectTokens: [],
      expectAbstention: false,
      expectUnknownTemporal: false,
      expectLimitation: false,
    },
    {
      id: `T6T-C2A-${code}-06`,
      state: code,
      kind: "hierarchy",
      practiceArea: "Civil",
      question: caseQuestion,
      expectSourceExternalId: highCourt.sourceExternalId,
      expectCitationContains: null,
      expectState: code,
      decoyState,
      expectTokens: [],
      expectAbstention: false,
      expectUnknownTemporal: false,
      expectLimitation: false,
    },
    {
      id: `T6T-C2A-${code}-07`,
      state: code,
      kind: "labeling",
      practiceArea: "Contract",
      question: uccQuestion,
      expectSourceExternalId: ucc.sourceExternalId,
      expectCitationContains: "725",
      expectState: code,
      decoyState,
      expectTokens: [],
      expectAbstention: false,
      expectUnknownTemporal: false,
      expectLimitation: false,
    },
    {
      id: `T6T-C2A-${code}-08`,
      state: code,
      kind: "citation",
      practiceArea: "Contract",
      question: uccQuestion,
      expectSourceExternalId: ucc.sourceExternalId,
      expectCitationContains: ucc.citation,
      expectState: code,
      decoyState: null,
      expectTokens: [],
      expectAbstention: false,
      expectUnknownTemporal: false,
      expectLimitation: false,
    },
    {
      id: `T6T-C2A-${code}-09`,
      state: code,
      kind: "grounding",
      practiceArea: "Contract",
      question: uccQuestion,
      expectSourceExternalId: ucc.sourceExternalId,
      expectCitationContains: "725",
      expectState: code,
      decoyState: null,
      expectTokens: ["4 years"],
      expectAbstention: false,
      expectUnknownTemporal: false,
      expectLimitation: false,
    },
    {
      id: `T6T-C2A-${code}-10`,
      state: code,
      kind: "abstention",
      practiceArea: "Civil",
      question: `What is the waiting period for a no-fault divorce in ${name}?`,
      expectSourceExternalId: null,
      expectCitationContains: null,
      expectState: code,
      decoyState: null,
      expectTokens: [],
      expectAbstention: true,
      expectUnknownTemporal: false,
      expectLimitation: true,
    },
    {
      id: `T6T-C2A-${code}-11`,
      state: code,
      kind: "temporal-current-law",
      practiceArea: "Contract",
      question: `Is ${ucc.citation} definitely the currently effective ${name} law as of today, with no temporal uncertainty?`,
      expectSourceExternalId: ucc.sourceExternalId,
      expectCitationContains: "725",
      expectState: code,
      decoyState: null,
      expectTokens: [],
      expectAbstention: false,
      expectUnknownTemporal: true,
      expectLimitation: true,
    },
    {
      id: `T6T-C2A-${code}-12`,
      state: code,
      kind: "excerpt-limit",
      practiceArea: "Civil",
      question: `In ${highCourt.shortTitle}, which justices dissented, what was the exact vote count, and what unpublished procedural history is not in the excerpt?`,
      expectSourceExternalId: highCourt.sourceExternalId,
      expectCitationContains: null,
      expectState: code,
      decoyState: null,
      expectTokens: [],
      expectAbstention: true,
      expectLimitation: true,
      expectUnknownTemporal: false,
    },
  ];
}

export const GOVERNING_LAW_QUESTION =
  "For a contract for the sale of goods, what statute of limitations applies as a matter of governing law?";

export const MULTI_JURISDICTION_QUESTION =
  "Identify the forum, the governing law for the contract-for-sale limitations issue, and any related jurisdiction, without flattening them.";
