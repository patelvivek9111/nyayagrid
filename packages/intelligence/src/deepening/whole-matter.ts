import type { LawEvidenceBundle, QueryContext } from "../week4/types";
import { decomposeMatterIssues } from "./decompose-matter";

const STOP = new Set([
  "that",
  "this",
  "with",
  "from",
  "have",
  "been",
  "were",
  "what",
  "which",
  "their",
  "there",
  "about",
  "into",
  "only",
  "also",
]);

export type MatterIssueAnalysis = {
  issueId: string;
  description: string;
  issueType: string;
  supportingEvidenceIds: string[];
  contraryEvidenceIds: string[];
  missingEvidenceIds: string[];
  bindingAuthorityIds: string[];
  contraryAuthorityIds: string[];
  uncertainty: string[];
  abstainReason: string | null;
  provenanceIds: string[];
};

export type AuthorityConflictRecord = {
  id: string;
  authorityA: string;
  authorityB: string;
  description: string;
  resolved: false;
};

export type TheoryHypothesis = {
  id: string;
  role: "party" | "prosecution" | "defense" | "alternative" | "system";
  text: string;
  status: "hypothesis";
  supportingEvidenceIds: string[];
  contraryEvidenceIds: string[];
  unsupportedAssumptions: string[];
};

export type WholeMatterAnalysis = {
  scopeId: string | null;
  issues: MatterIssueAnalysis[];
  authorityConflicts: AuthorityConflictRecord[];
  hypotheses: TheoryHypothesis[];
  unassignedEvidenceIds: string[];
  guiltConclusion: null;
  outcomeConclusion: null;
  decisiveConclusion: null;
};

export type LongFormSection = {
  heading: string;
  issueId: string | null;
  body: string;
  sourceIds: string[];
};

export type LongFormAnalysis = {
  shortAnswer: string;
  sections: LongFormSection[];
  uncertainty: string[];
  abstentions: string[];
  guiltConclusion: null;
  outcomeConclusion: null;
};

type EvidenceLink = {
  evidenceId: string;
  issueId: string;
  relation: "SUPPORTS" | "CONTRADICTS";
};

function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/\W+/)
      .filter((token) => token.length > 3 && !STOP.has(token)),
  );
}

function overlapScore(left: string, right: string): number {
  const a = tokens(left);
  const b = tokens(right);
  if (a.size === 0 || b.size === 0) return 0;
  let hits = 0;
  for (const token of a) if (b.has(token)) hits += 1;
  return hits / Math.min(a.size, b.size);
}

function authorityId(row: Record<string, unknown>): string {
  return String(row.authorityId ?? "");
}

function clip(text: string, max = 240): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

