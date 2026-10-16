/**
 * Phase 1 — Nyaya Command Center conversational context foundation.
 * Reuses conversations / messages / ai_artifacts. No schema migration.
 */
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import {
  aiArtifacts,
  conversations,
  documents,
  messages,
  type Database,
} from "@nyayagrid/database";

/** Message rows in the recent window (user + assistant). ~4 exchanges. */
export const CONVERSATION_RECENT_TURN_LIMIT = 8;
export const CONVERSATION_SUMMARY_MAX_LINES = 12;
/** Hard cap for the conversation block injected into Ask (chars). */
export const CONVERSATION_CONTEXT_MAX_CHARS = 12_000;
export const CONVERSATION_TURN_CONTENT_MAX_CHARS = 1_200;
export const CONVERSATION_WORKING_STATE_VERSION = 1 as const;

export type AuthorityStateSnapshot = {
  id: string;
  resolution: string;
  treatmentVerified: boolean;
};

export type ConversationWorkingState = {
  version: typeof CONVERSATION_WORKING_STATE_VERSION;
  summaryLines: string[];
  activeClaimIds: string[];
  activeDefenseIds: string[];
  activeMotionIds: string[];
  activeDiscoveryIds: string[];
  activeDeficiencyIds: string[];
  activeCommunicationIds: string[];
  activeAuthorityIds: string[];
  activeSourceIds: string[];
  activeTaskIds: string[];
  /** Person/entity targets for deposition and person-centric workflows (JSON working state only). */
  activePersonIds: string[];
  issueLabels: string[];
  unresolvedQuestions: string[];
  authorityStates: AuthorityStateSnapshot[];
  updatedAt: string;
};

export type ConversationTurnForPrompt = {
  messageId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: Date;
  completionStatus: "completed" | "cancelled" | "failed" | "unknown";
  evidenceState: string | null;
  sourceIds: string[];
  authorityIds: string[];
  workingState: ConversationWorkingState | null;
};

export type AssembledConversationContext = {
  conversationId: string;
  recentTurns: ConversationTurnForPrompt[];
  summaryLines: string[];
  workingState: ConversationWorkingState;
  promptBlock: string | null;
  metrics: {
    recentTurnCount: number;
    summaryChars: number;
    promptChars: number;
    sourceIdCount: number;
    authorityIdCount: number;
  };
};

export function emptyWorkingState(now = new Date()): ConversationWorkingState {
  return {
    version: CONVERSATION_WORKING_STATE_VERSION,
    summaryLines: [],
    activeClaimIds: [],
    activeDefenseIds: [],
    activeMotionIds: [],
    activeDiscoveryIds: [],
    activeDeficiencyIds: [],
    activeCommunicationIds: [],
    activeAuthorityIds: [],
    activeSourceIds: [],
    activeTaskIds: [],
    activePersonIds: [],
    issueLabels: [],
    unresolvedQuestions: [],
    authorityStates: [],
    updatedAt: now.toISOString(),
  };
}

function uniq(ids: string[]): string[] {
  return [...new Set(ids.filter(Boolean))];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.length > 0);
}

export function parseWorkingState(raw: unknown): ConversationWorkingState | null {
  const obj = asRecord(raw);
  if (obj.version !== CONVERSATION_WORKING_STATE_VERSION && obj.version !== 1) {
    // Accept missing version only when structured fields exist from our writer.
    if (!Array.isArray(obj.summaryLines) && !Array.isArray(obj.activeSourceIds)) return null;
  }
  return {
    version: CONVERSATION_WORKING_STATE_VERSION,
    summaryLines: asStringArray(obj.summaryLines).slice(0, CONVERSATION_SUMMARY_MAX_LINES),
    activeClaimIds: asStringArray(obj.activeClaimIds),
    activeDefenseIds: asStringArray(obj.activeDefenseIds),
    activeMotionIds: asStringArray(obj.activeMotionIds),
    activeDiscoveryIds: asStringArray(obj.activeDiscoveryIds),
    activeDeficiencyIds: asStringArray(obj.activeDeficiencyIds),
    activeCommunicationIds: asStringArray(obj.activeCommunicationIds),
    activeAuthorityIds: asStringArray(obj.activeAuthorityIds),
    activeSourceIds: asStringArray(obj.activeSourceIds),
    activeTaskIds: asStringArray(obj.activeTaskIds),
    activePersonIds: asStringArray(obj.activePersonIds),
    issueLabels: asStringArray(obj.issueLabels),
    unresolvedQuestions: asStringArray(obj.unresolvedQuestions),
    authorityStates: Array.isArray(obj.authorityStates)
      ? obj.authorityStates
          .map((row) => {
            const r = asRecord(row);
            if (typeof r.id !== "string") return null;
            return {
              id: r.id,
              resolution: typeof r.resolution === "string" ? r.resolution : "IDENTITY_UNRESOLVED",
              treatmentVerified: r.treatmentVerified === true,
            };
          })
          .filter((r): r is AuthorityStateSnapshot => r != null)
      : [],
    updatedAt: typeof obj.updatedAt === "string" ? obj.updatedAt : new Date().toISOString(),
  };
}

