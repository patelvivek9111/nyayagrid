import { isPendingMotionStatus } from "./domain";
import type { MatterMotionsCommunicationsReview } from "./postgres";

export function isMotionsCommunicationsAskQuestion(question: string): boolean {
  return /\b(motion|motions|compel|opposition|reply brief|hearing|ruling|disposition|communication|correspondence|meet[- ]and[- ]confer|MAC|follow[- ]up|letter|email to counsel)\b/i.test(
    question,
  );
}

export type MotionsCommunicationsAskAnswer = {
  motions: Array<{
    id: string;
    title: string;
    motionType: string;
    status: string;
    disposition: string | null;
    filedAt: string | null;
    hearingAt: string | null;
    rulingAt: string | null;
    rulingSummary: string | null;
    relatedClaimIds: string[];
    relatedDeficiencyIds: string[];
    relatedEvidenceIds: string[];
    relatedCommunicationIds: string[];
    documentRoles: string[];
  }>;
  communications: Array<{
    id: string;
    subject: string;
    communicationType: string;
    direction: string;
    status: string;
    occurredAt: string | null;
    summary: string | null;
    followUpNeeded: boolean;
    followUpDueAt: string | null;
    relatedMotionIds: string[];
    relatedDeficiencyIds: string[];
  }>;
  pendingMotionIds: string[];
  explicitDeadlines: Array<{ label: string; at: string; motionId?: string; communicationId?: string }>;
  limitations: string[];
  sanctionsConclusion: null;
  privilegeLegalConclusion: null;
  predictiveOutcome: null;
};

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

export function answerMotionsCommunicationsQuestion(params: {
  review: MatterMotionsCommunicationsReview;
  question: string;
}): MotionsCommunicationsAskAnswer {
  const { review, question } = params;
  const q = question.toLowerCase();

  const linksByMotion = new Map<string, typeof review.motionLinks>();
  for (const link of review.motionLinks) {
    const list = linksByMotion.get(link.motionId) ?? [];
    list.push(link);
    linksByMotion.set(link.motionId, list);
  }
  const docsByMotion = new Map<string, typeof review.motionDocuments>();
  for (const doc of review.motionDocuments) {
    const list = docsByMotion.get(doc.motionId) ?? [];
    list.push(doc);
    docsByMotion.set(doc.motionId, list);
  }
  const linksByComm = new Map<string, typeof review.communicationLinks>();
  for (const link of review.communicationLinks) {
    const list = linksByComm.get(link.communicationId) ?? [];
    list.push(link);
    linksByComm.set(link.communicationId, list);
  }

  let motions = review.motions;
  if (/\bpending\b/i.test(question)) {
    motions = motions.filter((m) => isPendingMotionStatus(m.status));
  }
  if (/\bcompel\b/i.test(question)) {
    motions = motions.filter((m) => /compel/i.test(m.motionType) || /compel/i.test(m.title));
  }
  if (/\bruling|disposition|court (ruled|order)\b/i.test(question)) {
    motions = motions.filter((m) => m.disposition || m.rulingSummary || m.orderDocumentId);
  }

  let communications = review.communications;
  if (/\bmeet[- ]and[- ]confer|MAC\b/i.test(question)) {
    communications = communications.filter((c) => c.communicationType === "MEET_AND_CONFER");
  }
  if (/\bbefore the motion|preced/i.test(question)) {
    const earliestFiled = review.motions
      .map((m) => m.filedAt?.getTime?.() ?? (m.filedAt ? Date.parse(String(m.filedAt)) : null))
      .filter((n): n is number => typeof n === "number" && !Number.isNaN(n))
      .sort((a, b) => a - b)[0];
    if (earliestFiled != null) {
      communications = communications.filter((c) => {
        if (!c.occurredAt) return false;
        const t = c.occurredAt.getTime?.() ?? Date.parse(String(c.occurredAt));
        return !Number.isNaN(t) && t <= earliestFiled;
      });
    }
  }

  const motionRows = motions.map((m) => {
    const links = linksByMotion.get(m.id) ?? [];
    return {
      id: m.id,
      title: m.title,
      motionType: m.motionType,
      status: m.status,
      disposition: m.disposition,
      filedAt: iso(m.filedAt),
      hearingAt: iso(m.hearingAt),
      rulingAt: iso(m.rulingAt),
      rulingSummary: m.rulingSummary,
      relatedClaimIds: links.filter((l) => l.linkType === "CLAIM").map((l) => l.targetId),
      relatedDeficiencyIds: links
        .filter((l) => l.linkType === "DISCOVERY_DEFICIENCY")
        .map((l) => l.targetId),
      relatedEvidenceIds: links.filter((l) => l.linkType === "EVIDENCE").map((l) => l.targetId),
      relatedCommunicationIds: links
        .filter((l) => l.linkType === "COMMUNICATION")
        .map((l) => l.targetId),
      documentRoles: (docsByMotion.get(m.id) ?? []).map((d) => d.role),
    };
  });

  const communicationRows = communications.map((c) => {
    const links = linksByComm.get(c.id) ?? [];
    return {
      id: c.id,
      subject: c.subject,
      communicationType: c.communicationType,
      direction: c.direction,
      status: c.status,
      occurredAt: iso(c.occurredAt),
      summary: c.summary,
      followUpNeeded: c.followUpNeeded,
      followUpDueAt: iso(c.followUpDueAt),
      relatedMotionIds: links.filter((l) => l.linkType === "MOTION").map((l) => l.targetId),
      relatedDeficiencyIds: links
        .filter((l) => l.linkType === "DISCOVERY_DEFICIENCY")
        .map((l) => l.targetId),
    };
  });

  const explicitDeadlines: MotionsCommunicationsAskAnswer["explicitDeadlines"] = [];
  for (const m of review.motions) {
    if (m.oppositionDueAt) {
      explicitDeadlines.push({
        label: "opposition due",
        at: iso(m.oppositionDueAt)!,
        motionId: m.id,
      });
    }
    if (m.replyDueAt) {
      explicitDeadlines.push({ label: "reply due", at: iso(m.replyDueAt)!, motionId: m.id });
    }
    if (m.hearingAt) {
      explicitDeadlines.push({ label: "hearing", at: iso(m.hearingAt)!, motionId: m.id });
    }
  }
  for (const c of review.communications) {
    if (c.followUpDueAt) {
      explicitDeadlines.push({
        label: "communication follow-up due",
        at: iso(c.followUpDueAt)!,
        communicationId: c.id,
      });
    }
  }

  const limitations = [
    "Motion status and disposition are taken only from persisted matter records.",
    "No jurisdictional deadline was calculated; only explicit dates are listed.",
    "Linking a motion to a claim does not mean the court disposed of the entire claim.",
    "Linked evidence supports association only; it does not independently prove the motion.",
  ];
  if (/\bwill (win|succeed)|likely|bad faith|stonewall|favors\b/i.test(q)) {
    limitations.push(
      "The matter record does not establish predictive outcomes, bad faith, or judicial favor.",
    );
  }

  return {
    motions: motionRows,
    communications: communicationRows,
    pendingMotionIds: review.motions.filter((m) => isPendingMotionStatus(m.status)).map((m) => m.id),
    explicitDeadlines,
    limitations,
    sanctionsConclusion: null,
    privilegeLegalConclusion: null,
    predictiveOutcome: null,
  };
}

