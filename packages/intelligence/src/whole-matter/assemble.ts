import type { CivilClaimsReview } from "../civil/claims-model";
import { buildCivilClaimMatrix, buildCivilWholeMatterView } from "../civil/claims-model";
import type { DiscoveryLedgerReview } from "../discovery-ledger/types";
import { openDeficiencies } from "../discovery-ledger/model";
import type { MatterMotionsCommunicationsReview } from "../motions-communications/postgres";
import { isPendingMotionStatus } from "../motions-communications/domain";
import type {
  AuthorityContextItem,
  ClaimCentricView,
  ContradictionRecord,
  DefenseCentricView,
  DiscoveryChainView,
  InvestigateNextItem,
  MatterStatusFlag,
  MotionConvergenceView,
  SourceRef,
  WholeMatterIntelligence,
  WholeMatterStatus,
} from "./types";

export type WholeMatterAssemblyInput = {
  organizationId: string;
  matterId: string;
  civil: CivilClaimsReview | null;
  discovery: DiscoveryLedgerReview | null;
  motionsComms: MatterMotionsCommunicationsReview | null;
  verified?: {
    facts: Array<{ id: string; label: string; value?: string | null; status: string }>;
    events: Array<{
      id: string;
      title: string;
      eventType: string;
      eventDate: Date | string | null;
    }>;
    deadlines: Array<{
      id: string;
      title: string;
      dueAt: Date | string | null;
      dateKind?: string | null;
      status: string;
    }>;
    entities: Array<{ id: string; displayName: string }>;
  } | null;
  tasks?: Array<{
    id: string;
    title: string;
    status: string;
    dueAt: Date | string | null;
  }> | null;
  authorities?: AuthorityContextItem[] | null;
  now?: Date;
};

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function isOverdue(dueAt: Date | string | null | undefined, now: Date): boolean {
  if (!dueAt) return false;
  const t = dueAt instanceof Date ? dueAt.getTime() : Date.parse(String(dueAt));
  return !Number.isNaN(t) && t < now.getTime();
}

function buildClaims(
  civil: CivilClaimsReview | null,
  motionsComms: MatterMotionsCommunicationsReview | null,
  discovery: DiscoveryLedgerReview | null,
): ClaimCentricView[] {
  if (!civil) return [];
  const matrix = buildCivilClaimMatrix(civil);
  return civil.claims
    .filter((c) => c.isCurrent && c.kind !== "COUNTERCLAIM")
    .map((claim) => {
      const rows = matrix.filter((r) => r.parentId === claim.id && r.rowKind !== "defense");
      const motionLinks =
        motionsComms?.motionLinks.filter((l) => l.linkType === "CLAIM" && l.targetId === claim.id) ?? [];
      const motionIds = motionLinks.map((l) => l.motionId);
      const deficiencyIds =
        motionsComms?.motionLinks
          .filter((l) => motionIds.includes(l.motionId) && l.linkType === "DISCOVERY_DEFICIENCY")
          .map((l) => l.targetId) ?? [];
      const fromDiscovery =
        discovery?.deficiencies
          .filter((d) => d.motionId && motionIds.includes(d.motionId))
          .map((d) => d.id) ?? [];
      const openGaps = rows.flatMap((r) => r.missingEvidence.map((m) => m.description));
      for (const el of claim.elements) {
        if (el.status === "NO_EVIDENCE_FOUND" || el.status === "PARTIALLY_SUPPORTED") {
          openGaps.push(`Element "${el.label}" support status=${el.status}`);
        }
      }
      return {
        claimId: claim.id,
        label: claim.label,
        kind: claim.kind,
        supportStatus: claim.supportStatus,
        proceduralStatus: claim.proceduralStatus,
        partyIds: claim.parties.map((p) => p.partyId),
        elementIds: claim.elements.map((e) => e.id),
        supportingEvidenceIds: [
          ...new Set(rows.flatMap((r) => r.supportingEvidenceIds)),
        ],
        contradictingEvidenceIds: [
          ...new Set(rows.flatMap((r) => r.contraryEvidenceIds)),
        ],
        relatedFactIds: claim.elements.flatMap((e) => e.factRelations.map((f) => f.factId)),
        relatedDeficiencyIds: [...new Set([...deficiencyIds, ...fromDiscovery])],
        relatedCommunicationIds:
          motionsComms?.motionLinks
            .filter((l) => motionIds.includes(l.motionId) && l.linkType === "COMMUNICATION")
            .map((l) => l.targetId) ?? [],
        relatedMotionIds: motionIds,
        relatedAuthorityIds: claim.authorities
          .filter((a) => a.sourceSupported)
          .map((a) => a.authorityId),
        relatedTaskIds:
          motionsComms?.motionLinks
            .filter((l) => motionIds.includes(l.motionId) && l.linkType === "TASK")
            .map((l) => l.targetId) ?? [],
        relatedDeadlineIds:
          motionsComms?.motionLinks
            .filter((l) => motionIds.includes(l.motionId) && l.linkType === "DEADLINE_CANDIDATE")
            .map((l) => l.targetId) ?? [],
        openGaps: [...new Set(openGaps)],
        wholeClaimDisposedByMotion: false as const,
      };
    });
}