export function buildWholeMatterAnalysis(params: {
  context: QueryContext;
  bundle: LawEvidenceBundle;
  evidenceLinks?: EvidenceLink[];
}): WholeMatterAnalysis {
  const decomposed = decomposeMatterIssues(params.context);
  const issues = decomposed.issues.map((issue, index) => ({
    issueId: `issue-${index + 1}`,
    description: issue.description,
    issueType: issue.issueType,
  }));
  const linkByIssue = new Map<string, EvidenceLink[]>();
  for (const link of params.evidenceLinks ?? []) {
    const list = linkByIssue.get(link.issueId) ?? [];
    list.push(link);
    linkByIssue.set(link.issueId, list);
  }
  const evidenceById = new Map(
    [...params.bundle.supportingEvidence, ...params.bundle.contraryEvidence].map((item) => [item.id, item]),
  );
  const binding = params.bundle.bindingAuthorities.map(authorityId).filter(Boolean);
  const contraryAuth = params.bundle.contraryAuthorities.map(authorityId).filter(Boolean);
  const authorityConflicts: AuthorityConflictRecord[] = [];
  for (const left of binding) {
    for (const right of contraryAuth) {
      authorityConflicts.push({
        id: `conflict-${left}-${right}`,
        authorityA: left,
        authorityB: right,
        description: "Binding and contrary authorities are both in the record. Neither is treated as resolving the other.",
        resolved: false,
      });
    }
  }
  const single = issues.length === 1;
  const assigned = new Set<string>();
  const analyzed: MatterIssueAnalysis[] = issues.map((issue) => {
    const explicit = linkByIssue.get(issue.issueId) ?? [];
    const supporting = new Set<string>();
    const contrary = new Set<string>();
    if (explicit.length > 0) {
      for (const link of explicit) {
        if (!evidenceById.has(link.evidenceId)) continue;
        assigned.add(link.evidenceId);
        if (link.relation === "SUPPORTS") supporting.add(link.evidenceId);
        else contrary.add(link.evidenceId);
      }
    } else if (single) {
      for (const item of params.bundle.supportingEvidence) supporting.add(item.id);
      for (const item of params.bundle.contraryEvidence) contrary.add(item.id);
      for (const id of supporting) assigned.add(id);
      for (const id of contrary) assigned.add(id);
    } else {
      for (const item of params.bundle.supportingEvidence) {
        if (overlapScore(issue.description, item.text) >= 0.3) {
          supporting.add(item.id);
          assigned.add(item.id);
        }
      }
      for (const item of params.bundle.contraryEvidence) {
        if (overlapScore(issue.description, item.text) >= 0.3) {
          contrary.add(item.id);
          assigned.add(item.id);
        }
      }
    }
    const missing = params.bundle.missingEvidence.filter((item) => {
      if (single) return true;
      return overlapScore(issue.description, item.description) >= 0.3;
    });
    const uncertainty: string[] = [];
    let abstainReason: string | null = null;
    if (binding.length === 0) {
      abstainReason = "INSUFFICIENT_AUTHORITY";
      uncertainty.push("No binding authority is attached to this issue.");
    }
    if (authorityConflicts.length > 0) {
      abstainReason = abstainReason ?? "AUTHORITY_CONFLICT";
      uncertainty.push("Contrary authority is unresolved.");
    }
    if (supporting.size === 0) {
      abstainReason = abstainReason ?? "NO_SUPPORTING_EVIDENCE";
      uncertainty.push("No supporting evidence was tied to this issue.");
    }
    if (missing.length > 0) uncertainty.push("Missing evidence remains on this issue.");
    if (contrary.size > 0) uncertainty.push("Contrary evidence is recorded and is not discarded.");
    const provenanceIds = [
      ...supporting,
      ...contrary,
      ...missing.map((item) => item.id),
      ...binding,
      ...contraryAuth,
    ];
    return {
      issueId: issue.issueId,
      description: issue.description,
      issueType: issue.issueType,
      supportingEvidenceIds: [...supporting],
      contraryEvidenceIds: [...contrary],
      missingEvidenceIds: missing.map((item) => item.id),
      bindingAuthorityIds: binding,
      contraryAuthorityIds: contraryAuth,
      uncertainty,
      abstainReason,
      provenanceIds,
    };
  });

  const unassignedEvidenceIds = [...evidenceById.keys()].filter((id) => !assigned.has(id));
  const supportingAll = analyzed.flatMap((issue) => issue.supportingEvidenceIds);
  const contraryAll = analyzed.flatMap((issue) => issue.contraryEvidenceIds);
  const hypotheses: TheoryHypothesis[] = [
    {
      id: "hypothesis-system",
      role: "system",
      status: "hypothesis",
      text: analyzed[0]?.description
        ? `Working hypothesis: ${analyzed[0].description}. This is not a finding.`
        : "No working hypothesis. The question did not yield an issue.",
      supportingEvidenceIds: supportingAll,
      contraryEvidenceIds: contraryAll,
      unsupportedAssumptions: params.bundle.missingEvidence.map((item) => item.description),
    },
  ];
  if (params.context.criminalCaseId) {
    hypotheses.push({
      id: "hypothesis-prosecution",
      role: "prosecution",
      status: "hypothesis",
      text: "Prosecution theory is a hypothesis built from supporting evidence. It is not a guilt conclusion.",
      supportingEvidenceIds: supportingAll,
      contraryEvidenceIds: contraryAll,
      unsupportedAssumptions: params.bundle.missingEvidence.map((item) => item.description),
    });
    hypotheses.push({
      id: "hypothesis-defense",
      role: "defense",
      status: "hypothesis",
      text: "Defense theory is an alternative explanation drawn from contrary and missing evidence. It is not a finding.",
      supportingEvidenceIds: contraryAll,
      contraryEvidenceIds: supportingAll,
      unsupportedAssumptions: [],
    });
  } else {
    hypotheses.push({
      id: "hypothesis-party",
      role: "party",
      status: "hypothesis",
      text: "Party theory is a hypothesis. It is not a prediction that a claim or defense succeeds.",
      supportingEvidenceIds: supportingAll,
      contraryEvidenceIds: contraryAll,
      unsupportedAssumptions: params.bundle.missingEvidence.map((item) => item.description),
    });
    hypotheses.push({
      id: "hypothesis-alternative",
      role: "alternative",
      status: "hypothesis",
      text: "Alternative explanation rests on contrary evidence and unresolved authority. It is not a finding.",
      supportingEvidenceIds: contraryAll,
      contraryEvidenceIds: supportingAll,
      unsupportedAssumptions: [],
    });
  }

  return {
    scopeId: params.context.matterId ?? params.context.criminalCaseId ?? null,
    issues: analyzed,
    authorityConflicts,
    hypotheses,
    unassignedEvidenceIds,
    guiltConclusion: null,
    outcomeConclusion: null,
    decisiveConclusion: null,
  };
}

