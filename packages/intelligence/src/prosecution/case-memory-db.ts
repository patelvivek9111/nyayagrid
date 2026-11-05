import { and, desc, eq, inArray } from "drizzle-orm";
import {
  criminalCases,
  prosecutionCaseMemories,
  prosecutionEvidenceItems,
  type Database,
  type ProsecutionCaseMemoryStatus,
  type ProsecutionCaseMemoryType,
  type RecordProvenance,
} from "@nyayagrid/database";
import { requireAnyCapability, requireCapability, writeAuditEvent } from "@nyayagrid/permissions";
import { assertProvenance } from "../legal/standards";
import { ProsecutionError, assertSameCase, assertTenant } from "./domain";

export const PROSECUTION_CASE_MEMORY_TYPES = [
  "confirmed_fact",
  "disputed_fact",
  "allegation",
  "admission",
  "legal_issue",
  "open_question",
  "procedural_context",
  "evidence_note",
  "strategy_note",
  "other",
] as const satisfies readonly ProsecutionCaseMemoryType[];

export type ProsecutionMemoryOrigin = "ai" | "manual";
export type ProsecutionMemoryConfidence = "low" | "medium" | "high";

export type ProsecutionMemoryReviewAction = "approve" | "reject" | "edit" | "supersede";

export type PublicProsecutionCaseMemory = {
  id: string;
  organizationId: string;
  criminalCaseId: string;
  evidenceItemId: string | null;
  memoryType: string;
  content: string;
  status: ProsecutionCaseMemoryStatus;
  origin: string;
  confidence: string | null;
  provenance: RecordProvenance;
  supersededBy: string | null;
  createdByUserId: string | null;
  reviewedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
  /** True only when status is approved. Proposed AI entries are never verified facts. */
  isVerifiedFact: boolean;
  attorneyBadge: "verified" | "suggested" | "historical";
};

/**
 * Read/write authorization only — never provision or reconcile roles here.
 * Mirrors packages/intelligence/src/prosecution/postgres.ts authorize.
 */
async function authorize(
  db: Database,
  params: {
    userId: string;
    organizationId: string;
    action: "view" | "edit";
  },
) {
  if (params.action === "view") {
    await requireAnyCapability(db, {
      userId: params.userId,
      organizationId: params.organizationId,
      capabilities: ["prosecution.view", "prosecution.edit", "prosecution.review"],
    });
    return;
  }
  await requireCapability(db, {
    userId: params.userId,
    organizationId: params.organizationId,
    capability: "prosecution.edit",
  });
}

async function requireCase(db: Database, organizationId: string, caseId: string) {
  const [row] = await db
    .select()
    .from(criminalCases)
    .where(and(eq(criminalCases.id, caseId), eq(criminalCases.organizationId, organizationId)))
    .limit(1);
  if (!row) throw new ProsecutionError("NOT_FOUND", "Criminal case not found.", 404);
  assertTenant(organizationId, row.organizationId);
  return row;
}

function provenanceOf(value: RecordProvenance): RecordProvenance {
  assertProvenance(value);
  return value;
}

function isMemoryType(value: string): value is ProsecutionCaseMemoryType {
  return (PROSECUTION_CASE_MEMORY_TYPES as readonly string[]).includes(value);
}

function isMemoryStatus(value: string): value is ProsecutionCaseMemoryStatus {
  return (
    value === "proposed" || value === "approved" || value === "rejected" || value === "superseded"
  );
}

function presentMemory(
  row: typeof prosecutionCaseMemories.$inferSelect,
): PublicProsecutionCaseMemory {
  const status = isMemoryStatus(row.status) ? row.status : "proposed";
  const verified = status === "approved";
  return {
    id: row.id,
    organizationId: row.organizationId,
    criminalCaseId: row.criminalCaseId,
    evidenceItemId: row.evidenceItemId,
    memoryType: row.memoryType,
    content: row.content,
    status,
    origin: row.origin,
    confidence: row.confidence,
    provenance: row.provenance,
    supersededBy: row.supersededBy,
    createdByUserId: row.createdByUserId,
    reviewedByUserId: row.reviewedByUserId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    isVerifiedFact: verified,
    attorneyBadge: verified ? "verified" : status === "proposed" ? "suggested" : "historical",
  };
}

/** AI origin may never create an approved/verified entry. */
export function resolveProsecutionMemoryCreateStatus(params: {
  origin: ProsecutionMemoryOrigin;
  status?: "proposed" | "approved";
}): "proposed" | "approved" {
  if (params.origin === "ai") return "proposed";
  return params.status ?? "proposed";
}

