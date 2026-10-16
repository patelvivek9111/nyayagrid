/**
 * Oct 19–25 Phase 3 — Conversational drafting + local research (deterministic).
 * Reuses matter record + authority working-state honesty. No CourtListener. No shared schema.
 */

export const DRAFT_FACTUALITY = [
  "FACT",
  "SUPPORTED_INFERENCE",
  "CONFLICT",
  "UNKNOWN",
  "UNSUPPORTED",
  "PARTY_ALLEGATION",
  "WITNESS_STATEMENT",
] as const;
export type DraftFactuality = (typeof DRAFT_FACTUALITY)[number];

export const DRAFT_TYPES = [
  "FACTUAL_BACKGROUND",
  "ARGUMENT_SECTION",
  "ISSUE_SECTION",
  "MOTION_SECTION",
  "RESEARCH_MEMO",
  "HEARING_OUTLINE_DERIVATIVE",
  "DEPOSITION_OUTLINE_DERIVATIVE",
  "INTERNAL_CASE_ANALYSIS",
] as const;
export type ConversationalDraftType = (typeof DRAFT_TYPES)[number];

export const ASSERTION_SUPPORT = [
  "SUPPORTED",
  "PARTIALLY_SUPPORTED",
  "CONFLICTED",
  "UNSUPPORTED",
  "UNKNOWN",
] as const;
export type AssertionSupport = (typeof ASSERTION_SUPPORT)[number];

export type AuthorityInput = {
  id: string;
  label: string;
  resolution: string;
  treatmentVerified: boolean;
  hasFullText?: boolean;
  propositionHints?: string[];
  limitationHints?: string[];
  stance?: "supporting" | "contrary" | "distinguishable" | "unknown";
  jurisdictionHint?: string | null;
};

export type IssueInput = {
  id: string;
  label: string;
  kind?: "claim" | "defense" | "motion" | "hearing" | "deposition" | "other";
  supportStatus?: string | null;
  description?: string | null;
};

export type FactInput = {
  id: string;
  text: string;
  factuality: DraftFactuality;
  sourceIds: string[];
  disputed?: boolean;
};

export type SourceRef = {
  kind: "claim" | "document" | "authority" | "communication" | "motion" | "hearing" | "deposition" | "draft" | "research";
  id: string;
  label: string;
};

export type DraftParagraph = {
  id: string;
  text: string;
  factuality: DraftFactuality;
  sources: SourceRef[];
  assertionSupport: AssertionSupport;
  authorityIds: string[];
};

export type ResearchResult = {
  posture: "RESOLVED" | "AMBIGUOUS" | "NO_ISSUE" | "NO_AUTHORITIES";
  researchQuestion: string;
  issue: { id: string | null; label: string };
  jurisdictionScope: string;
  authoritiesFound: Array<{
    id: string;
    label: string;
    resolution: string;
    treatmentStatus: "VERIFIED" | "NOT_VERIFIED";
    stance: "supporting" | "contrary" | "distinguishable" | "unknown";
    limitations: string[];
  }>;
  propositionsSupported: Array<{ text: string; authorityIds: string[]; sources: SourceRef[] }>;
  propositionsNotSupported: Array<{ text: string; reason: string }>;
  conflictingAuthorities: Array<{ a: string; b: string; note: string }>;
  authorityLimitations: Array<{ authorityId: string; limitation: string }>;
  researchGaps: Array<{
    whatIsMissing: string;
    whyItMatters: string;
    relatedIssue: string | null;
    sourceBasis: SourceRef[];
  }>;
  matterImpact: string[];
  investigateNext: Array<{
    whatIsMissing: string;
    whyItMatters: string;
    relatedDraftOrIssue: string | null;
    sourceBasis: SourceRef[];
  }>;
  sourceMap: SourceRef[];
  limitations: string[];
};

export type DraftResult = {
  posture: "RESOLVED" | "AMBIGUOUS" | "NO_TARGET" | "UNSAFE_PREMISE";
  draftType: ConversationalDraftType;
  draftId: string | null;
  title: string;
  paragraphs: DraftParagraph[];
  previewText: string;
  unsupportedRemoved: string[];
  changedAssertions: string[];
  researchArtifactId: string | null;
  hearingContinuity: boolean;
  depositionContinuity: boolean;
  sourceMap: SourceRef[];
  limitations: string[];
  premiseChallenge: string | null;
};

const FABRICATE_CITE =
  /\b(fabricate|invent|make up)\b.+\b(citation|authority|case|quote)\b|\binvent a citation\b|\bhide (the )?contrary\b/i;
const OVERSTATE =
  /\b(make (it |this )?(stronger|more persuasive|more confident)|sound more confident)\b/i;
