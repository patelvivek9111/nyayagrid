import { and, desc, eq, inArray, isNull } from "@nyayagrid/database";
import type { Database } from "@nyayagrid/database";
import {
  timelineEvents,
  matterFacts,
  matterEntities,
  entityRoles,
  deadlineCandidates,
  matterSummaries,
} from "@nyayagrid/database";
import {
  createAIProviderFromEnv,
  buildMatterSummarySystemPrompt,
  buildMatterSummaryUserPrompt,
  MATTER_SUMMARY_PROMPT_VERSION,
  type AIProvider,
} from "@nyayagrid/ai";
import { writeAuditEvent } from "@nyayagrid/permissions";

const APPROVED = ["approved", "edited_and_approved"] as const;

export async function loadVerifiedMatterIntelligence(params: {
  db: Database;
  organizationId: string;
  matterId: string;
}) {
  const events = await params.db
    .select()
    .from(timelineEvents)
    .where(
      and(
        eq(timelineEvents.organizationId, params.organizationId),
        eq(timelineEvents.matterId, params.matterId),
        inArray(timelineEvents.status, [...APPROVED]),
      ),
    )
    .orderBy(timelineEvents.eventDate);

  const facts = await params.db
    .select()
    .from(matterFacts)
    .where(
      and(
        eq(matterFacts.organizationId, params.organizationId),
        eq(matterFacts.matterId, params.matterId),
        inArray(matterFacts.status, [...APPROVED]),
      ),
    );

  const entities = await params.db
    .select()
    .from(matterEntities)
    .where(
      and(
        eq(matterEntities.organizationId, params.organizationId),
        eq(matterEntities.matterId, params.matterId),
        inArray(matterEntities.status, [...APPROVED]),
        isNull(matterEntities.mergedIntoEntityId),
      ),
    );

  const roles = entities.length
    ? await params.db
        .select()
        .from(entityRoles)
        .where(
          and(
            eq(entityRoles.organizationId, params.organizationId),
            eq(entityRoles.matterId, params.matterId),
            inArray(
              entityRoles.entityId,
              entities.map((e) => e.id),
            ),
          ),
        )
    : [];

  const deadlines = await params.db
    .select()
    .from(deadlineCandidates)
    .where(
      and(
        eq(deadlineCandidates.organizationId, params.organizationId),
        eq(deadlineCandidates.matterId, params.matterId),
        inArray(deadlineCandidates.status, [...APPROVED]),
      ),
    )
    .orderBy(deadlineCandidates.dueAt);

  return { events, facts, entities, roles, deadlines };
}

export function formatVerifiedIntelligenceForPrompt(
  input: Awaited<ReturnType<typeof loadVerifiedMatterIntelligence>>,
): string {
  if (
    input.events.length === 0 &&
    input.facts.length === 0 &&
    input.entities.length === 0 &&
    input.deadlines.length === 0
  ) {
    return "";
  }
  const roleMap = new Map<string, string[]>();
  for (const role of input.roles) {
    const list = roleMap.get(role.entityId) ?? [];
    list.push(role.role);
    roleMap.set(role.entityId, list);
  }
  return [
    "Verified timeline events:",
    ...input.events.map(
      (e) =>
        `- ${e.eventDate?.toISOString() ?? "unknown"} | ${e.eventType} | ${e.title} | actors=${JSON.stringify(e.actors ?? [])} | ${e.description ?? ""}`,
    ),
    "Verified facts:",
    ...input.facts.map((f) => `- ${f.label} (${f.factKey}): ${f.value}`),
    "Approved entities:",
    ...input.entities.map(
      (e) => `- ${e.displayName} (${e.entityType}) roles=${(roleMap.get(e.id) ?? []).join(",")}`,
    ),
    "Verified deadlines:",
    ...input.deadlines.map(
      (d) => `- ${d.title} due=${d.dueAt?.toISOString() ?? "unknown"} kind=${d.dateKind}`,
    ),
  ].join("\n");
}

export async function regenerateMatterSummary(params: {
  db: Database;
  organizationId: string;
  matterId: string;
  matterTitle: string;
  userId: string;
  ai?: AIProvider;
}) {
  const ai = params.ai ?? createAIProviderFromEnv();
  const verified = await loadVerifiedMatterIntelligence(params);
  const roleMap = new Map<string, string[]>();
  for (const role of verified.roles) {
    const list = roleMap.get(role.entityId) ?? [];
    list.push(role.role);
    roleMap.set(role.entityId, list);
  }

  const generation = await ai.generate({
    temperature: 0,
    schemaName: "matter_summary",
    messages: [
      { role: "system", content: buildMatterSummarySystemPrompt() },
      {
        role: "user",
        content: buildMatterSummaryUserPrompt({
          matterTitle: params.matterTitle,
          events: verified.events.map((e) => ({
            title: e.title,
            eventType: e.eventType,
            eventDate: e.eventDate?.toISOString() ?? null,
            description: e.description,
          })),
          facts: verified.facts.map((f) => ({ label: f.label, value: f.value })),
          entities: verified.entities.map((e) => ({
            displayName: e.displayName,
            entityType: e.entityType,
            roles: roleMap.get(e.id) ?? [],
          })),
          deadlines: verified.deadlines.map((d) => ({
            title: d.title,
            dueAt: d.dueAt?.toISOString() ?? null,
          })),
        }),
      },
    ],
  });

  let summaryText =
    "Insufficient verified matter intelligence is available to generate a reliable summary.";
  try {
    const parsed = JSON.parse(generation.text) as { summary?: string };
    if (parsed.summary?.trim()) summaryText = parsed.summary.trim();
  } catch {
    if (generation.text.trim()) summaryText = generation.text.trim();
  }

  const provenance = {
    eventIds: verified.events.map((e) => e.id),
    factIds: verified.facts.map((f) => f.id),
    entityIds: verified.entities.map((e) => e.id),
    deadlineIds: verified.deadlines.map((d) => d.id),
    generatedAt: new Date().toISOString(),
    aiGenerated: true,
    attorneyAuthored: false,
  };

  const [row] = await params.db
    .insert(matterSummaries)
    .values({
      organizationId: params.organizationId,
      matterId: params.matterId,
      summary: summaryText,
      provider: generation.provider,
      model: generation.model,
      promptVersion: MATTER_SUMMARY_PROMPT_VERSION,
      provenance,
      createdByUserId: params.userId,
    })
    .returning();

  await writeAuditEvent(params.db, {
    organizationId: params.organizationId,
    actorUserId: params.userId,
    matterId: params.matterId,
    action: "matter_summary.regenerated",
    targetType: "matter_summary",
    targetId: row!.id,
    metadata: { promptVersion: MATTER_SUMMARY_PROMPT_VERSION },
  });

  return row!;
}

export async function getLatestMatterSummary(params: {
  db: Database;
  organizationId: string;
  matterId: string;
}) {
  const [row] = await params.db
    .select()
    .from(matterSummaries)
    .where(
      and(
        eq(matterSummaries.organizationId, params.organizationId),
        eq(matterSummaries.matterId, params.matterId),
      ),
    )
    .orderBy(desc(matterSummaries.createdAt))
    .limit(1);
  return row ?? null;
}