export function formatMotionsCommunicationsAnswer(answer: MotionsCommunicationsAskAnswer): string {
  const lines = [
    "MOTIONS_COMMUNICATIONS_REVIEW",
    `pending_motions=${answer.pendingMotionIds.length}`,
    `motions=${answer.motions.map((m) => `${m.id}:${m.status}:${m.disposition ?? "none"}`).join("|") || "none"}`,
    `communications=${answer.communications.map((c) => `${c.id}:${c.communicationType}:${c.occurredAt ?? "undated"}`).join("|") || "none"}`,
    `explicit_deadlines=${answer.explicitDeadlines.map((d) => `${d.label}@${d.at}`).join("|") || "none"}`,
    `SANCTIONS_CONCLUSION: null`,
    `PRIVILEGE_LEGAL_CONCLUSION: null`,
    `PREDICTIVE_OUTCOME: null`,
    `LIMITATIONS: ${answer.limitations.join("; ")}`,
  ];
  for (const m of answer.motions) {
    lines.push(
      `MOTION ${m.id} type=${m.motionType} status=${m.status} disposition=${m.disposition ?? "null"} claims=${m.relatedClaimIds.join(",") || "none"} deficiencies=${m.relatedDeficiencyIds.join(",") || "none"} evidence=${m.relatedEvidenceIds.join(",") || "none"} docs=${m.documentRoles.join(",") || "none"} ruling=${m.rulingSummary ?? "null"}`,
    );
  }
  for (const c of answer.communications) {
    lines.push(
      `COMM ${c.id} type=${c.communicationType} at=${c.occurredAt ?? "null"} subject=${c.subject} motions=${c.relatedMotionIds.join(",") || "none"} deficiencies=${c.relatedDeficiencyIds.join(",") || "none"} summary=${c.summary ?? ""}`,
    );
  }
  return lines.join("\n");
}

export function buildMotionsCommunicationsAskContextBlock(params: {
  question: string;
  review: MatterMotionsCommunicationsReview | null | undefined;
}): string | null {
  if (!params.review) return null;
  if (!isMotionsCommunicationsAskQuestion(params.question)) return null;
  if (params.review.motions.length === 0 && params.review.communications.length === 0) return null;
  return formatMotionsCommunicationsAnswer(
    answerMotionsCommunicationsQuestion({
      review: params.review,
      question: params.question,
    }),
  );
}
