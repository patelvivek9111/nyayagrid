import type { AIProvider } from "@nyayagrid/ai";
import type { Database } from "@nyayagrid/database";
import {
  createMatterMemory,
  formatActiveMemoryForPrompt,
  listMatterMemories,
  proposeMatterMemories,
  retrieveActiveMatterMemories,
  reviewMatterMemory,
  supersedeMatterMemory,
} from "@nyayagrid/intelligence";
import type { BenchScenario, BenchTask, MemoryBenchAction } from "./catalog";
import type { IngestedMatter } from "./ingest";
import { adaptMemoryOutput, documentIndexFor } from "./adapt-structured";

type MemoryType = NonNullable<Parameters<typeof createMatterMemory>[0]["memoryType"]>;

function asMemoryType(value: string | undefined, fallback: MemoryType): MemoryType {
  const allowed: MemoryType[] = [
    "verified_context",
    "strategic_note",
    "entity_resolution",
    "document_significance",
    "factual_caveat",
    "user_instruction",
    "matter_preference",
    "procedural_context",
    "other",
  ];
  if (value && (allowed as string[]).includes(value)) return value as MemoryType;
  return fallback;
}

async function snapshot(params: {
  db: Database;
  matter: IngestedMatter;
  taskId: string;
  createdIds: string[];
  actionKind: string;
}) {
  const memories = await listMatterMemories({
    db: params.db,
    organizationId: params.matter.organizationId,
    matterId: params.matter.matterId,
    status: ["proposed", "approved", "edited_and_approved", "rejected", "archived", "superseded"],
  });
    const active = await retrieveActiveMatterMemories({
    db: params.db,
    organizationId: params.matter.organizationId,
    matterId: params.matter.matterId,
    limit: 25,
  });
  const activeIds = new Set(active.map((row) => row.id));
  const activePublic = memories.filter((row) => activeIds.has(row.id));
  const formattedForPrompt = formatActiveMemoryForPrompt(active);
  const structured = adaptMemoryOutput({
    taskId: params.taskId,
    matter: params.matter,
    memories,
    active: activePublic,
    formattedForPrompt,
    createdIds: params.createdIds,
    actionKind: params.actionKind,
  });
  return {
    answer: JSON.stringify(structured, null, 2),
    extras: {
      executionTarget: "memory" as const,
      structuredKind: "memory",
      structuredOutput: structured,
      documentIndex: documentIndexFor(params.matter),
      memoryCount: structured.memories.length,
      activeMemoryCount: structured.activeForDownstream.length,
    },
  };
}

async function createManual(
  params: {
    db: Database;
    matter: IngestedMatter;
    userId: string;
  },
  action: MemoryBenchAction,
  origin: "manual" | "ai" = "manual",
) {
  return createMatterMemory({
    db: params.db,
    organizationId: params.matter.organizationId,
    matterId: params.matter.matterId,
    userId: params.userId,
    memoryType: asMemoryType(action.memoryType, "verified_context"),
    title: action.title ?? "Untitled memory",
    content: action.content ?? "",
    origin,
  });
}

export async function executeMemoryTarget(params: {
  db: Database;
  scenario: BenchScenario;
  task: BenchTask;
  matter: IngestedMatter;
  ai: AIProvider;
}): Promise<{ answer: string; extras: Record<string, unknown> }> {
  const { db, matter, task, scenario, ai } = params;
  const action = task.memoryAction ?? { kind: "propose", question: task.prompt };
  const orgMatterUser = {
    db,
    organizationId: matter.organizationId,
    matterId: matter.matterId,
    userId: matter.userId,
  };
  const createdIds: string[] = [];

  if (action.kind === "propose" || action.kind === "hint_fallback") {
    const proposed = await proposeMatterMemories({
      ...orgMatterUser,
      matterTitle: scenario.title,
      question: action.question ?? task.prompt,
      hint: action.hint ?? null,
      ai,
    });
    createdIds.push(...proposed.proposals.map((row) => row.id));
    return snapshot({ db, matter, taskId: task.taskId, createdIds, actionKind: action.kind });
  }

  if (action.kind === "create_manual") {
    const memory = await createManual({ db, matter, userId: matter.userId }, action);
    createdIds.push(memory.id);
    return snapshot({ db, matter, taskId: task.taskId, createdIds, actionKind: action.kind });
  }

  if (action.kind === "duplicate") {
    const first = await createManual({ db, matter, userId: matter.userId }, action);
    const second = await createManual({ db, matter, userId: matter.userId }, action);
    createdIds.push(first.id, second.id);
    return snapshot({ db, matter, taskId: task.taskId, createdIds, actionKind: action.kind });
  }

  if (action.kind === "reject") {
    const memory = await createMatterMemory({
      ...orgMatterUser,
      memoryType: asMemoryType(action.memoryType, "verified_context"),
      title: action.title ?? "Proposed then rejected",
      content: action.content ?? "",
      origin: "ai",
      status: "proposed",
    });
    await reviewMatterMemory({
      ...orgMatterUser,
      memoryId: memory.id,
      action: "reject",
      rejectionReason: "Benchmark rejection of an unverified proposition.",
    });
    createdIds.push(memory.id);
    return snapshot({ db, matter, taskId: task.taskId, createdIds, actionKind: action.kind });
  }

  if (action.kind === "edit") {
    const memory = await createManual({ db, matter, userId: matter.userId }, action);
    await reviewMatterMemory({
      ...orgMatterUser,
      memoryId: memory.id,
      action: "edit_and_approve",
      edits: {
        title: action.newTitle ?? memory.title,
        content: action.newContent ?? memory.content,
      },
    });
    createdIds.push(memory.id);
    return snapshot({ db, matter, taskId: task.taskId, createdIds, actionKind: action.kind });
  }

  if (action.kind === "supersede") {
    const old = await createMatterMemory({
      ...orgMatterUser,
      memoryType: asMemoryType(action.oldMemoryType, "verified_context"),
      title: action.oldTitle ?? "Prior memory",
      content: action.oldContent ?? "",
      origin: "manual",
      status: "approved",
    });
    const next = await supersedeMatterMemory({
      ...orgMatterUser,
      oldMemoryId: old.id,
      title: action.newTitle ?? "Superseding memory",
      content: action.newContent ?? "",
      memoryType: asMemoryType(action.newMemoryType, old.memoryType),
    });
    createdIds.push(old.id, next.id);
    return snapshot({ db, matter, taskId: task.taskId, createdIds, actionKind: action.kind });
  }

  return snapshot({ db, matter, taskId: task.taskId, createdIds, actionKind: action.kind });
}