/** Proposed (and non-approved) entries are never verified facts. */
export function isProsecutionMemoryVerifiedFact(status: string): boolean {
  return status === "approved";
}

export function assertProsecutionMemoryTransition(params: {
  currentStatus: ProsecutionCaseMemoryStatus;
  action: ProsecutionMemoryReviewAction;
}): ProsecutionCaseMemoryStatus {
  const { currentStatus, action } = params;
  if (currentStatus === "superseded") {
    throw new ProsecutionError(
      "INVALID_MEMORY_TRANSITION",
      "Superseded memories cannot be reviewed.",
      400,
    );
  }
  if (currentStatus === "rejected" && action !== "supersede") {
    throw new ProsecutionError(
      "INVALID_MEMORY_TRANSITION",
      "Rejected memories can only be corrected by superseding with a new entry.",
      400,
    );
  }
  switch (action) {
    case "approve":
      if (currentStatus !== "proposed") {
        throw new ProsecutionError(
          "INVALID_MEMORY_TRANSITION",
          "Only proposed memories can be approved.",
          400,
        );
      }
      return "approved";
    case "reject":
      if (currentStatus !== "proposed" && currentStatus !== "approved") {
        throw new ProsecutionError(
          "INVALID_MEMORY_TRANSITION",
          "Only proposed or approved memories can be rejected.",
          400,
        );
      }
      return "rejected";
    case "edit":
      if (currentStatus !== "proposed" && currentStatus !== "approved") {
        throw new ProsecutionError(
          "INVALID_MEMORY_TRANSITION",
          "Only proposed or approved memories can be edited.",
          400,
        );
      }
      return "approved";
    case "supersede":
      if (currentStatus === "superseded") {
        throw new ProsecutionError(
          "INVALID_MEMORY_TRANSITION",
          "Memory is already superseded.",
          400,
        );
      }
      return "superseded";
    default: {
      const _exhaustive: never = action;
      void _exhaustive;
      throw new ProsecutionError("INVALID_MEMORY_TRANSITION", "Unknown review action.", 400);
    }
  }
}

async function requireEvidenceOnCase(
  db: Database,
  params: { organizationId: string; criminalCaseId: string; evidenceItemId: string },
) {
  const [evidence] = await db
    .select()
    .from(prosecutionEvidenceItems)
    .where(
      and(
        eq(prosecutionEvidenceItems.id, params.evidenceItemId),
        eq(prosecutionEvidenceItems.organizationId, params.organizationId),
      ),
    )
    .limit(1);
  if (!evidence) {
    throw new ProsecutionError("ORPHAN_REFERENCE", "Evidence item not found.", 404);
  }
  assertSameCase(params.criminalCaseId, evidence.criminalCaseId);
  assertTenant(params.organizationId, evidence.organizationId);
  return evidence;
}

export async function listProsecutionCaseMemories(
  db: Database,
  params: {
    userId: string;
    organizationId: string;
    caseId: string;
    status?: string | string[];
  },
): Promise<PublicProsecutionCaseMemory[]> {
  await authorize(db, {
    userId: params.userId,
    organizationId: params.organizationId,
    action: "view",
  });
  await requireCase(db, params.organizationId, params.caseId);

  const statuses = params.status
    ? Array.isArray(params.status)
      ? params.status
      : params.status
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
    : undefined;

  const conditions = [
    eq(prosecutionCaseMemories.organizationId, params.organizationId),
    eq(prosecutionCaseMemories.criminalCaseId, params.caseId),
  ];
  if (statuses?.length) {
    const valid = statuses.filter(isMemoryStatus);
    if (valid.length === 0) return [];
    conditions.push(inArray(prosecutionCaseMemories.status, valid));
  }

  const rows = await db
    .select()
    .from(prosecutionCaseMemories)
    .where(and(...conditions))
    .orderBy(desc(prosecutionCaseMemories.updatedAt));

  return rows.map(presentMemory);
}

