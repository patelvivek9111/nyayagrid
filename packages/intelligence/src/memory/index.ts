import { and, desc, eq, inArray, isNull, sql } from "@nyayagrid/database";
import type { Database } from "@nyayagrid/database";
import { matterMemories } from "@nyayagrid/database";
import {
  createAIProviderFromEnv,
  createEmbeddingProviderFromEnv,
  buildMemoryProposalSystemPrompt,
  buildMemoryProposalUserPrompt,
  memoryProposalResponseSchema,
  MEMORY_PROPOSAL_PROMPT_VERSION,
  type AIProvider,
  type EmbeddingProvider,
} from "@nyayagrid/ai";
import { writeAuditEvent } from "@nyayagrid/permissions";
import { formatVerifiedIntelligenceForPrompt, loadVerifiedMatterIntelligence } from "../verified";

const ACTIVE = ["approved", "edited_and_approved"] as const;

export async function createMatterMemory(params: {
  db: Database;
  organizationId: string;
  matterId: string;
  userId: string;
  memoryType:
    | "verified_context"
    | "strategic_note"
    | "entity_resolution"
    | "document_significance"
    | "factual_caveat"
    | "user_instruction"
    | "matter_preference"
    | "procedural_context"
    | "other";
  title: string;
  content: string;
  importance?: "low" | "normal" | "high" | "critical";
  origin?: "ai" | "manual";
  status?: "proposed" | "approved";
  confidence?: "low" | "medium" | "high" | null;
  sourceType?: string | null;
  sourceReference?: Record<string, unknown>;
  supersedesId?: string | null;
  embeddings?: EmbeddingProvider;
}) {
  const embeddings = params.embeddings ?? createEmbeddingProviderFromEnv();
  const [vector] = await embeddings.embed([`${params.title}\n${params.content}`]);
  const status = params.status ?? (params.origin === "manual" ? "approved" : "proposed");
  const now = new Date();

  const [memory] = await params.db
    .insert(matterMemories)
    .values({
      organizationId: params.organizationId,
      matterId: params.matterId,
      memoryType: params.memoryType,
      title: params.title,
      content: params.content,
      normalizedContent: params.content.toLowerCase().replace(/\s+/g, " ").trim(),
      status,
      origin: params.origin ?? "manual",
      confidence: params.confidence ?? (params.origin === "manual" ? "high" : "medium"),
      importance: params.importance ?? "normal",
      createdByUserId: params.userId,
      approvedByUserId: status === "approved" ? params.userId : null,
      approvedAt: status === "approved" ? now : null,
      sourceType: params.sourceType ?? null,
      sourceReference: params.sourceReference ?? {},
      embedding: vector ?? null,
      embeddingModel: embeddings.model,
    })
    .returning();

  if (params.supersedesId) {
    await params.db
      .update(matterMemories)
      .set({
        status: "superseded",
        supersededBy: memory!.id,
        updatedAt: now,
      })
      .where(
        and(
          eq(matterMemories.id, params.supersedesId),
          eq(matterMemories.organizationId, params.organizationId),
          eq(matterMemories.matterId, params.matterId),
        ),
      );
  }

  await writeAuditEvent(params.db, {
    organizationId: params.organizationId,
    actorUserId: params.userId,
    matterId: params.matterId,
    action: status === "proposed" ? "matter_memory.proposed" : "matter_memory.created",
    targetType: "matter_memory",
    targetId: memory!.id,
    metadata: { memoryType: params.memoryType, supersedesId: params.supersedesId ?? null },
  });

  return memory!;
}

