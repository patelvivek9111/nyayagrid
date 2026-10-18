/**
 * Oct 19–25 Phase 2 — Conversational deposition preparation (deterministic).
 * Person-centric, record-grounded. No shared schema. CourtListener: 0.
 * Never infers lying/dishonesty/credibility from contradiction alone.
 */

export const DEPOSITION_FACTUALITY = [
  "FACT",
  "SUPPORTED_INFERENCE",
  "CONFLICT",
  "UNKNOWN",
  "UNSUPPORTED",
  "WITNESS_STATEMENT",
  "CORROBORATED_FACT",
] as const;
export type DepositionFactuality = (typeof DEPOSITION_FACTUALITY)[number];

export type DepositionPersonInput = {
  id: string;
  label: string;
  entityType?: string | null;
  roleHint?: string | null;
  organizationHint?: string | null;
  matterId?: string;
};

export type DepositionClaimInput = {
  id: string;
  label: string;
  supportStatus?: string | null;
  description?: string | null;
  relatedPersonIds?: string[];
};

export type DepositionDocumentInput = {
  id: string;
  label: string;
  relatedPersonIds?: string[];
  relatedClaimIds?: string[];
  whyRelevant?: string | null;
  foundationResolved?: boolean;
};

export type DepositionCommunicationInput = {
  id: string;
  subject: string;
  summary: string | null;
  relatedPersonIds?: string[];
  relatedClaimIds?: string[];
  occurredAt?: string | null;
};

export type DepositionTimelineInput = {
  id: string;
  title: string;
  eventDate: string | null;
  relatedPersonIds?: string[];
};

export type DepositionStatementInput = {
  id: string;
  label: string;
  text: string;
  kind: "deposition" | "affidavit" | "interrogatory" | "email" | "other";
  documentId?: string | null;
  factuality?: DepositionFactuality;
};

export type DepositionSourceRef = {
  kind:
    | "person"
    | "document"
    | "claim"
    | "evidence"
    | "communication"
    | "timeline"
    | "statement"
    | "deficiency"
    | "authority";
  id: string;
  label: string;
};

export type DepositionQuestionTopic = {
  id: string;
  question: string;
  purpose: string;
  questionType: string;
  relatedIssue: string | null;
  sources: DepositionSourceRef[];
  factuality: DepositionFactuality;
};

export type DepositionConflict = {
  id: string;
  statementA: string;
  statementB: string;
  whyConflict: string;
  remainsUnknown: string;
  clarificationQuestions: string[];
  sources: DepositionSourceRef[];
  factuality: "CONFLICT";
};

export type DepositionInvestigateItem = {
  id: string;
  whatGap: string;
  whyItMatters: string;
  whatToLookFor: string;
  relatedEntity: DepositionSourceRef | null;
  sourceBasis: DepositionSourceRef[];
  priority: "high" | "medium" | "low";
};

export type DepositionFollowUpBranch = {
  id: string;
  ifWitness: string;
  thenAsk: string;
  sources: DepositionSourceRef[];
};

export type DepositionPrepResult = {
  deponent: {
    personId: string | null;
    label: string;
    roleInMatter: string | null;
    posture: "NO_PERSON" | "RESOLVED" | "AMBIGUOUS" | "FOREIGN_REJECTED" | "UNKNOWN";
  };
  relevantIssues: Array<{ id: string; label: string; supportStatus: string }>;
  knownFacts: Array<{ text: string; factuality: DepositionFactuality; sources: DepositionSourceRef[] }>;
  supportedInferences: Array<{ text: string; factuality: "SUPPORTED_INFERENCE"; sources: DepositionSourceRef[] }>;
  conflictsToClarify: DepositionConflict[];
  unknownPoints: Array<{ text: string; factuality: "UNKNOWN" }>;
  keyDocuments: Array<{
    id: string;
    label: string;
    whyRelevant: string;
    foundationResolved: boolean;
    sources: DepositionSourceRef[];
  }>;
  keyCommunications: DepositionSourceRef[];
  timelinePoints: Array<{ id: string; title: string; eventDate: string | null; sources: DepositionSourceRef[] }>;
  priorStatements: Array<{ id: string; label: string; kind: string; factuality: DepositionFactuality }>;
  admissionsToSeek: Array<{ text: string; sources: DepositionSourceRef[] }>;
  questionTopics: DepositionQuestionTopic[];
  followUpBranches: DepositionFollowUpBranch[];
  investigateBeforeDeposition: DepositionInvestigateItem[];
  sourceMap: DepositionSourceRef[];
  limitations: string[];
  outlinePreview: string | null;
  compressedQuestionList: string | null;
  premiseChallenge: string | null;
  analysis: {
    admissions: Array<{ text: string; factuality: DepositionFactuality; sources: DepositionSourceRef[] }>;
    newFacts: Array<{ text: string; factuality: DepositionFactuality; sources: DepositionSourceRef[] }>;
    conflicts: DepositionConflict[];
    claimImpact: Array<{ claimId: string; label: string; note: string }>;
    followUpDiscovery: DepositionInvestigateItem[];
  } | null;
};