const HIDE_CONTRARY = /\b(hide|omit|ignore|remove)\b.+\b(contrary|adverse)\b.+\b(authority|case)\b/i;

export function isResearchWorkflowQuestion(question: string): boolean {
  const q = question.trim();
  return (
    /\b(what law|what authorit|research whether|research the|find (the )?(strongest )?authorit|which (cases|authorities) (actually )?support|authorities? (already )?in (our|the) matter|what authorities? are missing|compare these authorities|binding\??|treatment)\b/i.test(
      q,
    ) ||
    /\bresearch\b.+\b(issue|notice|causation|proposition|paragraph|gap)\b/i.test(q) ||
    /\bwhat authority do we have for\b/i.test(q) ||
    /\bresearch the unsupported\b/i.test(q)
  );
}

export function isConversationalDraftQuestion(question: string): boolean {
  const q = question.trim();
  return (
    /\b(draft|rewrite|turn .+ into (an? )?(argument|factual|draft|section|memo))\b/i.test(q) ||
    /\b(factual background|argument section|issue section|research memo)\b/i.test(q) ||
    /\b(remove anything (we can.?t|that isn.?t) support|only use (facts|binding|emails|documents))\b/i.test(
      q,
    ) ||
    /\brewrite paragraph\s*\d+\b/i.test(q) ||
    OVERSTATE.test(q) ||
    FABRICATE_CITE.test(q) ||
    HIDE_CONTRARY.test(q) ||
    /\bmake (it |this )?shorter\b/i.test(q)
  );
}

export function isResearchToDraftRequest(question: string): boolean {
  return /\bturn (that |this |the )?research into\b|\bturn .+ research .+ into (an? )?(argument|draft|section)\b/i.test(
    question,
  );
}

export function isDraftToResearchRequest(question: string): boolean {
  return (
    /\bwhat authority do we have for paragraph\b/i.test(question) ||
    /\bresearch the unsupported\b/i.test(question) ||
    /\bresearch .+ (statement|paragraph|section)\b/i.test(question)
  );
}

export function isSourceOnlyRevision(question: string): boolean {
  return /\bremove anything (we can.?t|that isn.?t) support|only use facts supported by documents|only use (the )?emails?\b/i.test(
    question,
  );
}

export function isAuthorityOnlyRevision(question: string): boolean {
  return /\bonly use binding authority|remove authorities with unverified treatment|separate binding from persuasive\b/i.test(
    question,
  );
}