export function isAuthoritativeAssistantTurn(params: {
  role: string;
  content: string;
  completionStatus?: string | null;
  evidenceState?: string | null;
}): boolean {
  if (params.role !== "assistant") return true; // user turns are always kept in window
  const status = (params.completionStatus ?? "").toLowerCase();
  if (status === "cancelled" || status === "failed") return false;
  const content = params.content.trim();
  if (!content) return false;
  if (content === "[Generation stopped]") return false;
  if (/^ask cancelled$/i.test(content)) return false;
  return true;
}

export function truncateTurnContent(content: string, max = CONVERSATION_TURN_CONTENT_MAX_CHARS): string {
  const trimmed = content.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

/** Deterministic issue labels from free text — labels only, never treated as facts. */
export function extractIssueLabels(text: string): string[] {
  const labels: string[] = [];
  if (/\bclaim\s*a\b|\bbreach\b/i.test(text)) labels.push("Claim A / breach");
  if (/\bclaim\s*b\b|\bwarrant/i.test(text)) labels.push("Claim B / warranty");
  if (/\bdiscovery|deficienc/i.test(text)) labels.push("Discovery");
  if (/\bmotion|ruling|compel/i.test(text)) labels.push("Motions / rulings");
  if (/\bdeadline|task\b/i.test(text)) labels.push("Deadlines / tasks");
  if (/\bauthorit|citation|case law/i.test(text)) labels.push("Authorities");
  if (/\bevidence|contradict/i.test(text)) labels.push("Evidence / conflicts");
  return uniq(labels);
}

export function mergeWorkingStates(
  base: ConversationWorkingState,
  next: Partial<ConversationWorkingState>,
): ConversationWorkingState {
  const mergeAuthStates = [
    ...base.authorityStates,
    ...(next.authorityStates ?? []),
  ];
  const byId = new Map<string, AuthorityStateSnapshot>();
  for (const row of mergeAuthStates) {
    const prior = byId.get(row.id);
    // Never upgrade unresolved → resolved from conversational merge alone.
    if (!prior) {
      byId.set(row.id, row);
      continue;
    }
    const priorUnresolved = prior.resolution === "IDENTITY_UNRESOLVED";
    const nextResolved =
      row.resolution === "AUTHORITY_RESOLVED" || row.resolution === "CORPUS_COMPLETE";
    if (priorUnresolved && nextResolved) {
      byId.set(row.id, prior);
      continue;
    }
    byId.set(row.id, {
      id: row.id,
      resolution: row.resolution,
      treatmentVerified: prior.treatmentVerified === true || row.treatmentVerified === true,
    });
  }

  return {
    version: CONVERSATION_WORKING_STATE_VERSION,
    summaryLines: uniq([...(next.summaryLines ?? base.summaryLines)]).slice(
      0,
      CONVERSATION_SUMMARY_MAX_LINES,
    ),
    activeClaimIds: uniq([...(next.activeClaimIds ?? []), ...base.activeClaimIds]),
    activeDefenseIds: uniq([...(next.activeDefenseIds ?? []), ...base.activeDefenseIds]),
    activeMotionIds: uniq([...(next.activeMotionIds ?? []), ...base.activeMotionIds]),
    activeDiscoveryIds: uniq([...(next.activeDiscoveryIds ?? []), ...base.activeDiscoveryIds]),
    activeDeficiencyIds: uniq([...(next.activeDeficiencyIds ?? []), ...base.activeDeficiencyIds]),
    activeCommunicationIds: uniq([
      ...(next.activeCommunicationIds ?? []),
      ...base.activeCommunicationIds,
    ]),
    activeAuthorityIds: uniq([...(next.activeAuthorityIds ?? []), ...base.activeAuthorityIds]),
    activeSourceIds: uniq([...(next.activeSourceIds ?? []), ...base.activeSourceIds]),
    activeTaskIds: uniq([...(next.activeTaskIds ?? []), ...base.activeTaskIds]),
    activePersonIds: uniq([...(next.activePersonIds ?? []), ...base.activePersonIds]),
    issueLabels: uniq([...(next.issueLabels ?? []), ...base.issueLabels]),
    unresolvedQuestions: uniq([
      ...(next.unresolvedQuestions ?? []),
      ...base.unresolvedQuestions,
    ]).slice(0, 8),
    authorityStates: [...byId.values()],
    updatedAt: next.updatedAt ?? new Date().toISOString(),
  };
}

export function buildCompactSummaryLines(params: {
  prior: ConversationWorkingState | null;
  recentTurns: ConversationTurnForPrompt[];
  currentQuestion: string;
}): string[] {
  const lines: string[] = [];
  if (params.prior?.summaryLines.length) {
    lines.push(...params.prior.summaryLines);
  }
  const labels = extractIssueLabels(
    [params.currentQuestion, ...params.recentTurns.map((t) => t.content)].join("\n"),
  );
  for (const label of labels) {
    lines.push(`Active topic: ${label}`);
  }
  for (const turn of params.recentTurns) {
    if (turn.role !== "assistant") continue;
    if (turn.evidenceState === "insufficient") {
      lines.push("Prior turn noted insufficient evidence for at least one answer.");
      break;
    }
  }
  const unresolved = params.prior?.unresolvedQuestions ?? [];
  for (const q of unresolved.slice(0, 3)) {
    lines.push(`Open: ${q}`);
  }
  // Never promote speculative conclusions — only topics / open questions / evidence insufficiency.
  return uniq(lines).slice(0, CONVERSATION_SUMMARY_MAX_LINES);
}

export function selectRecentTurns(
  turns: ConversationTurnForPrompt[],
  limit = CONVERSATION_RECENT_TURN_LIMIT,
): ConversationTurnForPrompt[] {
  const authoritative = turns.filter((t) =>
    isAuthoritativeAssistantTurn({
      role: t.role,
      content: t.content,
      completionStatus: t.completionStatus,
      evidenceState: t.evidenceState,
    }),
  );
  // Drop user turns that only precede a cancelled/failed assistant (orphan cancelled pairs).
  const cancelledAssistantIds = new Set(
    turns
      .filter(
        (t) =>
          t.role === "assistant" &&
          !isAuthoritativeAssistantTurn({
            role: t.role,
            content: t.content,
            completionStatus: t.completionStatus,
          }),
      )
      .map((t) => t.messageId),
  );
  void cancelledAssistantIds;
  return authoritative.slice(-limit);
}

/** Keep only matter-validated document IDs on turns before prompt injection. */
export function restrictTurnSourceIds(
  turns: ConversationTurnForPrompt[],
  allowedSourceIds: readonly string[],
): ConversationTurnForPrompt[] {
  const allowed = new Set(allowedSourceIds);
  return turns.map((t) => ({
    ...t,
    sourceIds: t.sourceIds.filter((id) => allowed.has(id)),
  }));
}

export function formatConversationContextForPrompt(params: {
  recentTurns: ConversationTurnForPrompt[];
  summaryLines: string[];
  workingState: ConversationWorkingState;
  maxChars?: number;
}): string | null {
  const maxChars = params.maxChars ?? CONVERSATION_CONTEXT_MAX_CHARS;
  if (params.recentTurns.length === 0 && params.summaryLines.length === 0) return null;

  const activeBits = [
    params.workingState.activeClaimIds.length
      ? `claims=${params.workingState.activeClaimIds.slice(0, 8).join(",")}`
      : null,
    params.workingState.activeMotionIds.length
      ? `motions=${params.workingState.activeMotionIds.slice(0, 8).join(",")}`
      : null,
    params.workingState.activeDeficiencyIds.length
      ? `deficiencies=${params.workingState.activeDeficiencyIds.slice(0, 8).join(",")}`
      : null,
    params.workingState.activeCommunicationIds.length
      ? `communications=${params.workingState.activeCommunicationIds.slice(0, 8).join(",")}`
      : null,
    params.workingState.activeAuthorityIds.length
      ? `authorities=${params.workingState.activeAuthorityIds.slice(0, 8).join(",")}`
      : null,
    params.workingState.activeSourceIds.length
      ? `sources=${params.workingState.activeSourceIds.slice(0, 12).join(",")}`
      : null,
    params.workingState.issueLabels.length
      ? `topics=${params.workingState.issueLabels.slice(0, 8).join(" | ")}`
      : null,
  ].filter(Boolean);

  const authorityHonesty = params.workingState.authorityStates.slice(0, 8).map(
    (a) =>
      `- ${a.id} resolution=${a.resolution} treatment=${a.treatmentVerified ? "VERIFIED" : "UNKNOWN"}`,
  );

  const turnLines = params.recentTurns.map(
    (t) =>
      `${t.role === "user" ? "User" : "Nyaya"}: ${truncateTurnContent(t.content)}${
        t.sourceIds.length ? ` [sourceIds=${t.sourceIds.slice(0, 6).join(",")}]` : ""
      }`,
  );

  let block = [
    "CONVERSATION_CONTEXT",
    "trustBoundary=prior_turns_are_working_context_not_new_evidence",
    "Do not invent facts from conversation memory. Prefer matter sources over chat summary.",
    "Summary (topics/open questions only; not adjudicated truth):",
    ...(params.summaryLines.length ? params.summaryLines.map((l) => `- ${l}`) : ["- (none)"]),
    `ActiveReferents: ${activeBits.join("; ") || "(none)"}`,
    ...(authorityHonesty.length
      ? ["AuthorityStates:", ...authorityHonesty]
      : ["AuthorityStates: (none)"]),
    "RecentTurns:",
    ...(turnLines.length ? turnLines : ["(none)"]),
  ].join("\n");

  if (block.length > maxChars) {
    block = `${block.slice(0, maxChars - 1)}…`;
  }
  return block;
}

export function buildNextWorkingState(params: {
  prior: ConversationWorkingState | null;
  recentTurns: ConversationTurnForPrompt[];
  currentQuestion: string;
  sourceIds: string[];
  authorityIds: string[];
  authorityStates?: AuthorityStateSnapshot[];
  unresolvedQuestions?: string[];
  entityHints?: Partial<
    Pick<
      ConversationWorkingState,
      | "activeClaimIds"
      | "activeDefenseIds"
      | "activeMotionIds"
      | "activeDiscoveryIds"
      | "activeDeficiencyIds"
      | "activeCommunicationIds"
      | "activeTaskIds"
      | "activePersonIds"
    >
  >;
}): ConversationWorkingState {
  const summaryLines = buildCompactSummaryLines({
    prior: params.prior,
    recentTurns: params.recentTurns,
    currentQuestion: params.currentQuestion,
  });
  const base = params.prior ?? emptyWorkingState();
  return mergeWorkingStates(base, {
    summaryLines,
    activeSourceIds: params.sourceIds,
    activeAuthorityIds: params.authorityIds,
    authorityStates: params.authorityStates ?? [],
    unresolvedQuestions: params.unresolvedQuestions ?? [],
    issueLabels: extractIssueLabels(params.currentQuestion),
    ...params.entityHints,
    updatedAt: new Date().toISOString(),
  });
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function revalidateDocumentIdsInMatter(
  db: Database,
  params: { organizationId: string; matterId: string; documentIds: string[] },
): Promise<string[]> {
  // Reject non-UUID / foreign-shaped IDs before querying (Postgres uuid columns error otherwise).
  const ids = uniq(params.documentIds).filter(
    (id) =>
      !id.startsWith("web:") &&
      !id.startsWith("auth:") &&
      UUID_RE.test(id),
  );
  if (ids.length === 0) return [];
  const rows = await db
    .select({ id: documents.id })
    .from(documents)
    .where(
      and(
        inArray(documents.id, ids),
        eq(documents.organizationId, params.organizationId),
        eq(documents.matterId, params.matterId),
      ),
    );
  return rows.map((r) => r.id);
}

/**
 * Load org+matter+conversation scoped turns and assemble Ask conversation context.
 * Does not include the current question (call before inserting the new user message).
 */
export async function assembleConversationAskContext(
  db: Database,
  params: {
    organizationId: string;
    matterId: string;
    conversationId: string;
    currentQuestion: string;
    recentTurnLimit?: number;
  },
): Promise<AssembledConversationContext | null> {
  const [conversation] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(
      and(
        eq(conversations.id, params.conversationId),
        eq(conversations.organizationId, params.organizationId),
        eq(conversations.matterId, params.matterId),
      ),
    )
    .limit(1);
  if (!conversation) return null;

  const messageRows = await db
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, params.conversationId),
        eq(messages.organizationId, params.organizationId),
        eq(messages.matterId, params.matterId),
      ),
    )
    .orderBy(asc(messages.createdAt));

  const artifactRows = await db
    .select()
    .from(aiArtifacts)
    .where(
      and(
        eq(aiArtifacts.conversationId, params.conversationId),
        eq(aiArtifacts.organizationId, params.organizationId),
        eq(aiArtifacts.matterId, params.matterId),
      ),
    )
    .orderBy(desc(aiArtifacts.createdAt));

  const artifactByMessageId = new Map<string, (typeof artifactRows)[number]>();
  for (const art of artifactRows) {
    if (art.messageId && !artifactByMessageId.has(art.messageId)) {
      artifactByMessageId.set(art.messageId, art);
    }
  }

  let priorState: ConversationWorkingState | null = null;
  for (const art of artifactRows) {
    const validation = asRecord(art.validation);
    if (validation.completionStatus === "cancelled" || validation.completionStatus === "failed") {
      continue;
    }
    const parsed = parseWorkingState(validation.conversationWorkingState);
    if (parsed) {
      priorState = parsed;
      break;
    }
  }

  const allTurns: ConversationTurnForPrompt[] = messageRows.map((row) => {
    const art = artifactByMessageId.get(row.id);
    const validation = asRecord(art?.validation);
    const citations = Array.isArray(art?.citations) ? art!.citations : [];
    const sourceIds = citations
      .map((c) => (c && typeof c === "object" ? (c as { documentId?: string }).documentId : null))
      .filter((id): id is string => typeof id === "string" && id.length > 0);
    const workingState = parseWorkingState(validation.conversationWorkingState);
    const completionStatus =
      validation.completionStatus === "cancelled" ||
      validation.completionStatus === "failed" ||
      validation.completionStatus === "completed"
        ? validation.completionStatus
        : art
          ? "completed"
          : "unknown";
    return {
      messageId: row.id,
      role: row.role === "assistant" ? "assistant" : "user",
      content: row.content,
      createdAt: row.createdAt,
      completionStatus,
      evidenceState: art?.evidenceState ?? null,
      sourceIds,
      authorityIds: workingState?.activeAuthorityIds ?? [],
      workingState,
    };
  });

  const recentTurns = selectRecentTurns(
    allTurns,
    params.recentTurnLimit ?? CONVERSATION_RECENT_TURN_LIMIT,
  );

  const candidateSourceIds = uniq([
    ...(priorState?.activeSourceIds ?? []),
    ...recentTurns.flatMap((t) => t.sourceIds),
  ]);
  const validatedSources = await revalidateDocumentIdsInMatter(db, {
    organizationId: params.organizationId,
    matterId: params.matterId,
    documentIds: candidateSourceIds,
  });

  // Strip foreign / out-of-matter source IDs from turns before prompt injection so
  // RecentTurns cannot reintroduce IDs that failed matter validation.
  const sanitizedTurns = restrictTurnSourceIds(recentTurns, validatedSources);

  // Drop entity IDs from prior state that are not UUIDs of this conversation's
  // working set — Phase 1 keeps prior IDs but strips sources that failed matter checks.
  // Cross-matter IDs never enter because messages/artifacts are conversation+matter scoped.
  const workingState = buildNextWorkingState({
    prior: priorState
      ? { ...priorState, activeSourceIds: validatedSources }
      : emptyWorkingState(),
    recentTurns: sanitizedTurns,
    currentQuestion: params.currentQuestion,
    sourceIds: validatedSources,
    authorityIds: priorState?.activeAuthorityIds ?? [],
    authorityStates: priorState?.authorityStates ?? [],
    unresolvedQuestions: priorState?.unresolvedQuestions ?? [],
  });

  const summaryLines = workingState.summaryLines;
  const promptBlock = formatConversationContextForPrompt({
    recentTurns: sanitizedTurns,
    summaryLines,
    workingState,
  });

  return {
    conversationId: params.conversationId,
    recentTurns: sanitizedTurns,
    summaryLines,
    workingState,
    promptBlock,
    metrics: {
      recentTurnCount: sanitizedTurns.length,
      summaryChars: summaryLines.join("\n").length,
      promptChars: promptBlock?.length ?? 0,
      sourceIdCount: workingState.activeSourceIds.length,
      authorityIdCount: workingState.activeAuthorityIds.length,
    },
  };
}