function buildDefenses(civil: CivilClaimsReview | null): DefenseCentricView[] {
  if (!civil) return [];
  return civil.defenses
    .filter((d) => d.isCurrent)
    .map((defense) => {
      const openGaps: string[] = [];
      if (defense.supportStatus === "NO_EVIDENCE_FOUND" || defense.supportStatus === "PARTIALLY_SUPPORTED") {
        openGaps.push(`Defense support status=${defense.supportStatus}`);
      }
      for (const el of defense.elements) {
        for (const missing of el.missingEvidence) openGaps.push(missing.description);
      }
      return {
        defenseId: defense.id,
        label: defense.label,
        kind: defense.kind,
        supportStatus: defense.supportStatus,
        againstClaimIds: defense.againstClaimIds,
        supportingEvidenceIds: defense.evidence
          .filter((e) => e.role === "SUPPORTS" || e.role === "CORROBORATES")
          .map((e) => e.evidenceId),
        contradictingEvidenceIds: defense.evidence
          .filter((e) => e.role === "UNDERMINES" || e.role === "CONTRADICTS")
          .map((e) => e.evidenceId),
        relatedDeficiencyIds: [],
        relatedMotionIds: [],
        relatedAuthorityIds: defense.authorities
          .filter((a) => a.sourceSupported)
          .map((a) => a.authorityId),
        openGaps,
        established: false as const,
      };
    });
}

function buildDiscoveryChains(
  discovery: DiscoveryLedgerReview | null,
  motionsComms: MatterMotionsCommunicationsReview | null,
): DiscoveryChainView[] {
  if (!discovery) return [];
  return discovery.deficiencies.map((def) => {
    const mac = discovery.meetAndConferIssues.find(
      (m) => m.deficiencyIds.includes(def.id) || m.id === def.meetAndConferId,
    );
    const communicationIds = [
      def.communicationId,
      mac?.communicationId,
      ...(motionsComms?.communicationLinks
        .filter((l) => l.linkType === "DISCOVERY_DEFICIENCY" && l.targetId === def.id)
        .map((l) => l.communicationId) ?? []),
    ].filter((id): id is string => Boolean(id));
    const motionId = def.motionId;
    const motion = motionsComms?.motions.find((m) => m.id === motionId);
    const followUpTaskIds =
      motionsComms?.communicationLinks
        .filter((l) => communicationIds.includes(l.communicationId) && l.linkType === "TASK")
        .map((l) => l.targetId) ?? [];
    const followUpDeadlineIds =
      motionsComms?.motionLinks
        .filter((l) => l.motionId === motionId && l.linkType === "DEADLINE_CANDIDATE")
        .map((l) => l.targetId) ?? [];
    const responseIds = discovery.responses
      .filter((r) => r.itemId === def.itemId)
      .map((r) => r.id);
    return {
      requestItemId: def.itemId,
      responseIds,
      deficiencyId: def.id,
      meetAndConferId: mac?.id ?? def.meetAndConferId,
      communicationIds: [...new Set(communicationIds)],
      motionId,
      rulingDisposition: motion?.disposition ?? null,
      followUpTaskIds: [...new Set(followUpTaskIds)],
      followUpDeadlineIds: [...new Set(followUpDeadlineIds)],
      open: !["RESOLVED", "WITHDRAWN"].includes(def.status),
    };
  });
}