export async function reviewMatterMemory(params: {
  db: Database;
  organizationId: string;
  matterId: string;
  memoryId: string;
  userId: string;
  action: "approve" | "edit_and_approve" | "reject" | "archive";
  rejectionReason?: string | null;
  edits?: {
    title?: string;
    content?: string;
    memoryType?: string;
    importance?: "low" | "normal" | "high" | "critical";
  };
  embeddings?: EmbeddingProvider;
}) {
  const now = new Date();
  const status =
    params.action === "reject"
      ? "rejected"
      : params.action === "archive"
        ? "archived"
        : params.action === "edit_and_approve"
          ? "edited_and_approved"
          : "approved";

  const patch: Record<string, unknown> = {
    status,
    updatedAt: now,
  };
  if (params.edits?.title) patch.title = params.edits.title;
  if (params.edits?.content) {
    patch.content = params.edits.content;
    patch.normalizedContent = params.edits.content.toLowerCase().replace(/\s+/g, " ").trim();
    const embeddings = params.embeddings ?? createEmbeddingProviderFromEnv();
    const [vector] = await embeddings.embed([
      `${params.edits.title ?? ""}\n${params.edits.content}`,
    ]);
    patch.embedding = vector ?? null;
    patch.embeddingModel = embeddings.model;
  }
  if (params.edits?.memoryType) patch.memoryType = params.edits.memoryType;
  if (params.edits?.importance) patch.importance = params.edits.importance;

  if (status === "rejected") {
    patch.rejectedByUserId = params.userId;
    patch.rejectedAt = now;
    patch.rejectionReason = params.rejectionReason ?? null;
    patch.approvedByUserId = null;
    patch.approvedAt = null;
  } else if (status === "archived") {
    // keep approval metadata
  } else {
    patch.approvedByUserId = params.userId;
    patch.approvedAt = now;
    patch.rejectedByUserId = null;
    patch.rejectedAt = null;
    patch.rejectionReason = null;
  }

  const [updated] = await params.db
    .update(matterMemories)
    .set(patch)
    .where(
      and(
        eq(matterMemories.id, params.memoryId),
        eq(matterMemories.organizationId, params.organizationId),
        eq(matterMemories.matterId, params.matterId),
      ),
    )
    .returning();
  if (!updated) throw new Error("Matter memory not found in matter scope");

  await writeAuditEvent(params.db, {
    organizationId: params.organizationId,
    actorUserId: params.userId,
    matterId: params.matterId,
    action: `matter_memory.${params.action}`,
    targetType: "matter_memory",
    targetId: params.memoryId,
  });
  return updated;
}

export async function supersedeMatterMemory(params: {
  db: Database;
  organizationId: string;
  matterId: string;
  userId: string;
  oldMemoryId: string;
  title: string;
  content: string;
  memoryType?:
    | "verified_context"
    | "strategic_note"
    | "entity_resolution"
    | "document_significance"
    | "factual_caveat"
    | "user_instruction"
    | "matter_preference"
    | "procedural_context"
    | "other";
  importance?: "low" | "normal" | "high" | "critical";
}) {
  const [old] = await params.db
    .select()
    .from(matterMemories)
    .where(
      and(
        eq(matterMemories.id, params.oldMemoryId),
        eq(matterMemories.organizationId, params.organizationId),
        eq(matterMemories.matterId, params.matterId),
      ),
    )
    .limit(1);
  if (!old) throw new Error("Memory to supersede not found");

  return createMatterMemory({
    db: params.db,
    organizationId: params.organizationId,
    matterId: params.matterId,
    userId: params.userId,
    memoryType: params.memoryType ?? old.memoryType,
    title: params.title,
    content: params.content,
    importance: params.importance ?? old.importance,
    origin: "manual",
    status: "approved",
    sourceType: "supersession",
    sourceReference: { previousMemoryId: old.id },
    supersedesId: old.id,
  });
}

export async function listMatterMemories(params: {
  db: Database;
  organizationId: string;
  matterId: string;
  status?: string | string[];
}) {
  const statuses = params.status
    ? Array.isArray(params.status)
      ? params.status
      : params.status.split(",")
    : undefined;
  const conditions = [
    eq(matterMemories.organizationId, params.organizationId),
    eq(matterMemories.matterId, params.matterId),
  ];
  if (statuses?.length) {
    conditions.push(
      inArray(
        matterMemories.status,
        statuses as Array<
          "proposed" | "approved" | "edited_and_approved" | "rejected" | "archived" | "superseded"
        >,
      ),
    );
  }
  const rows = await params.db
    .select()
    .from(matterMemories)
    .where(and(...conditions))
    .orderBy(desc(matterMemories.updatedAt));
  return rows;
}