export function extractParagraphNumber(question: string): number | null {
  const m = question.match(/\bparagraph\s+(\d+)\b/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function detectDraftType(question: string): ConversationalDraftType {
  if (/hearing (prep|outline)/i.test(question)) return "HEARING_OUTLINE_DERIVATIVE";
  if (/deposition (prep|outline|admission)/i.test(question)) return "DEPOSITION_OUTLINE_DERIVATIVE";
  if (/factual background|statement of facts|factual (section|paragraph)/i.test(question)) {
    return "FACTUAL_BACKGROUND";
  }
  if (/research memo/i.test(question)) return "RESEARCH_MEMO";
  if (/issue section/i.test(question)) return "ISSUE_SECTION";
  if (/motion section|motion to/i.test(question)) return "MOTION_SECTION";
  if (/internal (case )?analysis/i.test(question)) return "INTERNAL_CASE_ANALYSIS";
  if (/argument/i.test(question)) return "ARGUMENT_SECTION";
  return "ARGUMENT_SECTION";
}

export function draftResearchForceDomains(): Array<
  "CLAIMS" | "EVIDENCE" | "AUTHORITIES" | "RESEARCH" | "DRAFT" | "MOTIONS" | "COMMUNICATIONS"
> {
  return ["CLAIMS", "EVIDENCE", "AUTHORITIES", "RESEARCH", "DRAFT", "MOTIONS", "COMMUNICATIONS"];
}

export function selectResearchIssue(params: {
  question: string;
  issues: IssueInput[];
  resolvedIssueId?: string | null;
  ambiguousIssueIds?: string[];
}): { issue: IssueInput | null; ambiguous: IssueInput[]; posture: ResearchResult["posture"] } {
  if (params.ambiguousIssueIds && params.ambiguousIssueIds.length > 1) {
    return {
      issue: null,
      ambiguous: params.issues.filter((i) => params.ambiguousIssueIds!.includes(i.id)),
      posture: "AMBIGUOUS",
    };
  }
  if (params.resolvedIssueId) {
    const hit = params.issues.find((i) => i.id === params.resolvedIssueId) ?? null;
    return { issue: hit, ambiguous: [], posture: hit ? "RESOLVED" : "NO_ISSUE" };
  }
  const q = params.question.toLowerCase();
  const named = params.issues.filter((i) => {
    const label = i.label.toLowerCase();
    return q.includes(label) || label.split(/\s+/).some((t) => t.length > 3 && q.includes(t));
  });
  if (named.length === 1) return { issue: named[0]!, ambiguous: [], posture: "RESOLVED" };
  if (named.length > 1) return { issue: null, ambiguous: named, posture: "AMBIGUOUS" };
  if (params.issues.length === 1) return { issue: params.issues[0]!, ambiguous: [], posture: "RESOLVED" };
  if (params.issues.length > 1) return { issue: null, ambiguous: params.issues, posture: "AMBIGUOUS" };
  return { issue: null, ambiguous: [], posture: "NO_ISSUE" };
}

function treatmentStatus(a: AuthorityInput): "VERIFIED" | "NOT_VERIFIED" {
  return a.treatmentVerified === true ? "VERIFIED" : "NOT_VERIFIED";
}

function mapStance(a: AuthorityInput, issueLabel: string): AuthorityInput["stance"] {
  if (a.stance) return a.stance;
  const blob = `${a.label} ${(a.propositionHints ?? []).join(" ")}`.toLowerCase();
  const issue = issueLabel.toLowerCase();
  if (a.propositionHints?.some((h) => /contrary|against|reject/i.test(h))) return "contrary";
  if (issue && blob.includes(issue.split(/\s+/)[0] ?? "")) return "supporting";
  return "unknown";
}

export function buildMatterResearchResult(params: {
  question: string;
  matterId: string;
  issues: IssueInput[];
  authorities: AuthorityInput[];
  facts?: FactInput[];
  resolvedIssueId?: string | null;
  ambiguousIssueIds?: string[];
  jurisdictionHint?: string | null;
}): ResearchResult {
  const limitations = [
    "Research evaluates the local matter authority corpus only — no CourtListener calls.",
    "Treatment is VERIFIED only when treatmentVerified=true on the record; otherwise NOT VERIFIED.",
    "Do not invent governing law, citations, or binding status from case fame alone.",
  ];
  const selected = selectResearchIssue({
    question: params.question,
    issues: params.issues,
    resolvedIssueId: params.resolvedIssueId,
    ambiguousIssueIds: params.ambiguousIssueIds,
  });

  if (selected.posture === "AMBIGUOUS") {
    return {
      posture: "AMBIGUOUS",
      researchQuestion: params.question,
      issue: { id: null, label: "Ambiguous research issue" },
      jurisdictionScope: params.jurisdictionHint ?? "UNKNOWN — matter jurisdiction not verified for this turn",
      authoritiesFound: [],
      propositionsSupported: [],
      propositionsNotSupported: [],
      conflictingAuthorities: [],
      authorityLimitations: [],
      researchGaps: [
        {
          whatIsMissing: "Clear research issue selection",
          whyItMatters: "Research must not invent an issue that differs from user intent.",
          relatedIssue: null,
          sourceBasis: selected.ambiguous.map((i) => ({
            kind: "claim" as const,
            id: i.id,
            label: i.label,
          })),
        },
      ],
      matterImpact: [],
      investigateNext: [],
      sourceMap: selected.ambiguous.map((i) => ({ kind: "claim" as const, id: i.id, label: i.label })),
      limitations,
    };
  }

  if (selected.posture === "NO_ISSUE" || !selected.issue) {
    return {
      posture: "NO_ISSUE",
      researchQuestion: params.question,
      issue: { id: null, label: "No issue resolved" },
      jurisdictionScope: params.jurisdictionHint ?? "UNKNOWN",
      authoritiesFound: [],
      propositionsSupported: [],
      propositionsNotSupported: [
        { text: params.question, reason: "No bound matter issue for research." },
      ],
      conflictingAuthorities: [],
      authorityLimitations: [],
      researchGaps: [
        {
          whatIsMissing: "Matter issue / claim / motion focus",
          whyItMatters: "Without an issue, authority search cannot be proposition-mapped.",
          relatedIssue: null,
          sourceBasis: [],
        },
      ],
      matterImpact: [],
      investigateNext: [],
      sourceMap: [],
      limitations,
    };
  }

  const issue = selected.issue;
  const authorities = params.authorities.slice(0, 40);
  if (authorities.length === 0) {
    return {
      posture: "NO_AUTHORITIES",
      researchQuestion: `Whether the record supports legal propositions regarding ${issue.label}`,
      issue: { id: issue.id, label: issue.label },
      jurisdictionScope: params.jurisdictionHint ?? "UNKNOWN",
      authoritiesFound: [],
      propositionsSupported: [],
      propositionsNotSupported: [
        {
          text: `Legal support for ${issue.label}`,
          reason: "No authorities available in the current matter/local corpus context.",
        },
      ],
      conflictingAuthorities: [],
      authorityLimitations: [],
      researchGaps: [
        {
          whatIsMissing: "Authorities for issue",
          whyItMatters: "Argument drafting should not invent authorities.",
          relatedIssue: issue.label,
          sourceBasis: [{ kind: "claim", id: issue.id, label: issue.label }],
        },
      ],
      matterImpact: [`Issue ${issue.label} lacks local authority support on this turn.`],
      investigateNext: [
        {
          whatIsMissing: "Authority corpus entries linked to this issue",
          whyItMatters: "Needed before asserting legal propositions in drafts.",
          relatedDraftOrIssue: issue.label,
          sourceBasis: [{ kind: "claim", id: issue.id, label: issue.label }],
        },
      ],
      sourceMap: [{ kind: "claim", id: issue.id, label: issue.label }],
      limitations,
    };
  }

  const found = authorities.map((a) => {
    const stance = mapStance(a, issue.label) ?? "unknown";
    const lims: string[] = [...(a.limitationHints ?? [])];
    if (a.resolution === "IDENTITY_UNRESOLVED") {
      lims.push("Identity unresolved — metadata incomplete.");
    }
    if (a.resolution !== "CORPUS_COMPLETE" && a.hasFullText !== true) {
      lims.push("Full text / corpus-complete state not established.");
    }
    if (!a.treatmentVerified) lims.push("Treatment NOT VERIFIED.");
    if (!a.jurisdictionHint) lims.push("Binding status UNKNOWN — jurisdiction not established.");
    return {
      id: a.id,
      label: a.label,
      resolution: a.resolution,
      treatmentStatus: treatmentStatus(a),
      stance,
      limitations: lims.length ? lims : ["No additional limitations recorded."],
    };
  });

  const supporting = found.filter((a) => a.stance === "supporting");
  const contrary = found.filter((a) => a.stance === "contrary");
  const propositionsSupported = supporting.slice(0, 8).map((a) => ({
    text: `Record-linked authority may support analysis of ${issue.label} (see ${a.label}).`,
    authorityIds: [a.id],
    sources: [{ kind: "authority" as const, id: a.id, label: a.label }],
  }));

  const propositionsNotSupported: ResearchResult["propositionsNotSupported"] = [];
  if (/\benough\b|\bsufficient\b|\bprove\b/i.test(params.question) && supporting.length === 0) {
    propositionsNotSupported.push({
      text: `Sufficiency of proof on ${issue.label}`,
      reason: "No supporting authority mapped to this proposition in the local corpus context.",
    });
  }

  const conflictingAuthorities =
    supporting.length && contrary.length
      ? [
          {
            a: supporting[0]!.label,
            b: contrary[0]!.label,
            note: "Corpus contains authorities with differing stances; do not hide contrary authority.",
          },
        ]
      : [];

  const authorityLimitations = found.flatMap((a) =>
    a.limitations
      .filter((l) => !/No additional/.test(l))
      .map((limitation) => ({ authorityId: a.id, limitation })),
  );

  const researchGaps: ResearchResult["researchGaps"] = [];
  if (found.some((a) => a.treatmentStatus === "NOT_VERIFIED")) {
    researchGaps.push({
      whatIsMissing: "Verified treatment for one or more authorities",
      whyItMatters: "Drafts must not claim verified treatment without a source.",
      relatedIssue: issue.label,
      sourceBasis: found
        .filter((a) => a.treatmentStatus === "NOT_VERIFIED")
        .slice(0, 3)
        .map((a) => ({ kind: "authority" as const, id: a.id, label: a.label })),
    });
  }
  if (found.some((a) => /Binding status UNKNOWN/i.test(a.limitations.join(" ")))) {
    researchGaps.push({
      whatIsMissing: "Binding/persuasive classification",
      whyItMatters: "Cannot filter to binding-only without jurisdiction/court data.",
      relatedIssue: issue.label,
      sourceBasis: [{ kind: "claim", id: issue.id, label: issue.label }],
    });
  }

  const sourceMap: SourceRef[] = [
    { kind: "claim", id: issue.id, label: issue.label },
    ...found.map((a) => ({ kind: "authority" as const, id: a.id, label: a.label })),
  ];

  return {
    posture: "RESOLVED",
    researchQuestion: `Whether local authorities support propositions regarding ${issue.label}`,
    issue: { id: issue.id, label: issue.label },
    jurisdictionScope: params.jurisdictionHint ?? "UNKNOWN — use matter jurisdiction when verified",
    authoritiesFound: found,
    propositionsSupported,
    propositionsNotSupported,
    conflictingAuthorities,
    authorityLimitations,
    researchGaps,
    matterImpact: [
      supporting.length
        ? `${supporting.length} authority(ies) tentatively mapped as supporting ${issue.label}.`
        : `No supporting authority mapped for ${issue.label}.`,
      contrary.length ? `${contrary.length} contrary/adverse authority(ies) retained in view.` : "",
    ].filter(Boolean),
    investigateNext: researchGaps.map((g) => ({
      whatIsMissing: g.whatIsMissing,
      whyItMatters: g.whyItMatters,
      relatedDraftOrIssue: g.relatedIssue,
      sourceBasis: g.sourceBasis,
    })),
    sourceMap,
    limitations,
  };
}

function assertSupportForFact(f: FactInput): AssertionSupport {
  if (f.disputed || f.factuality === "CONFLICT") return "CONFLICTED";
  if (f.factuality === "FACT" && f.sourceIds.length) return "SUPPORTED";
  if (f.factuality === "SUPPORTED_INFERENCE") return "PARTIALLY_SUPPORTED";
  if (f.factuality === "UNSUPPORTED") return "UNSUPPORTED";
  if (f.factuality === "PARTY_ALLEGATION" || f.factuality === "WITNESS_STATEMENT") {
    return "PARTIALLY_SUPPORTED";
  }
  return "UNKNOWN";
}

function qualifyFactText(f: FactInput): string {
  if (f.disputed || f.factuality === "CONFLICT") {
    return `The accounts conflict regarding the following point; it remains unresolved: ${f.text}`;
  }
  if (f.factuality === "PARTY_ALLEGATION") {
    return `A party contends: ${f.text}`;
  }
  if (f.factuality === "WITNESS_STATEMENT") {
    return `A witness statement reflects: ${f.text}`;
  }
  if (f.factuality === "SUPPORTED_INFERENCE") {
    return `A supported inference from the record is that ${f.text}`;
  }
  if (f.factuality === "UNKNOWN" || f.factuality === "UNSUPPORTED") {
    return `The record does not currently establish: ${f.text}`;
  }
  return f.text;
}

export function buildMatterDraftResult(params: {
  question: string;
  matterId: string;
  draftType?: ConversationalDraftType;
  facts?: FactInput[];
  issues?: IssueInput[];
  authorities?: AuthorityInput[];
  research?: ResearchResult | null;
  hearingOutline?: string | null;
  depositionOutline?: string | null;
  resolvedDraftId?: string | null;
  researchArtifactId?: string | null;
}): DraftResult {
  const limitations = [
    "Draft evaluates the matter record; it does not advocate beyond source support.",
    "Persuasive tone must not upgrade inference→fact or hide conflicts/contrary authority.",
    "No fabricated quotations, citation metadata, authorities, or deadlines.",
    "No CourtListener calls were made for this draft.",
  ];

  if (FABRICATE_CITE.test(params.question) || HIDE_CONTRARY.test(params.question)) {
    return {
      posture: "UNSAFE_PREMISE",
      draftType: detectDraftType(params.question),
      draftId: null,
      title: "Unsafe drafting premise rejected",
      paragraphs: [],
      previewText:
        "DRAFT PREVIEW blocked: Nyaya will not fabricate citations/quotations or hide contrary authority. Provide a grounded drafting request.",
      unsupportedRemoved: [],
      changedAssertions: ["Rejected fabricate-citation / hide-contrary request"],
      researchArtifactId: params.researchArtifactId ?? null,
      hearingContinuity: false,
      depositionContinuity: false,
      sourceMap: [],
      limitations,
      premiseChallenge:
        "Drafting must evaluate the record. Fabricating authority/quotes or hiding contrary authority is not permitted.",
    };
  }

  const draftType = params.draftType ?? detectDraftType(params.question);
  const hearingContinuity =
    draftType === "HEARING_OUTLINE_DERIVATIVE" || Boolean(params.hearingOutline);
  const depositionContinuity =
    draftType === "DEPOSITION_OUTLINE_DERIVATIVE" || Boolean(params.depositionOutline);

  const paragraphs: DraftParagraph[] = [];
  const unsupportedRemoved: string[] = [];
  const changedAssertions: string[] = [];
  const sourceMap: SourceRef[] = [];

  if (hearingContinuity && params.hearingOutline) {
    paragraphs.push({
      id: "p-hearing",
      text: `Derived from hearing preparation (draft preview):\n${params.hearingOutline.slice(0, 4000)}`,
      factuality: "SUPPORTED_INFERENCE",
      sources: [{ kind: "hearing", id: "hearing-prep", label: "Hearing prep outline" }],
      assertionSupport: "PARTIALLY_SUPPORTED",
      authorityIds: [],
    });
    sourceMap.push({ kind: "hearing", id: "hearing-prep", label: "Hearing prep outline" });
  }

  if (depositionContinuity && params.depositionOutline) {
    paragraphs.push({
      id: "p-depo",
      text: `Derived from deposition preparation (draft preview):\n${params.depositionOutline.slice(0, 4000)}`,
      factuality: "WITNESS_STATEMENT",
      sources: [{ kind: "deposition", id: "deposition-prep", label: "Deposition prep outline" }],
      assertionSupport: "PARTIALLY_SUPPORTED",
      authorityIds: [],
    });
    sourceMap.push({ kind: "deposition", id: "deposition-prep", label: "Deposition prep outline" });
  }

  const facts = (params.facts ?? []).map((f) => ({
    ...f,
    sourceIds: f.sourceIds.filter((id) => !id.startsWith("foreign:")),
  }));
  for (const f of facts.slice(0, 20)) {
    const support = assertSupportForFact(f);
    if (support === "UNSUPPORTED") {
      unsupportedRemoved.push(f.text);
      changedAssertions.push(`Removed unsupported: ${f.text.slice(0, 120)}`);
      continue;
    }
    if (f.sourceIds.length === 0 && f.factuality === "FACT") {
      // Foreign/stripped sources — do not present as established FACT without matter sources.
      unsupportedRemoved.push(f.text);
      changedAssertions.push(`Rejected unscoped/foreign source for: ${f.text.slice(0, 100)}`);
      continue;
    }
    const text = qualifyFactText(f);
    if (text !== f.text) changedAssertions.push(`Qualified: ${f.text.slice(0, 80)}`);
    const sources = f.sourceIds.map((id) => ({
      kind: "document" as const,
      id,
      label: `Source ${id.slice(0, 8)}`,
    }));
    paragraphs.push({
      id: `p-${f.id}`,
      text,
      factuality: f.factuality,
      sources,
      assertionSupport: support,
      authorityIds: [],
    });
    sourceMap.push(...sources);
  }

  const research = params.research;
  if (research && (draftType === "ARGUMENT_SECTION" || draftType === "RESEARCH_MEMO" || isResearchToDraftRequest(params.question))) {
    for (const prop of research.propositionsSupported.slice(0, 6)) {
      paragraphs.push({
        id: `p-auth-${prop.authorityIds[0] ?? "x"}`,
        text: `${prop.text} Treatment remains ${
          research.authoritiesFound.find((a) => a.id === prop.authorityIds[0])?.treatmentStatus ??
          "NOT_VERIFIED"
        }.`,
        factuality: "SUPPORTED_INFERENCE",
        sources: prop.sources,
        assertionSupport: "PARTIALLY_SUPPORTED",
        authorityIds: prop.authorityIds,
      });
      sourceMap.push(...prop.sources);
    }
    for (const c of research.conflictingAuthorities) {
      paragraphs.push({
        id: `p-conflict-${paragraphs.length}`,
        text: `Contrary authority remains in view: ${c.a} vs ${c.b}. ${c.note}`,
        factuality: "CONFLICT",
        sources: [],
        assertionSupport: "CONFLICTED",
        authorityIds: [],
      });
    }
    for (const ns of research.propositionsNotSupported) {
      unsupportedRemoved.push(ns.text);
      changedAssertions.push(`Omitted unsupported proposition: ${ns.text}`);
    }
  }

  if (paragraphs.length === 0) {
    paragraphs.push({
      id: "p-empty",
      text: "DRAFT PREVIEW: Insufficient grounded matter material for a substantive section. No unsupported filler was invented.",
      factuality: "UNKNOWN",
      sources: [],
      assertionSupport: "UNKNOWN",
      authorityIds: [],
    });
  }

  let working = paragraphs;
  if (OVERSTATE.test(params.question)) {
    const { paragraphs: next, notes } = strengthenWithoutOverstatement(working);
    working = next;
    changedAssertions.push(...notes);
  }

  const draftId = params.resolvedDraftId ?? `preview:${draftType.toLowerCase()}:${params.matterId.slice(0, 8)}`;
  const title =
    draftType === "FACTUAL_BACKGROUND"
      ? "Factual background (draft preview)"
      : draftType === "RESEARCH_MEMO"
        ? "Research memo (draft preview)"
        : `${draftType.replace(/_/g, " ").toLowerCase()} (draft preview)`;

  const previewText = [
    "DRAFT PREVIEW — not saved",
    `Type: ${draftType}`,
    `Title: ${title}`,
    "",
    ...working.map((p, i) => `¶${i + 1}. [${p.factuality}/${p.assertionSupport}] ${p.text}`),
    "",
    "Limitations:",
    ...limitations.map((l) => `- ${l}`),
  ].join("\n");

  return {
    posture: "RESOLVED",
    draftType,
    draftId,
    title,
    paragraphs: working,
    previewText,
    unsupportedRemoved,
    changedAssertions,
    researchArtifactId: params.researchArtifactId ?? (research ? `research:${research.issue.id}` : null),
    hearingContinuity,
    depositionContinuity,
    sourceMap: uniqSources(sourceMap),
    limitations,
    premiseChallenge: null,
  };
}

function uniqSources(refs: SourceRef[]): SourceRef[] {
  const seen = new Set<string>();
  const out: SourceRef[] = [];
  for (const r of refs) {
    const k = `${r.kind}:${r.id}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}

export function strengthenWithoutOverstatement(paragraphs: DraftParagraph[]): {
  paragraphs: DraftParagraph[];
  notes: string[];
} {
  const notes: string[] = ["Applied persuasive organization without upgrading factual certainty."];
  const next = paragraphs.map((p) => {
    if (p.assertionSupport === "SUPPORTED" || p.factuality === "FACT") {
      return {
        ...p,
        text: p.text.replace(/^The record includes/, "The record firmly includes"),
      };
    }
    // Do not upgrade weaker supports.
    return p;
  });
  return { paragraphs: next, notes };
}

export function reviseDraftSourceOnly(draft: DraftResult): DraftResult {
  const kept: DraftParagraph[] = [];
  const removed: string[] = [];
  const changed: string[] = [...draft.changedAssertions];
  for (const p of draft.paragraphs) {
    const hasDoc = p.sources.some((s) => s.kind === "document" || s.kind === "communication");
    // Source-only: keep paragraphs grounded in documents/communications; drop authority-only / unsupported.
    if (
      p.assertionSupport === "UNSUPPORTED" ||
      p.assertionSupport === "UNKNOWN" ||
      !hasDoc
    ) {
      removed.push(p.text);
      changed.push(`Source-only revision removed: ${p.text.slice(0, 100)}`);
      continue;
    }
    kept.push(p);
  }
  const previewText = [
    "DRAFT PREVIEW — source-only revision (not saved)",
    ...kept.map((p, i) => `¶${i + 1}. [${p.factuality}/${p.assertionSupport}] ${p.text}`),
  ].join("\n");
  return {
    ...draft,
    paragraphs: kept,
    previewText,
    unsupportedRemoved: [...draft.unsupportedRemoved, ...removed],
    changedAssertions: changed,
  };
}

export function reviseDraftAuthorityOnly(
  draft: DraftResult,
  authorities: AuthorityInput[],
  mode: "binding_unknown_safe" | "drop_unverified",
): DraftResult {
  const byId = new Map(authorities.map((a) => [a.id, a]));
  const kept: DraftParagraph[] = [];
  const changed = [...draft.changedAssertions];
  for (const p of draft.paragraphs) {
    if (p.authorityIds.length === 0) {
      kept.push(p);
      continue;
    }
    const allowed = p.authorityIds.filter((id) => {
      const a = byId.get(id);
      if (!a) return false;
      if (mode === "drop_unverified") return a.treatmentVerified === true;
      // binding_unknown_safe: do not guess binding; keep only if jurisdictionHint present OR keep with UNKNOWN label
      return true;
    });
    if (allowed.length === 0 && p.authorityIds.length > 0) {
      changed.push(`Authority-only revision removed paragraph relying on unverified/unknown authorities.`);
      continue;
    }
    const note =
      mode === "binding_unknown_safe"
        ? " Binding status remains UNKNOWN unless jurisdiction/court data establishes it."
        : "";
    kept.push({
      ...p,
      authorityIds: allowed,
      text: `${p.text}${note}`,
    });
  }
  return {
    ...draft,
    paragraphs: kept,
    previewText: [
      "DRAFT PREVIEW — authority-only revision (not saved)",
      ...kept.map((p, i) => `¶${i + 1}. ${p.text}`),
    ].join("\n"),
    changedAssertions: changed,
  };
}

export function reviseDraftParagraph(
  draft: DraftResult,
  paragraphNumber: number,
  instruction: string,
): DraftResult {
  const idx = paragraphNumber - 1;
  if (idx < 0 || idx >= draft.paragraphs.length) {
    return {
      ...draft,
      changedAssertions: [
        ...draft.changedAssertions,
        `Paragraph ${paragraphNumber} not found — no rewrite applied.`,
      ],
    };
  }
  const paras = [...draft.paragraphs];
  const target = paras[idx]!;
  let text = target.text;
  if (/disputed|narrower|qualify/i.test(instruction)) {
    text = `Qualified revision: ${qualifyFactText({
      id: target.id,
      text: target.text,
      factuality: target.factuality === "FACT" ? "SUPPORTED_INFERENCE" : target.factuality,
      sourceIds: target.sources.map((s) => s.id),
      disputed: true,
    })}`;
  } else if (/shorter/i.test(instruction)) {
    text = target.text.slice(0, Math.max(80, Math.floor(target.text.length * 0.6)));
  } else {
    text = `Revised: ${target.text}`;
  }
  paras[idx] = { ...target, text };
  return {
    ...draft,
    paragraphs: paras,
    previewText: [
      "DRAFT PREVIEW — paragraph revision (not saved)",
      ...paras.map((p, i) => `¶${i + 1}. ${p.text}`),
    ].join("\n"),
    changedAssertions: [...draft.changedAssertions, `Rewrote paragraph ${paragraphNumber}`],
  };
}

export function researchToDraft(params: {
  question: string;
  matterId: string;
  research: ResearchResult;
  facts?: FactInput[];
}): DraftResult {
  return buildMatterDraftResult({
    question: params.question,
    matterId: params.matterId,
    draftType: "ARGUMENT_SECTION",
    research: params.research,
    facts: params.facts,
    researchArtifactId: params.research.issue.id
      ? `research:${params.research.issue.id}`
      : null,
  });
}

export function draftToResearch(params: {
  question: string;
  matterId: string;
  draft: DraftResult;
  paragraphNumber?: number | null;
  issues: IssueInput[];
  authorities: AuthorityInput[];
}): ResearchResult {
  const para =
    params.paragraphNumber != null
      ? params.draft.paragraphs[params.paragraphNumber - 1]
      : params.draft.paragraphs.find((p) => p.assertionSupport !== "SUPPORTED") ??
        params.draft.paragraphs[0];
  const proposition = para?.text ?? params.question;
  const research = buildMatterResearchResult({
    question: `research whether supported: ${proposition.slice(0, 200)}`,
    matterId: params.matterId,
    issues: params.issues.length
      ? params.issues
      : [{ id: "draft-issue", label: "Draft proposition", kind: "other" }],
    authorities: params.authorities,
    resolvedIssueId: params.issues[0]?.id ?? "draft-issue",
  });
  if (para && (para.assertionSupport === "UNSUPPORTED" || para.assertionSupport === "UNKNOWN")) {
    research.propositionsNotSupported.push({
      text: proposition.slice(0, 300),
      reason: `Draft assertion support=${para.assertionSupport}; research did not upgrade it without authorities.`,
    });
  }
  return research;
}

export function formatResearchForPrompt(result: ResearchResult): string {
  return [
    "MATTER_RESEARCH_RECORD (deterministic; local corpus only — no CourtListener)",
    `Posture: ${result.posture}`,
    `Question: ${result.researchQuestion}`,
    `Issue: ${result.issue.label}`,
    `Jurisdiction scope: ${result.jurisdictionScope}`,
    "",
    "Authorities:",
    ...result.authoritiesFound.map(
      (a) =>
        `- ${a.label} | resolution=${a.resolution} | treatment=${a.treatmentStatus} | stance=${a.stance}`,
    ),
    "",
    "Propositions supported:",
    ...result.propositionsSupported.map((p) => `- ${p.text}`),
    "",
    "Propositions not supported:",
    ...result.propositionsNotSupported.map((p) => `- ${p.text} (${p.reason})`),
    "",
    "Conflicting authorities:",
    ...result.conflictingAuthorities.map((c) => `- ${c.a} vs ${c.b}: ${c.note}`),
    "",
    "Gaps:",
    ...result.researchGaps.map((g) => `- ${g.whatIsMissing}: ${g.whyItMatters}`),
    "",
    "Limitations:",
    ...result.limitations.map((l) => `- ${l}`),
  ].join("\n");
}

export function formatDraftForPrompt(result: DraftResult): string {
  return [
    "MATTER_DRAFT_RECORD (deterministic; evaluate the record — do not advocate beyond sources)",
    `Posture: ${result.posture}`,
    `Type: ${result.draftType}`,
    `DraftId: ${result.draftId ?? "none"}`,
    result.premiseChallenge ? `Premise challenge: ${result.premiseChallenge}` : null,
    "",
    result.previewText,
    "",
    "Changed assertions:",
    ...result.changedAssertions.map((c) => `- ${c}`),
    "",
    "Unsupported removed:",
    ...result.unsupportedRemoved.map((u) => `- ${u}`),
  ]
    .filter(Boolean)
    .join("\n");
}

export function draftRejectsFabrication(result: DraftResult): boolean {
  const blob = result.previewText + result.paragraphs.map((p) => p.text).join(" ");
  return !/\b\d{3}\s+U\.S\.\s+\d+\b/.test(blob) || result.posture === "UNSAFE_PREMISE";
}