export function formatLongFormAnalysis(params: {
  analysis: WholeMatterAnalysis;
  bundle: LawEvidenceBundle;
}): LongFormAnalysis {
  const evidenceText = new Map(
    [...params.bundle.supportingEvidence, ...params.bundle.contraryEvidence].map((item) => [item.id, clip(item.text)]),
  );
  const missingText = new Map(params.bundle.missingEvidence.map((item) => [item.id, clip(item.description)]));
  const sections: LongFormSection[] = [];
  const abstentions = new Set<string>();
  const uncertainty = new Set<string>();

  for (const issue of params.analysis.issues) {
    if (issue.abstainReason) abstentions.add(issue.abstainReason);
    for (const note of issue.uncertainty) uncertainty.add(note);
    const support = issue.supportingEvidenceIds.map((id) => `${id}: ${evidenceText.get(id) ?? "source text unavailable"}`);
    const against = issue.contraryEvidenceIds.map((id) => `${id}: ${evidenceText.get(id) ?? "source text unavailable"}`);
    const missing = issue.missingEvidenceIds.map((id) => `${id}: ${missingText.get(id) ?? "gap"}`);
    sections.push({
      heading: issue.description,
      issueId: issue.issueId,
      body: [
        `Issue ${issue.issueId} (${issue.issueType}).`,
        support.length ? `Supporting evidence: ${support.join("; ")}.` : "Supporting evidence: none tied to this issue.",
        against.length ? `Contrary evidence: ${against.join("; ")}.` : "Contrary evidence: none tied to this issue.",
        missing.length ? `Missing evidence: ${missing.join("; ")}.` : "Missing evidence: none recorded for this issue.",
        issue.bindingAuthorityIds.length
          ? `Binding authority ids: ${issue.bindingAuthorityIds.join(", ")}.`
          : "Binding authority: none in the record.",
        issue.contraryAuthorityIds.length
          ? `Contrary authority ids: ${issue.contraryAuthorityIds.join(", ")}. Conflict stays unresolved.`
          : "Contrary authority: none in the record.",
        issue.abstainReason ? `Abstention: ${issue.abstainReason}.` : "No abstention code on this issue.",
      ].join(" "),
      sourceIds: issue.provenanceIds,
    });
  }

  sections.push({
    heading: "Contrary evidence",
    issueId: null,
    body:
      params.bundle.contraryEvidence.length > 0
        ? params.bundle.contraryEvidence.map((item) => `${item.id}: ${clip(item.text)}`).join("; ")
        : "No contrary evidence was supplied. Absence of a contrary item is not proof that none exists.",
    sourceIds: params.bundle.contraryEvidence.map((item) => item.id),
  });
  sections.push({
    heading: "Missing evidence",
    issueId: null,
    body:
      params.bundle.missingEvidence.length > 0
        ? params.bundle.missingEvidence.map((item) => `${item.id}: ${clip(item.description)}`).join("; ")
        : "No missing-evidence record was supplied.",
    sourceIds: params.bundle.missingEvidence.map((item) => item.id),
  });
  sections.push({
    heading: "Authority",
    issueId: null,
    body:
      params.analysis.authorityConflicts.length > 0
        ? params.analysis.authorityConflicts
            .map((conflict) => `${conflict.authorityA} and ${conflict.authorityB} conflict. ${conflict.description}`)
            .join(" ")
        : params.analysis.issues.some((issue) => issue.bindingAuthorityIds.length > 0)
          ? "Cited authority is limited to the ids listed on each issue. Treatment and currentness stay as supplied."
          : "Authority coverage is incomplete. Do not treat silence as controlling law.",
    sourceIds: [
      ...new Set(params.analysis.issues.flatMap((issue) => [...issue.bindingAuthorityIds, ...issue.contraryAuthorityIds])),
    ],
  });
  sections.push({
    heading: "Hypotheses",
    issueId: null,
    body: params.analysis.hypotheses.map((item) => `${item.role} (${item.status}): ${item.text}`).join(" "),
    sourceIds: params.analysis.hypotheses.map((item) => item.id),
  });

  const multi = params.analysis.issues.length > 1;
  const blocked =
    abstentions.size > 0 ||
    params.analysis.authorityConflicts.length > 0 ||
    params.bundle.missingEvidence.length > 0 ||
    params.bundle.contraryEvidence.length > 0;
  const shortAnswer = blocked
    ? multi
      ? `This record separates ${params.analysis.issues.length} issues. A decisive conclusion is not supported.`
      : "A decisive conclusion is not supported. Supporting evidence, contrary evidence, missing evidence, and authority limits stay separated."
    : multi
      ? `This record separates ${params.analysis.issues.length} issues. Each issue keeps its own sources.`
      : "The record is organized under one issue. Sources stay attached to that issue.";

  return {
    shortAnswer,
    sections,
    uncertainty: [...uncertainty],
    abstentions: [...abstentions],
    guiltConclusion: null,
    outcomeConclusion: null,
  };
}
