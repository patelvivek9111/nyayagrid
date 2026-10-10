import type { WholeMatterIntelligence } from "./types";

/** Ranked Ask context budgets — structured summaries, not full-ledger dumps. */
const ASK_LIMITS = {
  claims: 24,
  defenses: 16,
  motions: 24,
  communications: 24,
  contradictions: 12,
  authorities: 16,
  investigateNext: 12,
  discoveryGaps: 24,
  deadlinesTasks: 24,
} as const;

export function isWholeMatterAskQuestion(question: string): boolean {
  return /\b(complete status|whole matter|matter status|status of this matter|strongest and weakest|investigate next|what should we (investigate|do) next|cross[- ]domain|overall matter|matter overview|gaps remain|what remains unresolved|authorities apply|facts are still unsupported|communications led to|discovery gaps|evidence supports each element|contradictions should|deadlines\/tasks remain|unsupported)\b/i.test(
    question,
  );
}

export type WholeMatterAskAnswer = {
  question: string;
  statusFlags: string[];
  summaryLines: string[];
  claims: Array<{ id: string; label: string; supportStatus: string; openGaps: string[] }>;
  defenses: Array<{ id: string; label: string; supportStatus: string }>;
  discoveryGaps: string[];
  motions: Array<{ id: string; title: string; status: string; disposition: string | null }>;
  communications: Array<{ id: string; subject: string; occurredAt: string | null }>;
  contradictions: Array<{ id: string; kind: string; description: string }>;
  deadlinesTasks: string[];
  authorities: Array<{ id: string; citation: string | null; resolution: string }>;
  investigateNext: Array<{ id: string; title: string; why: string; resolvesIf: string }>;
  limitations: string[];
  liabilityConclusion: null;
  outcomeConclusion: null;
  predictiveOutcome: null;
  credibilityConclusion: null;
};

export function answerWholeMatterQuestion(params: {
  intelligence: WholeMatterIntelligence;
  question: string;
}): WholeMatterAskAnswer {
  const { intelligence: wm, question } = params;
  const q = question.toLowerCase();

  let claims = wm.claims;
  let defenses = wm.defenses;
  let motions = wm.motions;
  let communications = wm.communications;
  let investigateNext = wm.investigateNext;
  let authorities = wm.authorities;
  let contradictions = wm.contradictions;

  if (/\bclaim a\b|claim-?a\b|breach\b/i.test(question)) {
    claims = claims.filter((c) => /breach|claim a|supply/i.test(c.label));
    if (claims.length === 0) claims = wm.claims.slice(0, 1);
  }
  if (/\bdefense\b/i.test(question) && !/\bclaim\b/i.test(question)) {
    // keep defenses focus
  }
  if (/\bpending\b/i.test(question)) {
    motions = motions.filter((m) => m.pending);
  }
  if (/\bruling|disposition|court (ruled|order)\b/i.test(question)) {
    motions = motions.filter((m) => m.disposition || m.rulingSummary);
  }
  if (/\bcommunication|meet[- ]and[- ]confer|MAC\b/i.test(question)) {
    // keep communications
  } else if (/\bmotion\b/i.test(question) && !/\bcomplete status|whole matter|matter status\b/i.test(question)) {
    communications = communications.filter((c) =>
      motions.some((m) => m.relatedCommunicationIds.includes(c.id) || c.relatedMotionIds.includes(m.motionId)),
    );
  }
  if (/\binvestigate next|should we (investigate|do) next\b/i.test(question)) {
    investigateNext = wm.investigateNext;
  }
  if (/\bauthority|authorities\b/i.test(question)) {
    authorities = wm.authorities;
  }
  if (/\bcontradict/i.test(question)) {
    contradictions = wm.contradictions;
  }

  if (/\bwill (win|lose)|judge will|witness is lying|definitely fails|you will win\b/i.test(q)) {
    // abstain path — still return structured nulls
  }

  const rankedMotions = [...motions].sort((a, b) => {
    const rank = (m: (typeof motions)[number]) =>
      (m.pending ? 0 : 2) + (m.disposition ? 0 : 1) + (m.relatedDeficiencyIds.length > 0 ? 0 : 1);
    return rank(a) - rank(b);
  });
  const rankedCommunications = [...communications].sort((a, b) => {
    const aScore =
      (a.relatedMotionIds.length > 0 ? 0 : 2) + (a.relatedDeficiencyIds.length > 0 ? 0 : 1);
    const bScore =
      (b.relatedMotionIds.length > 0 ? 0 : 2) + (b.relatedDeficiencyIds.length > 0 ? 0 : 1);
    return aScore - bScore || (b.occurredAt ?? "").localeCompare(a.occurredAt ?? "");
  });
  const rankedInvestigate = [...investigateNext].sort((a, b) => {
    const p = { high: 0, medium: 1, low: 2 };
    return p[a.priority] - p[b.priority];
  });

  const discoveryGaps = [
    ...wm.openDeficiencyIds.map((id) => `Open deficiency ${id}`),
    ...wm.discoveryChains
      .filter((c) => c.open)
      .map((c) => `Open chain deficiency=${c.deficiencyId} motion=${c.motionId ?? "none"}`),
  ].slice(0, ASK_LIMITS.discoveryGaps);

  const deadlinesTasks = [
    ...wm.deadlines
      .filter((d) => d.explicit)
      .sort((a, b) => Number(b.overdue) - Number(a.overdue))
      .map((d) => `Deadline ${d.title} due=${d.dueAt ?? "unknown"}${d.overdue ? " OVERDUE" : ""}`),
    ...wm.tasks
      .sort((a, b) => Number(b.overdue) - Number(a.overdue))
      .map(
        (t) => `Task ${t.title} status=${t.status} due=${t.dueAt ?? "none"}${t.overdue ? " OVERDUE" : ""}`,
      ),
  ].slice(0, ASK_LIMITS.deadlinesTasks);

  const limitations = [...wm.limitations];
  if (/\bwill (win|lose)|judge will|lying|definitely\b/i.test(q)) {
    limitations.push(
      "The matter record does not establish predictive outcomes, judicial favor, or witness credibility conclusions.",
    );
  }
  if (/\bclaim\b/i.test(question) && /\bmotion|ruling\b/i.test(question)) {
    limitations.push(
      "Linking a motion to a claim does not mean the court disposed of the entire claim.",
    );
  }
  limitations.push(
    "Ask context is ranked and bounded; drill down via whole-matter intelligence API for full ledgers.",
  );

  return {
    question,
    statusFlags: wm.status.flags,
    summaryLines: wm.status.summaryLines,
    claims: claims.slice(0, ASK_LIMITS.claims).map((c) => ({
      id: c.claimId,
      label: c.label,
      supportStatus: c.supportStatus,
      openGaps: c.openGaps,
    })),
    defenses: defenses.slice(0, ASK_LIMITS.defenses).map((d) => ({
      id: d.defenseId,
      label: d.label,
      supportStatus: d.supportStatus,
    })),
    discoveryGaps,
    motions: rankedMotions.slice(0, ASK_LIMITS.motions).map((m) => ({
      id: m.motionId,
      title: m.title,
      status: m.status,
      disposition: m.disposition,
    })),
    communications: rankedCommunications.slice(0, ASK_LIMITS.communications).map((c) => ({
      id: c.id,
      subject: c.subject,
      occurredAt: c.occurredAt,
    })),
    contradictions: contradictions.slice(0, ASK_LIMITS.contradictions).map((c) => ({
      id: c.id,
      kind: c.kind,
      description: c.description,
    })),
    deadlinesTasks,
    authorities: authorities.slice(0, ASK_LIMITS.authorities).map((a) => ({
      id: a.id,
      citation: a.citation,
      resolution: a.resolution,
    })),
    investigateNext: rankedInvestigate.slice(0, ASK_LIMITS.investigateNext).map((i) => ({
      id: i.id,
      title: i.title,
      why: i.why,
      resolvesIf: i.resolvesIf,
    })),
    limitations,
    liabilityConclusion: null,
    outcomeConclusion: null,
    predictiveOutcome: null,
    credibilityConclusion: null,
  };
}