function buildMotions(motionsComms: MatterMotionsCommunicationsReview | null): MotionConvergenceView[] {
  if (!motionsComms) return [];
  return motionsComms.motions.map((motion) => {
    const links = motionsComms.motionLinks.filter((l) => l.motionId === motion.id);
    const docs = motionsComms.motionDocuments.filter((d) => d.motionId === motion.id);
    return {
      motionId: motion.id,
      title: motion.title,
      status: motion.status,
      disposition: motion.disposition,
      pending: isPendingMotionStatus(motion.status),
      relatedClaimIds: links.filter((l) => l.linkType === "CLAIM").map((l) => l.targetId),
      relatedDefenseIds: links.filter((l) => l.linkType === "DEFENSE").map((l) => l.targetId),
      relatedDeficiencyIds: links
        .filter((l) => l.linkType === "DISCOVERY_DEFICIENCY")
        .map((l) => l.targetId),
      relatedCommunicationIds: links
        .filter((l) => l.linkType === "COMMUNICATION")
        .map((l) => l.targetId),
      relatedEvidenceIds: links.filter((l) => l.linkType === "EVIDENCE").map((l) => l.targetId),
      documentRoles: docs.map((d) => d.role),
      hearingAt: iso(motion.hearingAt),
      rulingAt: iso(motion.rulingAt),
      rulingSummary: motion.rulingSummary,
      relatedTaskIds: links.filter((l) => l.linkType === "TASK").map((l) => l.targetId),
      relatedDeadlineIds: links
        .filter((l) => l.linkType === "DEADLINE_CANDIDATE")
        .map((l) => l.targetId),
      disposesEntireClaim: false as const,
    };
  });
}

function buildContradictions(civil: CivilClaimsReview | null): ContradictionRecord[] {
  if (!civil) return [];
  const out: ContradictionRecord[] = [];
  for (const claim of civil.claims.filter((c) => c.isCurrent)) {
    for (const element of claim.elements) {
      const support = element.supportingEvidence.map((e) => e.evidenceId);
      const contrary = element.contraryEvidence.map((e) => e.evidenceId);
      if (support.length > 0 && contrary.length > 0) {
        out.push({
          id: `conflict-${element.id}`,
          kind: "DIRECT_CONFLICT",
          leftId: support[0]!,
          rightId: contrary[0]!,
          description: `Element "${element.label}" has both supporting and contradicting evidence in the matter record.`,
          sources: [
            { kind: "claim", id: claim.id, label: claim.label },
            ...support.map((id) => ({ kind: "evidence" as const, id })),
            ...contrary.map((id) => ({ kind: "evidence" as const, id })),
          ],
          credibilityConclusion: null,
        });
      } else if (element.status === "CONFLICTED") {
        out.push({
          id: `tension-${element.id}`,
          kind: "POTENTIAL_TENSION",
          leftId: element.id,
          rightId: claim.id,
          description: `Element "${element.label}" is marked CONFLICTED in the civil record.`,
          sources: [{ kind: "claim", id: claim.id, label: claim.label }],
          credibilityConclusion: null,
        });
      }
    }
  }
  return out;
}