export type DepositionPrepBuildParams = {
  question: string;
  matterId: string;
  persons: DepositionPersonInput[];
  claims?: DepositionClaimInput[];
  documents?: DepositionDocumentInput[];
  communications?: DepositionCommunicationInput[];
  timeline?: DepositionTimelineInput[];
  priorStatements?: DepositionStatementInput[];
  resolvedPersonId?: string | null;
  ambiguousPersonIds?: string[];
  foreignMatterId?: string | null;
  focusIssue?: string | null;
  outlineRequested?: boolean;
  questionLimit?: number | null;
  includeAnalysis?: boolean;
};

const CREDIBILITY_LEAP =
  /\b(prove (he|she|they) lied|get (him|her|them) to admit (fraud|theft|stole)|prove dishonesty|make (him|her) admit|who should we believe|which witness is lying|which testimony is false|this proves (he|she|they) lied)\b/i;

export function isDepositionPrepQuestion(question: string): boolean {
  const q = question.trim();
  return (
    /\b(prepare|prep)\b.+\b(depos(?:e|ition)|witness)\b/i.test(q) ||
    /\bdepos(?:e|ition)\b.+\b(prepare|prep|questions?|outline)\b/i.test(q) ||
    /\bwhat should I ask\b.+\b(him|her|them|witness|deponent)\b/i.test(q) ||
    /\b(deposition questions|questions for (this )?witness|witness prep)\b/i.test(q) ||
    /\bwhere does (his|her|their) story conflict\b/i.test(q) ||
    /\b(admissions I need|follow-up questions)\b/i.test(q) ||
    /\binvestigate before (taking )?(this )?deposition\b/i.test(q) ||
    /\bwhat did this deposition change\b/i.test(q) ||
    CREDIBILITY_LEAP.test(q)
  );
}

export function isDepositionOutlineRequest(question: string): boolean {
  return /\b(deposition outline|turn (this|that) into an outline|outline for (the )?deposition)\b/i.test(
    question,
  );
}

export function extractDepositionQuestionLimit(question: string): number | null {
  const m =
    question.match(/\b(?:make it|cut it to|just(?: the)?|only(?: give me)?|top)\s+(\d+)\s*(?:questions?|most important)?\b/i) ||
    question.match(/\b(\d+)\s*(?:questions?|most important)\b/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 200) : null;
}

/** Multi-turn continuity after a deponent is already bound (no auto-pick). */
export function isDepositionContinuityQuestion(question: string): boolean {
  return (
    /\bfocus (?:only )?on\b/i.test(question) ||
    isDepositionOutlineRequest(question) ||
    extractDepositionQuestionLimit(question) != null ||
    /\b(what if (he|she|they)|show me the sources|why that one|what conflicts|make (it|the questions) shorter|group by)\b/i.test(
      question,
    ) ||
    /\bwhat (document|documents) should I\b/i.test(question) ||
    /\b(only give me|cut it to|make it \d+)\b/i.test(question)
  );
}

export function extractDepositionFocusIssue(question: string): string | null {
  const m =
    question.match(/\bfocus (?:only )?on\s+(.+?)(?:[.?!]|$)/i) ||
    question.match(/\bonly (?:about|on)\s+(.+?)(?:[.?!]|$)/i);
  if (!m?.[1]) return null;
  return m[1].trim().replace(/^the\s+/i, "").slice(0, 80) || null;
}

export function depositionPrepForceDomains(): Array<
  "CLAIMS" | "EVIDENCE" | "DISCOVERY" | "COMMUNICATIONS" | "TIMELINE" | "DEPOSITION" | "MOTIONS"
> {
  return ["CLAIMS", "EVIDENCE", "DISCOVERY", "COMMUNICATIONS", "TIMELINE", "DEPOSITION", "MOTIONS"];
}