export function formatWholeMatterAnswer(answer: WholeMatterAskAnswer): string {
  return [
    "WHOLE_MATTER_INTELLIGENCE",
    `QUESTION: ${answer.question}`,
    `STATUS_FLAGS: ${answer.statusFlags.join(",") || "none"}`,
    `SUMMARY: ${answer.summaryLines.join(" | ")}`,
    "CLAIMS:",
    ...(answer.claims.length
      ? answer.claims.map(
          (c) =>
            `- ${c.id} ${c.label} support=${c.supportStatus} gaps=${c.openGaps.join(";") || "none"}`,
        )
      : ["- (none)"]),
    "DEFENSES:",
    ...(answer.defenses.length
      ? answer.defenses.map((d) => `- ${d.id} ${d.label} support=${d.supportStatus}`)
      : ["- (none)"]),
    "DISCOVERY_GAPS:",
    ...(answer.discoveryGaps.length ? answer.discoveryGaps.map((g) => `- ${g}`) : ["- (none)"]),
    "MOTIONS:",
    ...(answer.motions.length
      ? answer.motions.map(
          (m) => `- ${m.id} ${m.title} status=${m.status} disposition=${m.disposition ?? "none"}`,
        )
      : ["- (none)"]),
    "COMMUNICATIONS:",
    ...(answer.communications.length
      ? answer.communications.map((c) => `- ${c.id} ${c.occurredAt ?? "undated"} ${c.subject}`)
      : ["- (none)"]),
    "CONTRADICTIONS:",
    ...(answer.contradictions.length
      ? answer.contradictions.map((c) => `- ${c.id} [${c.kind}] ${c.description}`)
      : ["- (none)"]),
    "DEADLINES_TASKS:",
    ...(answer.deadlinesTasks.length ? answer.deadlinesTasks.map((d) => `- ${d}`) : ["- (none)"]),
    "AUTHORITIES:",
    ...(answer.authorities.length
      ? answer.authorities.map((a) => `- ${a.id} ${a.citation ?? "n/a"} resolution=${a.resolution}`)
      : ["- (none)"]),
    "INVESTIGATE_NEXT:",
    ...(answer.investigateNext.length
      ? answer.investigateNext.map((i) => `- ${i.id} ${i.title} WHY=${i.why} RESOLVES_IF=${i.resolvesIf}`)
      : ["- (none)"]),
    `LIMITATIONS: ${answer.limitations.join("; ")}`,
    "LIABILITY_CONCLUSION: null",
    "OUTCOME_CONCLUSION: null",
    "PREDICTIVE_OUTCOME: null",
    "CREDIBILITY_CONCLUSION: null",
  ].join("\n");
}

export function buildWholeMatterAskContextBlock(params: {
  question: string;
  intelligence: WholeMatterIntelligence | null | undefined;
}): string | null {
  if (!params.intelligence) return null;
  if (!isWholeMatterAskQuestion(params.question)) return null;
  return formatWholeMatterAnswer(
    answerWholeMatterQuestion({
      intelligence: params.intelligence,
      question: params.question,
    }),
  );
}