function buildInvestigateNext(params: {
  claims: ClaimCentricView[];
  defenses: DefenseCentricView[];
  contradictions: ContradictionRecord[];
  discoveryChains: DiscoveryChainView[];
  motions: MotionConvergenceView[];
  authorities: AuthorityContextItem[];
  tasks: WholeMatterIntelligence["tasks"];
  openDeficiencyIds: string[];
}): InvestigateNextItem[] {
  const items: InvestigateNextItem[] = [];
  let n = 0;
  const push = (item: Omit<InvestigateNextItem, "id" | "predictiveOutcome">) => {
    n += 1;
    items.push({ ...item, id: `inv-${n}`, predictiveOutcome: null });
  };

  for (const claim of params.claims) {
    for (const gap of claim.openGaps.slice(0, 3)) {
      push({
        priority: "high",
        title: `Close evidence gap on ${claim.label}`,
        why: gap,
        triggeredBy: [{ kind: "claim", id: claim.claimId, label: claim.label }],
        resolvesIf: "Add source-backed evidence or record that the element remains unsupported after review.",
      });
    }
  }
  for (const c of params.contradictions) {
    push({
      priority: "high",
      title: "Investigate recorded evidentiary conflict",
      why: c.description,
      triggeredBy: c.sources,
      resolvesIf: "Attorney reviews both sources and records which proposition is adopted, withdrawn, or left unresolved.",
    });
  }
  for (const chain of params.discoveryChains.filter((d) => d.open)) {
    push({
      priority: "high",
      title: "Resolve open discovery deficiency",
      why: `Deficiency ${chain.deficiencyId} remains open in the ledger.`,
      triggeredBy: chain.deficiencyId
        ? [{ kind: "discovery_deficiency", id: chain.deficiencyId }]
        : [],
      resolvesIf: "Complete production, withdraw the deficiency, or record a court ruling resolving it.",
    });
    if (chain.communicationIds.length > 0 && !chain.motionId) {
      push({
        priority: "medium",
        title: "Track post-MAC follow-up without motion",
        why: "Meet-and-confer/communication exists but no linked motion is recorded.",
        triggeredBy: chain.communicationIds.map((id) => ({
          kind: "communication" as const,
          id,
        })),
        resolvesIf: "Record supplementation completion or escalate with a persisted motion link.",
      });
    }
  }
  for (const motion of params.motions.filter((m) => m.pending)) {
    push({
      priority: "medium",
      title: `Monitor pending motion: ${motion.title}`,
      why: `Status ${motion.status} with no terminal disposition.`,
      triggeredBy: [{ kind: "motion", id: motion.motionId, label: motion.title }],
      resolvesIf: "Record hearing, ruling/disposition, or withdrawal from a source-backed order.",
    });
  }
  for (const motion of params.motions.filter((m) => m.disposition === "GRANTED_IN_PART")) {
    if (motion.relatedDeadlineIds.length === 0 && motion.relatedTaskIds.length === 0) {
      push({
        priority: "medium",
        title: `Confirm follow-up after partial grant: ${motion.title}`,
        why: "Order grants in part but no explicit follow-up task/deadline is linked.",
        triggeredBy: [{ kind: "motion", id: motion.motionId, label: motion.title }],
        resolvesIf: "Link the explicit production deadline or completion task from the order.",
      });
    }
  }
  for (const auth of params.authorities.filter((a) => a.resolution === "IDENTITY_UNRESOLVED")) {
    push({
      priority: "medium",
      title: "Resolve authority identity",
      why: `Authority ${auth.citation ?? auth.id} remains IDENTITY_UNRESOLVED.`,
      triggeredBy: [{ kind: "authority", id: auth.id, label: auth.citation }],
      resolvesIf: "Resolve citation identity through the product citation resolver with source-backed match.",
    });
  }
  for (const task of params.tasks.filter((t) => t.overdue && t.status !== "completed")) {
    push({
      priority: "high",
      title: `Overdue task: ${task.title}`,
      why: "Explicit due date has passed without completion.",
      triggeredBy: [{ kind: "task", id: task.id, label: task.title }],
      resolvesIf: "Complete the task or update the explicit due date from a source-backed change.",
    });
  }

  return items.slice(0, 25);
}

function buildStatus(params: {
  claims: ClaimCentricView[];
  discoveryChains: DiscoveryChainView[];
  motions: MotionConvergenceView[];
  openDeficiencyIds: string[];
  tasks: WholeMatterIntelligence["tasks"];
  authorities: AuthorityContextItem[];
  communications: WholeMatterIntelligence["communications"];
}): WholeMatterStatus {
  const flags: MatterStatusFlag[] = [];
  if (params.claims.some((c) => c.proceduralStatus !== "RESOLVED" && c.proceduralStatus !== "DISMISSED")) {
    flags.push("CLAIMS_ACTIVE");
  }
  if (params.discoveryChains.some((c) => c.open)) flags.push("DISCOVERY_OPEN");
  if (params.openDeficiencyIds.length > 0) flags.push("DEFICIENCIES_OUTSTANDING");
  if (params.motions.some((m) => m.pending)) flags.push("MOTION_PENDING");
  if (params.motions.some((m) => m.disposition)) flags.push("MOTION_RULED");
  if (
    params.communications.some(
      (c) =>
        c.communicationType === "MEET_AND_CONFER" &&
        /supplement/i.test(c.subject) === false &&
        Boolean(c.followUpDueAt),
    ) ||
    params.communications.some((c) => /supplement/i.test(c.subject) && c.followUpDueAt)
  ) {
    flags.push("SUPPLEMENT_PROMISED");
  }
  if (params.tasks.some((t) => t.overdue)) flags.push("TASK_OVERDUE");
  if (params.authorities.some((a) => a.resolution === "IDENTITY_UNRESOLVED")) {
    flags.push("AUTHORITY_UNRESOLVED");
  }
  if (params.claims.some((c) => c.openGaps.length > 0)) flags.push("EVIDENCE_GAP");
  if (params.communications.some((c) => c.followUpDueAt)) flags.push("COMMUNICATION_FOLLOW_UP");

  const summaryLines = [
    `${params.claims.length} current claim(s)`,
    `${params.openDeficiencyIds.length} open deficiency(ies)`,
    `${params.motions.filter((m) => m.pending).length} pending motion(s)`,
    `${params.motions.filter((m) => m.disposition).length} decided motion(s)`,
    `${params.tasks.filter((t) => t.status !== "completed").length} open task(s)`,
  ];

  return {
    flags: [...new Set(flags)],
    summaryLines,
    liabilityConclusion: null,
    outcomeConclusion: null,
    predictiveOutcome: null,
  };
}