function uniqSources(refs: DepositionSourceRef[]): DepositionSourceRef[] {
  const seen = new Set<string>();
  const out: DepositionSourceRef[] = [];
  for (const r of refs) {
    const key = `${r.kind}:${r.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

export function selectDepositionPersonTarget(params: {
  persons: DepositionPersonInput[];
  resolvedPersonId?: string | null;
  ambiguousPersonIds?: string[];
  question: string;
  matterId: string;
  foreignMatterId?: string | null;
}): {
  person: DepositionPersonInput | null;
  ambiguous: DepositionPersonInput[];
  posture: DepositionPrepResult["deponent"]["posture"];
} {
  if (params.foreignMatterId) {
    const foreign = params.persons.filter((p) => p.matterId === params.foreignMatterId);
    if (params.resolvedPersonId && foreign.some((p) => p.id === params.resolvedPersonId)) {
      return { person: null, ambiguous: [], posture: "FOREIGN_REJECTED" };
    }
  }
  const scoped = params.persons.filter((p) => !p.matterId || p.matterId === params.matterId);
  if (params.ambiguousPersonIds && params.ambiguousPersonIds.length > 1) {
    const amb = scoped.filter((p) => params.ambiguousPersonIds!.includes(p.id));
    return { person: null, ambiguous: amb, posture: "AMBIGUOUS" };
  }
  if (params.resolvedPersonId) {
    const hit = scoped.find((p) => p.id === params.resolvedPersonId) ?? null;
    if (!hit) return { person: null, ambiguous: [], posture: "NO_PERSON" };
    return { person: hit, ambiguous: [], posture: "RESOLVED" };
  }

  const q = params.question.toLowerCase();
  const named = scoped.filter((p) => {
    const label = p.label.toLowerCase();
    const tokens = label.split(/\s+/).filter((t) => t.length > 2);
    return tokens.some((t) => q.includes(t)) || q.includes(label);
  });
  if (named.length === 1) return { person: named[0]!, ambiguous: [], posture: "RESOLVED" };
  if (named.length > 1) return { person: null, ambiguous: named, posture: "AMBIGUOUS" };
  if (scoped.length === 1) return { person: scoped[0]!, ambiguous: [], posture: "RESOLVED" };
  if (scoped.length > 1) return { person: null, ambiguous: scoped, posture: "AMBIGUOUS" };
  return { person: null, ambiguous: [], posture: "NO_PERSON" };
}

function challengeCredibilityPremise(question: string): string | null {
  if (!CREDIBILITY_LEAP.test(question)) return null;
  return [
    "The record may contain conflicting accounts; it does not establish dishonesty or guilt from contradiction alone.",
    "Preparation should clarify documented obligations, knowledge, authorization, control, and timeline using source-backed questions — not assume fraud or theft.",
  ].join(" ");
}

export function buildDepositionPrepResult(params: DepositionPrepBuildParams): DepositionPrepResult {
  const limitations = [
    "Deposition preparation evaluates the matter record; it does not advocate for the user's assumption.",
    "Conflicts are framed neutrally — contradiction alone does not establish lying or dishonesty.",
    "Testimony is a witness statement until corroborated; it is not automatically FACT.",
    "No CourtListener calls were made for this preparation.",
    "Do not invent deposition dates, notice periods, or deadlines not on the matter record.",
  ];
  const premiseChallenge = challengeCredibilityPremise(params.question);
  if (premiseChallenge) limitations.push(premiseChallenge);

  const selected = selectDepositionPersonTarget({
    persons: params.persons,
    resolvedPersonId: params.resolvedPersonId,
    ambiguousPersonIds: params.ambiguousPersonIds,
    question: params.question,
    matterId: params.matterId,
    foreignMatterId: params.foreignMatterId,
  });

  if (selected.posture === "AMBIGUOUS") {
    return {
      deponent: {
        personId: null,
        label: "Ambiguous deponent target",
        roleInMatter: null,
        posture: "AMBIGUOUS",
      },
      relevantIssues: [],
      knownFacts: [],
      supportedInferences: [],
      conflictsToClarify: [],
      unknownPoints: [
        { text: "Multiple people match. Clarify which person to depose.", factuality: "UNKNOWN" },
      ],
      keyDocuments: [],
      keyCommunications: [],
      timelinePoints: [],
      priorStatements: [],
      admissionsToSeek: [],
      questionTopics: [],
      followUpBranches: [],
      investigateBeforeDeposition: [],
      sourceMap: selected.ambiguous.map((p) => ({
        kind: "person" as const,
        id: p.id,
        label: p.label,
      })),
      limitations,
      outlinePreview: null,
      compressedQuestionList: null,
      premiseChallenge,
      analysis: null,
    };
  }

  if (selected.posture === "FOREIGN_REJECTED" || selected.posture === "NO_PERSON") {
    return {
      deponent: {
        personId: null,
        label:
          selected.posture === "FOREIGN_REJECTED"
            ? "Foreign matter person rejected"
            : "No deponent resolved",
        roleInMatter: null,
        posture: selected.posture,
      },
      relevantIssues: [],
      knownFacts: [],
      supportedInferences: [],
      conflictsToClarify: [],
      unknownPoints: [
        {
          text:
            selected.posture === "FOREIGN_REJECTED"
              ? "Cross-matter person identity cannot be used for deposition prep."
              : "No person target resolved for deposition preparation.",
          factuality: "UNKNOWN",
        },
      ],
      keyDocuments: [],
      keyCommunications: [],
      timelinePoints: [],
      priorStatements: [],
      admissionsToSeek: [],
      questionTopics: [],
      followUpBranches: [],
      investigateBeforeDeposition: [],
      sourceMap: [],
      limitations,
      outlinePreview: null,
      compressedQuestionList: null,
      premiseChallenge,
      analysis: null,
    };
  }

  const person = selected.person!;
  const focus = (params.focusIssue ?? "").trim().toLowerCase();
  const claims = (params.claims ?? []).filter(
    (c) =>
      !focus ||
      c.label.toLowerCase().includes(focus) ||
      (c.description ?? "").toLowerCase().includes(focus),
  );
  const docs = (params.documents ?? []).filter(
    (d) =>
      (d.relatedPersonIds ?? []).includes(person.id) ||
      (d.relatedPersonIds ?? []).length === 0 ||
      (focus && (d.whyRelevant ?? d.label).toLowerCase().includes(focus)),
  );
  const comms = (params.communications ?? []).filter(
    (c) =>
      (c.relatedPersonIds ?? []).includes(person.id) ||
      (c.relatedPersonIds ?? []).length === 0,
  );
  const timeline = (params.timeline ?? []).filter(
    (t) =>
      (t.relatedPersonIds ?? []).includes(person.id) ||
      (t.relatedPersonIds ?? []).length === 0,
  );
  const statements = params.priorStatements ?? [];

  const personRef: DepositionSourceRef = {
    kind: "person",
    id: person.id,
    label: person.label,
  };

  const knownFacts: DepositionPrepResult["knownFacts"] = [];
  const supportedInferences: DepositionPrepResult["supportedInferences"] = [];
  for (const c of claims) {
    const status = String(c.supportStatus ?? "UNKNOWN").toUpperCase();
    const sources: DepositionSourceRef[] = [
      personRef,
      { kind: "claim", id: c.id, label: c.label },
    ];
    if (status === "SUPPORTED") {
      knownFacts.push({
        text: c.label,
        factuality: "FACT",
        sources,
      });
    } else if (status.includes("PARTIAL")) {
      supportedInferences.push({
        text: `${c.label} is only partially supported on the record.`,
        factuality: "SUPPORTED_INFERENCE",
        sources,
      });
    }
  }

  const conflictsToClarify: DepositionConflict[] = [];
  if (statements.length >= 2) {
    const a = statements[0]!;
    const b = statements[1]!;
    if (a.text.trim() && b.text.trim() && a.text.trim() !== b.text.trim()) {
      conflictsToClarify.push({
        id: `conflict-${a.id}-${b.id}`,
        statementA: a.text.slice(0, 240),
        statementB: b.text.slice(0, 240),
        whyConflict: "The accounts conflict on the matter record and require clarification.",
        remainsUnknown: "Which account, if either, is complete remains UNKNOWN without further record support.",
        clarificationQuestions: [
          `Clarify when you first became aware of the subject of ${a.label}.`,
          `Explain how ${b.label} relates to your recollection.`,
        ],
        sources: [
          { kind: "statement", id: a.id, label: a.label },
          { kind: "statement", id: b.id, label: b.label },
          personRef,
        ],
        factuality: "CONFLICT",
      });
    }
  }
  // Document vs communication soft conflict when both mention focus issue.
  if (focus && docs[0] && comms[0]) {
    conflictsToClarify.push({
      id: `conflict-doc-comm-${docs[0].id}`,
      statementA: `Document: ${docs[0].label}`,
      statementB: `Communication: ${comms[0].subject}`,
      whyConflict: `Both touch ${focus}; any inconsistency must be clarified from the record, not assumed as dishonesty.`,
      remainsUnknown: "Whether the accounts are incomplete, sequence-dependent, or actually inconsistent remains UNKNOWN.",
      clarificationQuestions: [
        `Describe your understanding of ${docs[0].label}.`,
        `When did you send or receive the communication titled “${comms[0].subject}”?`,
      ],
      sources: [
        { kind: "document", id: docs[0].id, label: docs[0].label },
        { kind: "communication", id: comms[0].id, label: comms[0].subject },
        personRef,
      ],
      factuality: "CONFLICT",
    });
  }

  const unknownPoints: DepositionPrepResult["unknownPoints"] = [];
  for (const c of claims.filter((x) => /UNKNOWN|UNSUPPORT/i.test(String(x.supportStatus ?? "UNKNOWN")))) {
    unknownPoints.push({ text: `${c.label} remains ${c.supportStatus ?? "UNKNOWN"} on the record.`, factuality: "UNKNOWN" });
  }
  if (statements.length === 0) {
    unknownPoints.push({
      text: "No prior testimony/statement artifact is linked for this person on the matter record.",
      factuality: "UNKNOWN",
    });
  }

  const keyDocuments = docs.slice(0, 12).map((d) => ({
    id: d.id,
    label: d.label,
    whyRelevant:
      d.whyRelevant?.trim() ||
      (focus ? `Potentially relevant to ${focus} given matter linkage.` : "Linked for person-focused deposition prep."),
    foundationResolved: d.foundationResolved === true,
    sources: [{ kind: "document" as const, id: d.id, label: d.label }, personRef],
  }));

  const keyCommunications = uniqSources(
    comms.slice(0, 12).map((c) => ({
      kind: "communication" as const,
      id: c.id,
      label: c.subject,
    })),
  );

  const timelinePoints = timeline.slice(0, 12).map((t) => ({
    id: t.id,
    title: t.title,
    eventDate: t.eventDate,
    sources: [{ kind: "timeline" as const, id: t.id, label: t.title }, personRef],
  }));

  const priorStatements = statements.map((s) => ({
    id: s.id,
    label: s.label,
    kind: s.kind,
    factuality: s.factuality ?? ("WITNESS_STATEMENT" as const),
  }));

  const admissionsToSeek = claims.slice(0, 6).map((c) => ({
    text: `Clarify whether ${person.label} agrees that the documented aspects of “${c.label}” applied and whether the record-supported conduct tied to that issue occurred — without presupposing a disputed conclusion.`,
    sources: [
      personRef,
      { kind: "claim" as const, id: c.id, label: c.label },
    ],
  }));

  const questionTopics: DepositionQuestionTopic[] = [];
  let qn = 0;
  const pushQ = (topic: Omit<DepositionQuestionTopic, "id">) => {
    qn += 1;
    questionTopics.push({ id: `q-${qn}`, ...topic });
  };

  pushQ({
    question: `Please state your full name and role in connection with this matter.`,
    purpose: "Foundation / identity",
    questionType: "foundation",
    relatedIssue: null,
    sources: [personRef],
    factuality: "FACT",
  });
  if (person.roleHint) {
    pushQ({
      question: `Describe your responsibilities as ${person.roleHint}.`,
      purpose: "Role and responsibilities",
      questionType: "foundation",
      relatedIssue: person.roleHint,
      sources: [personRef],
      factuality: "SUPPORTED_INFERENCE",
    });
  }
  for (const c of claims.slice(0, 8)) {
    pushQ({
      question: `What do you know about ${c.label}?`,
      purpose: "Issue knowledge",
      questionType: "knowledge",
      relatedIssue: c.label,
      sources: [personRef, { kind: "claim", id: c.id, label: c.label }],
      factuality: "UNKNOWN",
    });
  }
  for (const d of keyDocuments.slice(0, 8)) {
    pushQ({
      question: `Have you seen the document titled “${d.label}”?`,
      purpose: "Document foundation",
      questionType: d.foundationResolved ? "document" : "authentication",
      relatedIssue: focus || null,
      sources: d.sources,
      factuality: d.foundationResolved ? "FACT" : "UNKNOWN",
    });
    if (!d.foundationResolved) {
      pushQ({
        question: `Can you authenticate or describe the circumstances under which “${d.label}” was created or received?`,
        purpose: "Foundation remains unresolved on the matter record",
        questionType: "authentication",
        relatedIssue: focus || null,
        sources: d.sources,
        factuality: "UNKNOWN",
      });
    }
  }
  for (const c of keyCommunications.slice(0, 6)) {
    pushQ({
      question: `Please describe the communication “${c.label}” and your involvement.`,
      purpose: "Communication thread",
      questionType: "communication",
      relatedIssue: focus || null,
      sources: [c, personRef],
      factuality: "SUPPORTED_INFERENCE",
    });
  }
  for (const t of timelinePoints.filter((x) => !x.eventDate).slice(0, 3)) {
    pushQ({
      question: `The timeline entry “${t.title}” has no stored date — what is your recollection of when this occurred?`,
      purpose: "Timeline gap clarification",
      questionType: "timeline",
      relatedIssue: focus || null,
      sources: t.sources,
      factuality: "UNKNOWN",
    });
  }
  for (const conflict of conflictsToClarify) {
    for (const cq of conflict.clarificationQuestions) {
      pushQ({
        question: cq,
        purpose: "Conflict clarification (neutral)",
        questionType: "contradiction clarification",
        relatedIssue: focus || null,
        sources: conflict.sources,
        factuality: "CONFLICT",
      });
    }
  }

  const followUpBranches: DepositionFollowUpBranch[] = [];
  if (keyDocuments[0]) {
    followUpBranches.push({
      id: "branch-doc-confirm",
      ifWitness: `confirms familiarity with “${keyDocuments[0].label}”`,
      thenAsk: `Ask when they first received or reviewed it and what action, if any, followed — grounded in that document.`,
      sources: keyDocuments[0].sources,
    });
    followUpBranches.push({
      id: "branch-doc-deny",
      ifWitness: `denies receiving or reviewing “${keyDocuments[0].label}”`,
      thenAsk: `Ask foundation questions and explore related communications/process without assuming concealment.`,
      sources: keyDocuments[0].sources,
    });
  }
  if (keyCommunications[0]) {
    followUpBranches.push({
      id: "branch-comm-recall",
      ifWitness: `says they do not recall “${keyCommunications[0].label}”`,
      thenAsk: `Ask about date, participants, and ordinary practice for such communications; do not invent a date.`,
      sources: [keyCommunications[0], personRef],
    });
  }

  const investigateBeforeDeposition: DepositionInvestigateItem[] = [];
  for (const d of keyDocuments.filter((x) => !x.foundationResolved).slice(0, 4)) {
    investigateBeforeDeposition.push({
      id: `gap-foundation-${d.id}`,
      whatGap: `Foundation/authentication for “${d.label}” is not resolved on the matter record.`,
      whyItMatters: "Unsettled foundation weakens exhibit questioning readiness.",
      whatToLookFor: "Source-backed creation/receipt context or custodian information.",
      relatedEntity: { kind: "document", id: d.id, label: d.label },
      sourceBasis: d.sources,
      priority: "high",
    });
  }
  for (const t of timelinePoints.filter((x) => !x.eventDate).slice(0, 3)) {
    investigateBeforeDeposition.push({
      id: `gap-timeline-${t.id}`,
      whatGap: `Timeline point “${t.title}” has no stored date.`,
      whyItMatters: "Temporal questioning cannot invent dates.",
      whatToLookFor: "A source-backed date or explicit UNKNOWN labeling.",
      relatedEntity: { kind: "timeline", id: t.id, label: t.title },
      sourceBasis: t.sources,
      priority: "medium",
    });
  }
  if (comms.some((c) => /promis|will send|attach/i.test(`${c.subject} ${c.summary ?? ""}`))) {
    const hit = comms.find((c) => /promis|will send|attach/i.test(`${c.subject} ${c.summary ?? ""}`))!;
    investigateBeforeDeposition.push({
      id: `gap-promised-doc-${hit.id}`,
      whatGap: "A communication appears to reference a promised or missing attachment/document.",
      whyItMatters: "Witness may reference a document not located in the matter file.",
      whatToLookFor: "The referenced attachment or confirmation it was never produced.",
      relatedEntity: { kind: "communication", id: hit.id, label: hit.subject },
      sourceBasis: [{ kind: "communication", id: hit.id, label: hit.subject }, personRef],
      priority: "high",
    });
  }
  for (const u of unknownPoints.slice(0, 3)) {
    investigateBeforeDeposition.push({
      id: `gap-unknown-${investigateBeforeDeposition.length}`,
      whatGap: u.text,
      whyItMatters: "Unsupported or unknown issues create deposition blind spots.",
      whatToLookFor: "Supporting documents, admissions, or verified facts.",
      relatedEntity: personRef,
      sourceBasis: [personRef],
      priority: "medium",
    });
  }

  let analysis: DepositionPrepResult["analysis"] = null;
  if (params.includeAnalysis || /\bwhat did this deposition change|admissions did we get|compare testimony\b/i.test(params.question)) {
    if (statements.length === 0) {
      analysis = {
        admissions: [],
        newFacts: [],
        conflicts: [],
        claimImpact: [],
        followUpDiscovery: [
          {
            id: "gap-no-transcript",
            whatGap: "No deposition transcript/prior statement is available to analyze.",
            whyItMatters: "Post-deposition impact analysis cannot invent testimony.",
            whatToLookFor: "Upload or link a transcript/statement artifact for this person.",
            relatedEntity: personRef,
            sourceBasis: [personRef],
            priority: "high",
          },
        ],
      };
    } else {
      analysis = {
        admissions: statements.slice(0, 4).map((s) => ({
          text: s.text.slice(0, 200),
          factuality: "WITNESS_STATEMENT" as const,
          sources: [{ kind: "statement" as const, id: s.id, label: s.label }],
        })),
        newFacts: [],
        conflicts: conflictsToClarify,
        claimImpact: claims.slice(0, 4).map((c) => ({
          claimId: c.id,
          label: c.label,
          note: `Testimony remains WITNESS_STATEMENT relative to “${c.label}” until independently corroborated.`,
        })),
        followUpDiscovery: investigateBeforeDeposition.slice(0, 4),
      };
    }
  }

  const sourceMap = uniqSources([
    personRef,
    ...keyDocuments.flatMap((d) => d.sources),
    ...keyCommunications,
    ...timelinePoints.flatMap((t) => t.sources),
    ...questionTopics.flatMap((q) => q.sources),
    ...statements.map((s) => ({ kind: "statement" as const, id: s.id, label: s.label })),
  ]);

  let outlinePreview: string | null = null;
  if (params.outlineRequested || isDepositionOutlineRequest(params.question)) {
    outlinePreview = buildDepositionOutlineText({
      person,
      claims,
      questionTopics,
      keyDocuments,
      keyCommunications,
      conflictsToClarify,
      timelinePoints,
    });
  }

  let compressedQuestionList: string | null = null;
  const limit = params.questionLimit ?? extractDepositionQuestionLimit(params.question);
  if (limit != null) {
    compressedQuestionList = compressDepositionQuestions({
      limit,
      person,
      questionTopics,
    });
  }

  return {
    deponent: {
      personId: person.id,
      label: person.label,
      roleInMatter: person.roleHint ?? null,
      posture: "RESOLVED",
    },
    relevantIssues: claims.map((c) => ({
      id: c.id,
      label: c.label,
      supportStatus: String(c.supportStatus ?? "UNKNOWN"),
    })),
    knownFacts,
    supportedInferences,
    conflictsToClarify,
    unknownPoints,
    keyDocuments,
    keyCommunications,
    timelinePoints,
    priorStatements,
    admissionsToSeek,
    questionTopics,
    followUpBranches,
    investigateBeforeDeposition,
    sourceMap,
    limitations,
    outlinePreview,
    compressedQuestionList,
    premiseChallenge,
    analysis,
  };
}

export function buildDepositionOutlineText(params: {
  person: DepositionPersonInput;
  claims: DepositionClaimInput[];
  questionTopics: DepositionQuestionTopic[];
  keyDocuments: DepositionPrepResult["keyDocuments"];
  keyCommunications: DepositionSourceRef[];
  conflictsToClarify: DepositionConflict[];
  timelinePoints: DepositionPrepResult["timelinePoints"];
}): string {
  const lines = [
    "DEPOSITION OUTLINE (DRAFT PREVIEW — not saved)",
    `Deponent: ${params.person.label}`,
    params.person.roleHint ? `Role: ${params.person.roleHint}` : null,
    "",
    "I. Foundation/background",
    ...params.questionTopics.filter((q) => q.questionType === "foundation").map((q) => `- ${q.question}`),
    "",
    "II. Role and responsibilities",
    params.person.roleHint
      ? `- Responsibilities as ${params.person.roleHint}`
      : "- Role details as supported by the matter record",
    "",
  ].filter((x): x is string => x != null);

  let section = 3;
  for (const claim of params.claims.slice(0, 4)) {
    lines.push(`${roman(section)}. ${claim.label}`);
    lines.push(
      ...params.questionTopics
        .filter((q) => q.relatedIssue === claim.label)
        .map((q) => `- ${q.question}`),
    );
    lines.push("");
    section += 1;
  }
  lines.push(`${roman(section++)}. Documents/exhibits`);
  for (const d of params.keyDocuments) {
    lines.push(
      `- ${d.label}: ${d.whyRelevant}${d.foundationResolved ? "" : " [foundation NOT resolved]"}`,
    );
  }
  lines.push("");
  lines.push(`${roman(section++)}. Communications`);
  for (const c of params.keyCommunications) {
    lines.push(`- ${c.label}`);
  }
  lines.push("");
  lines.push(`${roman(section++)}. Timeline`);
  for (const t of params.timelinePoints) {
    lines.push(`- ${t.title}${t.eventDate ? ` @ ${t.eventDate}` : " (date UNKNOWN — do not invent)"}`);
  }
  lines.push("");
  lines.push(`${roman(section++)}. Conflicts/clarification`);
  for (const c of params.conflictsToClarify) {
    lines.push(`- ${c.whyConflict}`);
  }
  lines.push("");
  lines.push(`${roman(section)}. Cleanup/follow-up`);
  lines.push("- Confirm open points and any documents referenced but not produced.");
  return lines.join("\n");
}

function roman(n: number): string {
  const map: Array<[number, string]> = [
    [10, "X"],
    [9, "IX"],
    [5, "V"],
    [4, "IV"],
    [1, "I"],
  ];
  let x = n;
  let out = "";
  for (const [v, s] of map) {
    while (x >= v) {
      out += s;
      x -= v;
    }
  }
  return out || "I";
}

export function compressDepositionQuestions(params: {
  limit: number;
  person: DepositionPersonInput;
  questionTopics: DepositionQuestionTopic[];
}): string {
  const grounded = params.questionTopics.slice(0, params.limit);
  const lines = [
    `${params.limit}-QUESTION DEPOSITION LIST (compressed from grounded topics; no fabricated extras)`,
    `Deponent: ${params.person.label}`,
    `Grounded topics available: ${params.questionTopics.length}`,
  ];
  if (params.questionTopics.length < params.limit) {
    lines.push(
      `NOTE: Only ${params.questionTopics.length} grounded question(s) are supported by the current record — declining to invent ${params.limit - params.questionTopics.length} unsupported question(s).`,
    );
  }
  grounded.forEach((q, i) => {
    lines.push(`${i + 1}. ${q.question} [${q.factuality}] (${q.sources.map((s) => s.label).join("; ") || "person record"})`);
  });
  return lines.join("\n");
}

export function formatDepositionPrepForPrompt(result: DepositionPrepResult): string {
  const lines = [
    "DEPOSITION_PREPARATION_RECORD (deterministic; evaluate the record — do not advocate)",
    `Deponent: ${result.deponent.label}`,
    `Posture: ${result.deponent.posture}`,
    `Role: ${result.deponent.roleInMatter ?? "UNKNOWN"}`,
    "",
    "Relevant issues:",
    ...result.relevantIssues.map((i) => `- ${i.label} | support=${i.supportStatus}`),
    "",
    "Known facts:",
    ...result.knownFacts.map((f) => `- ${f.text} [${f.factuality}]`),
    "",
    "Conflicts (neutral):",
    ...result.conflictsToClarify.map((c) => `- ${c.whyConflict}`),
    "",
    "Question topics:",
    ...result.questionTopics.slice(0, 40).map((q) => `- (${q.questionType}) ${q.question}`),
    "",
    "Investigate before deposition:",
    ...result.investigateBeforeDeposition.map((g) => `- [${g.priority}] ${g.whatGap} → ${g.whatToLookFor}`),
    "",
    "Limitations:",
    ...result.limitations.map((l) => `- ${l}`),
  ];
  if (result.premiseChallenge) {
    lines.push("", "Premise challenge:", result.premiseChallenge);
  }
  if (result.outlinePreview) {
    lines.push("", "Outline preview:", result.outlinePreview);
  }
  if (result.compressedQuestionList) {
    lines.push("", "Compressed question list:", result.compressedQuestionList);
  }
  if (result.analysis) {
    lines.push(
      "",
      "Post-deposition analysis notes:",
      `admissions=${result.analysis.admissions.length}`,
      `conflicts=${result.analysis.conflicts.length}`,
      ...result.analysis.claimImpact.map((c) => `- claim impact: ${c.label}: ${c.note}`),
    );
  }
  return lines.join("\n");
}

export function depositionPrepRejectsCredibilityLeap(result: DepositionPrepResult): boolean {
  const blob = [
    ...result.questionTopics.map((q) => q.question),
    ...result.admissionsToSeek.map((a) => a.text),
    ...result.conflictsToClarify.map((c) => c.whyConflict),
    result.premiseChallenge ?? "",
  ].join(" ");
  return !/\b(he lied|she lied|prove dishonesty|admit (fraud|theft))\b/i.test(blob);
}