export async function retrieveActiveMatterMemories(params: {
  db: Database;
  organizationId: string;
  matterId: string;
  question?: string;
  limit?: number;
  embeddings?: EmbeddingProvider;
}) {
  const active = await params.db
    .select()
    .from(matterMemories)
    .where(
      and(
        eq(matterMemories.organizationId, params.organizationId),
        eq(matterMemories.matterId, params.matterId),
        inArray(matterMemories.status, [...ACTIVE]),
        isNull(matterMemories.supersededBy),
      ),
    );

  if (!params.question || active.length === 0) {
    return active
      .sort((a, b) => importanceRank(b.importance) - importanceRank(a.importance))
      .slice(0, params.limit ?? 8);
  }

  const embeddings = params.embeddings ?? createEmbeddingProviderFromEnv();
  const [queryVec] = await embeddings.embed([params.question]);
  if (!queryVec) {
    return active.slice(0, params.limit ?? 8);
  }

  // Scope first in SQL, then rank in-memory (safe for Phase 4 matter-sized sets).
  const ranked = active
    .map((m) => ({
      memory: m,
      score:
        cosineSimilarity(queryVec, (m.embedding as number[] | null) ?? []) * 0.7 +
        importanceRank(m.importance) * 0.2 +
        lexicalOverlap(params.question!, `${m.title} ${m.content}`) * 0.1,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, params.limit ?? 8)
    .map((r) => r.memory);

  return ranked;
}

export function formatActiveMemoryForPrompt(
  memories: Array<{ title: string; content: string; memoryType: string; importance: string }>,
): string {
  if (memories.length === 0) return "";
  return [
    "Approved Matter Memory:",
    ...memories.map(
      (m) => `- [${m.importance}/${m.memoryType}] ${m.title}: ${m.content.slice(0, 300)}`,
    ),
  ].join("\n");
}

export async function proposeMatterMemories(params: {
  db: Database;
  organizationId: string;
  matterId: string;
  matterTitle: string;
  userId: string;
  question?: string | null;
  hint?: string | null;
  ai?: AIProvider;
}) {
  const ai = params.ai ?? createAIProviderFromEnv();
  const verified = await loadVerifiedMatterIntelligence({
    db: params.db,
    organizationId: params.organizationId,
    matterId: params.matterId,
  });
  const generation = await ai.generate({
    temperature: 0,
    schemaName: "matter_memory_proposal",
    messages: [
      { role: "system", content: buildMemoryProposalSystemPrompt() },
      {
        role: "user",
        content: buildMemoryProposalUserPrompt({
          matterTitle: params.matterTitle,
          question: params.question,
          hint: params.hint,
          verifiedContext: formatVerifiedIntelligenceForPrompt(verified),
        }),
      },
    ],
  });

  let raw: unknown;
  try {
    raw = JSON.parse(generation.text);
  } catch {
    raw = { proposals: [] };
  }
  const parsed = memoryProposalResponseSchema.parse(raw);
  const created = [];
  for (const proposal of parsed.proposals.slice(0, 3)) {
    // Prevent AI from marking everything critical.
    const importance = proposal.importance === "critical" ? "high" : proposal.importance;
    const memory = await createMatterMemory({
      db: params.db,
      organizationId: params.organizationId,
      matterId: params.matterId,
      userId: params.userId,
      memoryType: proposal.memoryType,
      title: proposal.title,
      content: proposal.content,
      importance,
      origin: "ai",
      status: "proposed",
      confidence: proposal.confidence,
      sourceType: "ai_proposal",
      sourceReference: {
        promptVersion: MEMORY_PROPOSAL_PROMPT_VERSION,
        rationale: proposal.rationale ?? null,
        provider: generation.provider,
        model: generation.model,
      },
    });
    created.push(memory);
  }

  await writeAuditEvent(params.db, {
    organizationId: params.organizationId,
    actorUserId: params.userId,
    matterId: params.matterId,
    action: "matter_memory.batch_proposed",
    targetType: "matter",
    targetId: params.matterId,
    metadata: { count: created.length },
  });

  return { proposals: created, provider: generation.provider, model: generation.model };
}

function importanceRank(value: string): number {
  switch (value) {
    case "critical":
      return 4;
    case "high":
      return 3;
    case "normal":
      return 2;
    default:
      return 1;
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (!a.length || !b.length || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

function lexicalOverlap(question: string, haystack: string): number {
  const tokens = question
    .toLowerCase()
    .split(/\W+/)
    .filter((t) => t.length > 3);
  if (tokens.length === 0) return 0;
  const hay = haystack.toLowerCase();
  const hits = tokens.filter((t) => hay.includes(t)).length;
  return hits / tokens.length;
}

export async function countProposedMemories(params: {
  db: Database;
  organizationId: string;
  matterId: string;
}) {
  const [row] = await params.db
    .select({ count: sql<number>`count(*)::int` })
    .from(matterMemories)
    .where(
      and(
        eq(matterMemories.organizationId, params.organizationId),
        eq(matterMemories.matterId, params.matterId),
        eq(matterMemories.status, "proposed"),
      ),
    );
  return row?.count ?? 0;
}