/** Pure assembler — no DB I/O. */
export function assembleWholeMatterIntelligence(
  input: WholeMatterAssemblyInput,
): WholeMatterIntelligence {
  const now = input.now ?? new Date();
  const civil = input.civil;
  const discovery = input.discovery;
  const motionsComms = input.motionsComms;
  const verified = input.verified ?? null;
  const authorities = input.authorities ?? [];

  const claims = buildClaims(civil, motionsComms, discovery);
  const defenses = buildDefenses(civil);
  const discoveryChains = buildDiscoveryChains(discovery, motionsComms);
  const motions = buildMotions(motionsComms);
  const contradictions = buildContradictions(civil);
  const openDeficiencyIds = discovery ? openDeficiencies(discovery).map((d) => d.id) : [];

  const tasks = (input.tasks ?? []).map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    dueAt: iso(t.dueAt),
    overdue: t.status !== "completed" && isOverdue(t.dueAt, now),
  }));

  const deadlines = (verified?.deadlines ?? []).map((d) => ({
    id: d.id,
    title: d.title,
    dueAt: iso(d.dueAt),
    explicit: d.dateKind === "explicit" || d.dateKind == null,
    overdue: d.status !== "completed" && isOverdue(d.dueAt, now),
  }));

  const communications =
    motionsComms?.communications.map((c) => {
      const links = motionsComms.communicationLinks.filter((l) => l.communicationId === c.id);
      return {
        id: c.id,
        subject: c.subject,
        communicationType: c.communicationType,
        occurredAt: iso(c.occurredAt),
        relatedMotionIds: links.filter((l) => l.linkType === "MOTION").map((l) => l.targetId),
        relatedDeficiencyIds: links
          .filter((l) => l.linkType === "DISCOVERY_DEFICIENCY")
          .map((l) => l.targetId),
        followUpDueAt: iso(c.followUpDueAt),
      };
    }) ?? [];

  const timeline: WholeMatterIntelligence["timeline"] = (
    verified?.events.map((e) => ({
      id: e.id,
      title: e.title,
      eventType: e.eventType,
      eventDate: iso(e.eventDate),
      dateKind: "event" as const,
    })) ?? []
  );
  // Append motion/communication explicit-date events without inventing dates.
  for (const m of motionsComms?.motions ?? []) {
    if (m.filedAt) {
      timeline.push({
        id: `motion-filed-${m.id}`,
        title: `Motion filed: ${m.title}`,
        eventType: "motion_filed",
        eventDate: iso(m.filedAt),
        dateKind: "filing",
      });
    }
    if (m.rulingAt) {
      timeline.push({
        id: `motion-ruled-${m.id}`,
        title: `Motion ruled: ${m.title}`,
        eventType: "motion_ruled",
        eventDate: iso(m.rulingAt),
        dateKind: "event",
      });
    }
  }
  for (const c of motionsComms?.communications ?? []) {
    if (c.occurredAt) {
      timeline.push({
        id: `comm-${c.id}`,
        title: c.subject,
        eventType: c.communicationType === "MEET_AND_CONFER" ? "meet_and_confer" : "communication",
        eventDate: iso(c.occurredAt),
        dateKind: "event",
      });
    }
  }
  for (const d of verified?.deadlines ?? []) {
    if (d.dueAt && d.dateKind === "explicit") {
      timeline.push({
        id: `deadline-${d.id}`,
        title: d.title,
        eventType: "deadline",
        eventDate: iso(d.dueAt),
        dateKind: "due",
      });
    }
  }
  for (const t of tasks ?? []) {
    if (t.dueAt) {
      timeline.push({
        id: `task-due-${t.id}`,
        title: t.title,
        eventType: "task_due",
        eventDate: iso(t.dueAt),
        dateKind: "due",
      });
    }
  }
  timeline.sort((a, b) => {
    const ta = a.eventDate ? Date.parse(a.eventDate) : Number.POSITIVE_INFINITY;
    const tb = b.eventDate ? Date.parse(b.eventDate) : Number.POSITIVE_INFINITY;
    if (ta !== tb) return ta - tb;
    return a.id.localeCompare(b.id);
  });

  const propositions: WholeMatterIntelligence["propositions"] = [];
  if (civil) {
    for (const claim of civil.claims.filter((c) => c.isCurrent)) {
      for (const el of claim.elements) {
        propositions.push({
          id: el.id,
          kind: el.missingEvidence.length > 0 ? "element_gap" : "fact",
          label: `${claim.label} / ${el.label}`,
          supportingSourceIds: el.supportingEvidence.map((e) => e.evidenceId),
          contradictingSourceIds: el.contraryEvidence.map((e) => e.evidenceId),
          relationHints: [
            ...(el.supportingEvidence.length ? (["SUPPORTS"] as const) : []),
            ...(el.contraryEvidence.length ? (["CONTRADICTS"] as const) : []),
          ],
          relatedClaimIds: [claim.id],
          relatedDefenseIds: [],
          status: el.status,
        });
      }
    }
  }
  for (const fact of verified?.facts ?? []) {
    propositions.push({
      id: fact.id,
      kind: "fact",
      label: fact.value ? `${fact.label}: ${fact.value}` : fact.label,
      supportingSourceIds: [],
      contradictingSourceIds: [],
      relationHints: ["RELATED"],
      relatedClaimIds: [],
      relatedDefenseIds: [],
      status: fact.status,
    });
  }

  const investigateNext = buildInvestigateNext({
    claims,
    defenses,
    contradictions,
    discoveryChains,
    motions,
    authorities,
    tasks,
    openDeficiencyIds,
  });

  const status = buildStatus({
    claims,
    discoveryChains,
    motions,
    openDeficiencyIds,
    tasks,
    authorities,
    communications,
  });

  const parties =
    civil?.parties.map((p) => ({ id: p.id, displayName: p.displayName })) ??
    verified?.entities.map((e) => ({ id: e.id, displayName: e.displayName })) ??
    [];

  const sourceRefs: SourceRef[] = [];
  for (const c of claims) sourceRefs.push({ kind: "claim", id: c.claimId, label: c.label });
  for (const d of openDeficiencyIds) sourceRefs.push({ kind: "discovery_deficiency", id: d });
  for (const m of motions) sourceRefs.push({ kind: "motion", id: m.motionId, label: m.title });
  for (const c of communications) sourceRefs.push({ kind: "communication", id: c.id, label: c.subject });

  const civilWhole = civil ? buildCivilWholeMatterView(civil) : null;

  return {
    organizationId: input.organizationId,
    matterId: input.matterId,
    assembledAt: now.toISOString(),
    status,
    parties,
    claims,
    defenses,
    propositions,
    contradictions,
    discoveryChains,
    openDeficiencyIds,
    motions,
    communications,
    tasks,
    deadlines,
    timeline,
    authorities,
    investigateNext,
    limitations: [
      "Whole-matter intelligence is derived from persisted records only.",
      "Linked evidence does not independently prove a claim element.",
      "A motion linked to a claim does not mean the court disposed of the entire claim.",
      "No jurisdictional deadlines were calculated; only explicit dates are listed.",
      "Authority treatment remains unverified unless a source marks it verified.",
      "No predictive win/loss, credibility, or liability conclusions are offered.",
      ...(civilWhole?.uncertainty ?? []),
    ],
    sourceRefs,
    liabilityConclusion: null,
    outcomeConclusion: null,
    predictiveOutcome: null,
  };
}