export async function createProsecutionCaseMemory(
  db: Database,
  params: {
    userId: string;
    organizationId: string;
    caseId: string;
    memoryType: ProsecutionCaseMemoryType;
    content: string;
    evidenceItemId?: string | null;
    origin?: ProsecutionMemoryOrigin;
    status?: "proposed" | "approved";
    confidence?: ProsecutionMemoryConfidence | null;
    provenance: RecordProvenance;
    supersedesId?: string | null;
  },
): Promise<PublicProsecutionCaseMemory> {
  await authorize(db, {
    userId: params.userId,
    organizationId: params.organizationId,
    action: "edit",
  });
  const criminalCase = await requireCase(db, params.organizationId, params.caseId);
  if (!isMemoryType(params.memoryType)) {
    throw new ProsecutionError("VALIDATION_ERROR", "Unsupported memory type.", 400);
  }
  const origin: ProsecutionMemoryOrigin = params.origin ?? "manual";
  const status = resolveProsecutionMemoryCreateStatus({ origin, status: params.status });
  const provenance = provenanceOf(params.provenance);
  const evidenceItemId = params.evidenceItemId ?? null;
  if (evidenceItemId) {
    await requireEvidenceOnCase(db, {
      organizationId: params.organizationId,
      criminalCaseId: params.caseId,
      evidenceItemId,
    });
  }

  const now = new Date();
  const [created] = await db
    .insert(prosecutionCaseMemories)
    .values({
      organizationId: params.organizationId,
      criminalCaseId: params.caseId,
      evidenceItemId,
      memoryType: params.memoryType,
      content: params.content.trim(),
      status,
      origin,
      confidence: params.confidence ?? (origin === "ai" ? "medium" : null),
      provenance,
      createdByUserId: params.userId,
      reviewedByUserId: status === "approved" ? params.userId : null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!created) {
    throw new ProsecutionError("INSERT_FAILED", "Prosecution memory was not created.", 500);
  }

  if (params.supersedesId) {
    const [prior] = await db
      .select()
      .from(prosecutionCaseMemories)
      .where(
        and(
          eq(prosecutionCaseMemories.id, params.supersedesId),
          eq(prosecutionCaseMemories.organizationId, params.organizationId),
          eq(prosecutionCaseMemories.criminalCaseId, params.caseId),
        ),
      )
      .limit(1);
    if (!prior || !isMemoryStatus(prior.status)) {
      throw new ProsecutionError("NOT_FOUND", "Memory to supersede not found in case scope.", 404);
    }
    assertProsecutionMemoryTransition({
      currentStatus: prior.status,
      action: "supersede",
    });
    const [old] = await db
      .update(prosecutionCaseMemories)
      .set({
        status: "superseded",
        supersededBy: created.id,
        updatedAt: now,
        reviewedByUserId: params.userId,
      })
      .where(
        and(
          eq(prosecutionCaseMemories.id, params.supersedesId),
          eq(prosecutionCaseMemories.organizationId, params.organizationId),
          eq(prosecutionCaseMemories.criminalCaseId, params.caseId),
        ),
      )
      .returning();
    if (!old) {
      throw new ProsecutionError("NOT_FOUND", "Memory to supersede not found in case scope.", 404);
    }
    await writeAuditEvent(db, {
      organizationId: params.organizationId,
      actorUserId: params.userId,
      matterId: criminalCase.matterId,
      action: "prosecution.memory_superseded",
      targetType: "prosecution_case_memory",
      targetId: old.id,
      metadata: { criminalCaseId: params.caseId, supersededBy: created.id },
    });
  }

  await writeAuditEvent(db, {
    organizationId: params.organizationId,
    actorUserId: params.userId,
    matterId: criminalCase.matterId,
    action: status === "proposed" ? "prosecution.memory_proposed" : "prosecution.memory_created",
    targetType: "prosecution_case_memory",
    targetId: created.id,
    metadata: {
      criminalCaseId: params.caseId,
      memoryType: params.memoryType,
      origin,
      status,
      evidenceItemId,
      isVerifiedFact: isProsecutionMemoryVerifiedFact(status),
      supersedesId: params.supersedesId ?? null,
    },
  });

  return presentMemory(created);
}

export async function reviewProsecutionCaseMemory(
  db: Database,
  params: {
    userId: string;
    organizationId: string;
    caseId: string;
    memoryId: string;
    action: ProsecutionMemoryReviewAction;
    content?: string | null;
    memoryType?: ProsecutionCaseMemoryType | null;
    evidenceItemId?: string | null;
    rejectionReason?: string | null;
    provenance?: RecordProvenance | null;
  },
): Promise<PublicProsecutionCaseMemory> {
  await authorize(db, {
    userId: params.userId,
    organizationId: params.organizationId,
    action: "edit",
  });
  const criminalCase = await requireCase(db, params.organizationId, params.caseId);

  const [existing] = await db
    .select()
    .from(prosecutionCaseMemories)
    .where(
      and(
        eq(prosecutionCaseMemories.id, params.memoryId),
        eq(prosecutionCaseMemories.organizationId, params.organizationId),
        eq(prosecutionCaseMemories.criminalCaseId, params.caseId),
      ),
    )
    .limit(1);
  if (!existing) {
    throw new ProsecutionError("NOT_FOUND", "Prosecution memory not found in case scope.", 404);
  }
  if (!isMemoryStatus(existing.status)) {
    throw new ProsecutionError("INVALID_MEMORY_STATUS", "Memory has an invalid status.", 500);
  }

  const nextStatus = assertProsecutionMemoryTransition({
    currentStatus: existing.status,
    action: params.action,
  });
  const now = new Date();

  if (params.action === "supersede") {
    const content = params.content?.trim();
    if (!content) {
      throw new ProsecutionError(
        "VALIDATION_ERROR",
        "Supersede requires replacement content.",
        400,
      );
    }
    const memoryType =
      params.memoryType && isMemoryType(params.memoryType)
        ? params.memoryType
        : isMemoryType(existing.memoryType)
          ? existing.memoryType
          : "other";
    const provenance = provenanceOf(
      params.provenance ?? {
        ...existing.provenance,
        humanEntered: true,
        extractionOrigin: "human",
      },
    );
    return createProsecutionCaseMemory(db, {
      userId: params.userId,
      organizationId: params.organizationId,
      caseId: params.caseId,
      memoryType,
      content,
      evidenceItemId:
        params.evidenceItemId === undefined ? existing.evidenceItemId : params.evidenceItemId,
      origin: "manual",
      status: "approved",
      confidence: "high",
      provenance,
      supersedesId: existing.id,
    });
  }

  if (params.action === "edit") {
    const content = params.content?.trim();
    if (!content) {
      throw new ProsecutionError("VALIDATION_ERROR", "Edit requires updated content.", 400);
    }
  }

  if (params.evidenceItemId) {
    await requireEvidenceOnCase(db, {
      organizationId: params.organizationId,
      criminalCaseId: params.caseId,
      evidenceItemId: params.evidenceItemId,
    });
  }

  const patch: Partial<typeof prosecutionCaseMemories.$inferInsert> = {
    status: nextStatus,
    updatedAt: now,
    reviewedByUserId: params.userId,
  };
  if (params.action === "edit" && params.content?.trim()) {
    patch.content = params.content.trim();
  }
  if (params.memoryType && isMemoryType(params.memoryType)) {
    patch.memoryType = params.memoryType;
  }
  if (params.evidenceItemId !== undefined) {
    patch.evidenceItemId = params.evidenceItemId;
  }
  if (params.provenance) {
    patch.provenance = provenanceOf(params.provenance);
  }

  const [updated] = await db
    .update(prosecutionCaseMemories)
    .set(patch)
    .where(
      and(
        eq(prosecutionCaseMemories.id, params.memoryId),
        eq(prosecutionCaseMemories.organizationId, params.organizationId),
        eq(prosecutionCaseMemories.criminalCaseId, params.caseId),
      ),
    )
    .returning();
  if (!updated) {
    throw new ProsecutionError("NOT_FOUND", "Prosecution memory not found in case scope.", 404);
  }

  const actionName =
    params.action === "approve"
      ? "prosecution.memory_approved"
      : params.action === "reject"
        ? "prosecution.memory_rejected"
        : "prosecution.memory_edited";

  await writeAuditEvent(db, {
    organizationId: params.organizationId,
    actorUserId: params.userId,
    matterId: criminalCase.matterId,
    action: actionName,
    targetType: "prosecution_case_memory",
    targetId: params.memoryId,
    metadata: {
      criminalCaseId: params.caseId,
      action: params.action,
      previousStatus: existing.status,
      status: nextStatus,
      isVerifiedFact: isProsecutionMemoryVerifiedFact(nextStatus),
      rejectionReason: params.rejectionReason ?? null,
    },
  });

  return presentMemory(updated);
}

/** Downstream / prompt eligibility — approved only; proposed never qualifies. */
export function isDownstreamEligibleProsecutionMemory(row: {
  status?: string | null;
  supersededBy?: string | null;
}): boolean {
  return isProsecutionMemoryVerifiedFact(row.status ?? "") && !row.supersededBy;
}
