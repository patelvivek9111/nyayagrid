import { describe, expect, it } from "vitest";
import { LegalWorkEngine } from "./engine";
import {
  LegalWorkConflictError,
  LegalWorkForbiddenError,
  LegalWorkIrreversibleError,
  LegalWorkLockedError,
} from "./errors";
import { approvalAfterRestore, canRestoreObject, isProtectedObjectType } from "./policy";
import { diffPayloads, diffTextLines } from "./diff";
import { MemoryLegalWorkStore } from "./store";
import { detectOptimisticConflict, detectUndoConflict } from "./conflict";

const org = "11111111-1111-1111-1111-111111111111";
const matter = "22222222-2222-2222-2222-222222222222";
const userA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const userB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const draftId = "dddddddd-dddd-dddd-dddd-dddddddddddd";

function engine() {
  const store = new MemoryLegalWorkStore();
  return { store, engine: new LegalWorkEngine(store) };
}

async function seedDraft(e: LegalWorkEngine, content: string, source: "user" | "ai" = "user", actor = userA) {
  return e.recordMutation({
    organizationId: org,
    matterId: matter,
    actorUserId: actor,
    objectType: "draft",
    objectId: draftId,
    operation: "update",
    source,
    afterPayload: { content, status: "draft" },
    skipApply: false,
  });
}

describe("legal-work recovery", () => {
  it("1. simple undo restores the prior payload as a new version", async () => {
    const { store, engine: e } = engine();
    await seedDraft(e, "v1");
    await seedDraft(e, "v2");
    const result = await e.undoLastAction({
      organizationId: org,
      matterId: matter,
      actorUserId: userA,
      role: "editor",
      scope: "object",
      objectType: "draft",
      objectId: draftId,
    });
    expect(result.version?.payload.content).toBe("v1");
    expect(result.version?.versionNumber).toBe(3);
    expect(store.versions).toHaveLength(3);
  });

  it("2-4. restore older version creates a new version and keeps history", async () => {
    const { store, engine: e } = engine();
    const v1 = await seedDraft(e, "alpha");
    await seedDraft(e, "beta");
    await seedDraft(e, "gamma");
    const restored = await e.restoreVersion({
      organizationId: org,
      matterId: matter,
      actorUserId: userA,
      objectType: "draft",
      objectId: draftId,
      targetVersionId: v1.version.id,
      mode: "as_new_version",
      role: "editor",
    });
    expect(restored.version?.payload.content).toBe("alpha");
    expect(restored.version?.versionNumber).toBe(4);
    expect(restored.version?.restorationOfVersionId).toBe(v1.version.id);
    expect(store.versions.map((v) => v.payload.content)).toEqual(["alpha", "beta", "gamma", "alpha"]);
    const live = await store.loadLive({
      organizationId: org,
      matterId: matter,
      objectType: "draft",
      objectId: draftId,
    });
    expect(live?.content).toBe("alpha");
  });

  it("5-7. user A cannot silently overwrite user B; restore-as-new-version is allowed", async () => {
    const { store, engine: e } = engine();
    const v1 = await seedDraft(e, "A1", "user", userA);
    await seedDraft(e, "A2", "user", userA);
    await seedDraft(e, "B3", "user", userB);
    await expect(
      e.undoLastAction({
        organizationId: org,
        matterId: matter,
        actorUserId: userA,
        role: "editor",
        scope: "object",
        objectType: "draft",
        objectId: draftId,
      }),
    ).rejects.toBeInstanceOf(LegalWorkConflictError);

    const restored = await e.restoreVersion({
      organizationId: org,
      matterId: matter,
      actorUserId: userA,
      objectType: "draft",
      objectId: draftId,
      targetVersionId: v1.version.id,
      mode: "as_new_version",
      role: "editor",
    });
    expect(restored.version?.versionNumber).toBe(4);
    expect(store.versions[2]?.payload.content).toBe("B3");
    expect(store.versions[3]?.payload.content).toBe("A1");
  });

  it("6. optimistic concurrency fails when expected version is stale", async () => {
    const { engine: e } = engine();
    const v1 = await seedDraft(e, "one");
    await seedDraft(e, "two");
    await expect(
      e.recordMutation({
        organizationId: org,
        matterId: matter,
        actorUserId: userA,
        objectType: "draft",
        objectId: draftId,
        operation: "update",
        source: "user",
        afterPayload: { content: "three" },
        expectedVersionId: v1.version.id,
      }),
    ).rejects.toBeInstanceOf(LegalWorkConflictError);
  });

  it("8. original evidence cannot be restored", async () => {
    const { engine: e } = engine();
    expect(isProtectedObjectType("document")).toBe(true);
    await expect(
      e.recordMutation({
        organizationId: org,
        matterId: matter,
        actorUserId: userA,
        objectType: "document",
        objectId: draftId,
        operation: "update",
        source: "user",
        afterPayload: { title: "tamper" },
      }),
    ).rejects.toBeInstanceOf(LegalWorkIrreversibleError);
  });

  it("9. locked/finalized artifacts reject editor undo", async () => {
    const { store, engine: e } = engine();
    await seedDraft(e, "locked draft");
    await seedDraft(e, "second edit");
    const head = [...store.heads.values()][0]!;
    head.lockState = "finalized";
    store.heads.set([...store.heads.keys()][0]!, head);
    await expect(
      e.undoLastAction({
        organizationId: org,
        matterId: matter,
        actorUserId: userA,
        role: "editor",
        scope: "object",
        objectType: "draft",
        objectId: draftId,
      }),
    ).rejects.toBeInstanceOf(LegalWorkLockedError);
    expect(canRestoreObject("admin", "finalized")).toBe(false);
    await expect(
      e.undoLastAction({
        organizationId: org,
        matterId: matter,
        actorUserId: userA,
        role: "admin",
        scope: "object",
        objectType: "draft",
        objectId: draftId,
      }),
    ).rejects.toBeInstanceOf(LegalWorkLockedError);
  });

  it("10-12. draft, timeline, and evidence restore keep prior versions", async () => {
    const { store, engine: e } = engine();
    const timelineId = "t1t1t1t1-t1t1-t1t1-t1t1-t1t1t1t1t1t1";
    const evidenceId = "e1e1e1e1-e1e1-e1e1-e1e1-e1e1e1e1e1e1";
    const t1 = await e.recordMutation({
      organizationId: org,
      matterId: matter,
      actorUserId: userA,
      objectType: "timeline_event",
      objectId: timelineId,
      operation: "create",
      source: "user",
      afterPayload: { title: "Hearing", status: "approved" },
    });
    await e.recordMutation({
      organizationId: org,
      matterId: matter,
      actorUserId: userA,
      objectType: "timeline_event",
      objectId: timelineId,
      operation: "update",
      source: "user",
      afterPayload: { title: "Hearing moved", status: "approved" },
    });
    await e.restoreVersion({
      organizationId: org,
      matterId: matter,
      actorUserId: userA,
      objectType: "timeline_event",
      objectId: timelineId,
      targetVersionId: t1.version.id,
      mode: "as_new_version",
      role: "editor",
    });
    const ev1 = await e.recordMutation({
      organizationId: org,
      matterId: matter,
      actorUserId: userA,
      objectType: "evidence_review",
      objectId: evidenceId,
      operation: "update",
      source: "user",
      afterPayload: { relevance: "relevant", reviewNotes: "keep" },
    });
    await e.recordMutation({
      organizationId: org,
      matterId: matter,
      actorUserId: userA,
      objectType: "evidence_review",
      objectId: evidenceId,
      operation: "update",
      source: "user",
      afterPayload: { relevance: "not_relevant", reviewNotes: "drop" },
    });
    await e.restoreVersion({
      organizationId: org,
      matterId: matter,
      actorUserId: userA,
      objectType: "evidence_review",
      objectId: evidenceId,
      targetVersionId: ev1.version.id,
      mode: "as_new_version",
      role: "editor",
    });
    expect(store.versions.filter((v) => v.objectType === "timeline_event")).toHaveLength(3);
    expect(store.versions.filter((v) => v.objectType === "evidence_review")).toHaveLength(3);
  });

  it("13-15. memory, graph, and review restore reset approval when content changes", async () => {
    const { engine: e } = engine();
    const memoryId = "m1m1m1m1-m1m1-m1m1-m1m1-m1m1m1m1m1m1";
    const v1 = await e.recordMutation({
      organizationId: org,
      matterId: matter,
      actorUserId: userA,
      objectType: "memory",
      objectId: memoryId,
      operation: "create",
      source: "user",
      afterPayload: { title: "Fact", content: "A", status: "approved", sourceReference: { chunkId: "c1" } },
    });
    await e.recordMutation({
      organizationId: org,
      matterId: matter,
      actorUserId: userA,
      objectType: "memory",
      objectId: memoryId,
      operation: "update",
      source: "user",
      afterPayload: { title: "Fact", content: "B", status: "approved", sourceReference: { chunkId: "c1" } },
    });
    const restored = await e.restoreVersion({
      organizationId: org,
      matterId: matter,
      actorUserId: userA,
      objectType: "memory",
      objectId: memoryId,
      targetVersionId: v1.version.id,
      mode: "as_new_version",
      role: "editor",
      restoreApprovals: false,
    });
    expect(restored.version?.payload.content).toBe("A");
    expect(restored.version?.payload.status).toBe("proposed");
    expect(restored.version?.payload.sourceReference).toEqual({ chunkId: "c1" });
    expect(
      approvalAfterRestore({
        objectType: "graph_edge",
        currentPayload: { label: "x", status: "approved" },
        targetPayload: { label: "y", status: "approved" },
        restoreApprovals: false,
      }).status,
    ).toBe("proposed");
  });

  it("16-17. bulk restore skips objects later edited by others", async () => {
    const { engine: e } = engine();
    const a = "a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0";
    const b = "b0b0b0b0-b0b0-b0b0-b0b0-b0b0b0b0b0b0";
    const c = "c0c0c0c0-c0c0-c0c0-c0c0-c0c0c0c0c0c0";
    await e.recordMutation({
      organizationId: org,
      matterId: matter,
      actorUserId: userA,
      objectType: "note",
      objectId: a,
      operation: "update",
      source: "user",
      afterPayload: { content: "A1" },
    });
    await e.recordMutation({
      organizationId: org,
      matterId: matter,
      actorUserId: userA,
      objectType: "note",
      objectId: b,
      operation: "update",
      source: "user",
      afterPayload: { content: "B1" },
    });
    await e.recordMutation({
      organizationId: org,
      matterId: matter,
      actorUserId: userA,
      objectType: "note",
      objectId: c,
      operation: "update",
      source: "user",
      afterPayload: { content: "C1" },
    });
    const checkpoint = await e.createCheckpoint({
      organizationId: org,
      matterId: matter,
      actorUserId: userA,
      kind: "bulk",
      objects: [
        { objectType: "note", objectId: a },
        { objectType: "note", objectId: b },
        { objectType: "note", objectId: c },
      ],
    });
    await e.recordMutation({
      organizationId: org,
      matterId: matter,
      actorUserId: userA,
      objectType: "note",
      objectId: a,
      operation: "update",
      source: "bulk",
      afterPayload: { content: "A2" },
      checkpointId: checkpoint.checkpoint.id,
    });
    await e.recordMutation({
      organizationId: org,
      matterId: matter,
      actorUserId: userA,
      objectType: "note",
      objectId: b,
      operation: "update",
      source: "bulk",
      afterPayload: { content: "B2" },
      checkpointId: checkpoint.checkpoint.id,
    });
    await e.recordMutation({
      organizationId: org,
      matterId: matter,
      actorUserId: userB,
      objectType: "note",
      objectId: b,
      operation: "update",
      source: "user",
      afterPayload: { content: "B3 by B" },
    });
    const result = await e.restoreBulkAction({
      organizationId: org,
      matterId: matter,
      actorUserId: userA,
      checkpointId: checkpoint.checkpoint.id,
      role: "editor",
    });
    expect(result.restored).toHaveLength(1);
    expect(result.conflicts).toHaveLength(1);
    expect(result.summary).toContain("won't be overwritten");
  });

  it("18-19. session restore previews then restores only reversible own work", async () => {
    const { engine: e } = engine();
    const session = await e.startSession({
      organizationId: org,
      matterId: matter,
      actorUserId: userA,
      reason: "Hearing prep",
    });
    await seedDraft(e, "start");
    await e.recordMutation({
      organizationId: org,
      matterId: matter,
      actorUserId: userA,
      objectType: "draft",
      objectId: draftId,
      operation: "update",
      source: "ai",
      afterPayload: { content: "ai rewrite" },
      sessionId: session.id,
    });
    await e.recordMutation({
      organizationId: org,
      matterId: matter,
      actorUserId: userA,
      objectType: "draft",
      objectId: draftId,
      operation: "update",
      source: "user",
      afterPayload: { content: "attorney edit" },
      sessionId: session.id,
    });
    const preview = await e.previewSessionRestore({
      organizationId: org,
      matterId: matter,
      actorUserId: userA,
      sessionId: session.id,
      role: "editor",
    });
    expect(preview.restorableCount).toBe(1);
    const executed = await e.restoreSession({
      organizationId: org,
      matterId: matter,
      actorUserId: userA,
      sessionId: session.id,
      role: "editor",
    });
    expect(executed.restored).toHaveLength(1);
    expect(executed.restored[0]?.version?.payload.content).toBe("start");
  });

  it("20-22. RBAC, cross-matter, and cross-tenant version lookups fail closed", async () => {
    const { engine: e } = engine();
    const v1 = await seedDraft(e, "secret");
    await expect(
      e.restoreVersion({
        organizationId: org,
        matterId: matter,
        actorUserId: userA,
        objectType: "draft",
        objectId: draftId,
        targetVersionId: v1.version.id,
        mode: "as_new_version",
        role: "viewer",
      }),
    ).rejects.toBeInstanceOf(LegalWorkForbiddenError);

    await expect(
      e.restoreVersion({
        organizationId: org,
        matterId: "33333333-3333-3333-3333-333333333333",
        actorUserId: userA,
        objectType: "draft",
        objectId: draftId,
        targetVersionId: v1.version.id,
        mode: "as_new_version",
        role: "editor",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("23. restoring an upstream object marks downstream work stale", async () => {
    const { store, engine: e } = engine();
    const timelineId = "tttttttt-tttt-tttt-tttt-tttttttttttt";
    const downstreamDraft = "ffffffff-ffff-ffff-ffff-ffffffffffff";
    const t1 = await e.recordMutation({
      organizationId: org,
      matterId: matter,
      actorUserId: userA,
      objectType: "timeline_event",
      objectId: timelineId,
      operation: "create",
      source: "user",
      afterPayload: { title: "old" },
    });
    await e.recordMutation({
      organizationId: org,
      matterId: matter,
      actorUserId: userA,
      objectType: "timeline_event",
      objectId: timelineId,
      operation: "update",
      source: "user",
      afterPayload: { title: "new" },
    });
    await e.recordMutation({
      organizationId: org,
      matterId: matter,
      actorUserId: userA,
      objectType: "draft",
      objectId: downstreamDraft,
      operation: "create",
      source: "ai",
      afterPayload: { content: "based on timeline" },
    });
    await e.restoreVersion({
      organizationId: org,
      matterId: matter,
      actorUserId: userA,
      objectType: "timeline_event",
      objectId: timelineId,
      targetVersionId: t1.version.id,
      mode: "as_new_version",
      role: "editor",
    });
    const stale = await e.listStaleMarkers({ organizationId: org, matterId: matter });
    expect(stale.some((m) => m.objectId === downstreamDraft && m.reason.includes("timeline"))).toBe(true);
    expect(store.versions.filter((v) => v.objectType === "draft")).toHaveLength(1);
  });

  it("24. retrying the same restoration idempotency key does not duplicate versions", async () => {
    const { store, engine: e } = engine();
    const v1 = await seedDraft(e, "one");
    await seedDraft(e, "two");
    const key = "idem-restore-1";
    const first = await e.restoreVersion({
      organizationId: org,
      matterId: matter,
      actorUserId: userA,
      objectType: "draft",
      objectId: draftId,
      targetVersionId: v1.version.id,
      mode: "as_new_version",
      role: "editor",
      idempotencyKey: key,
    });
    const second = await e.restoreVersion({
      organizationId: org,
      matterId: matter,
      actorUserId: userA,
      objectType: "draft",
      objectId: draftId,
      targetVersionId: v1.version.id,
      mode: "as_new_version",
      role: "editor",
      idempotencyKey: key,
    });
    expect(second.idempotent).toBe(true);
    expect(second.restoration?.id).toBe(first.restoration?.id);
    expect(store.versions).toHaveLength(3);
  });

  it("25. restoration records are append-only in the store (no update API)", async () => {
    const { store, engine: e } = engine();
    const v1 = await seedDraft(e, "one");
    await seedDraft(e, "two");
    await e.restoreVersion({
      organizationId: org,
      matterId: matter,
      actorUserId: userA,
      objectType: "draft",
      objectId: draftId,
      targetVersionId: v1.version.id,
      mode: "as_new_version",
      role: "editor",
    });
    expect(store.restorations).toHaveLength(1);
    expect(typeof store.insertRestoration).toBe("function");
    expect("updateRestoration" in store).toBe(false);
  });

  it("diff is deterministic for text and structured payloads", () => {
    const text = diffTextLines("a\nb", "a\nc");
    expect(text).toEqual([{ path: "line 2", kind: "changed", before: "b", after: "c" }]);
    const structured = diffPayloads({ relevance: "relevant", notes: "x" }, { relevance: "not_relevant", notes: "x" });
    expect(structured).toEqual([
      { path: "relevance", kind: "changed", before: "relevant", after: "not_relevant" },
    ]);
  });

  it("optimistic conflict helper reports newer work", () => {
    const conflict = detectOptimisticConflict({
      head: {
        id: "h",
        organizationId: org,
        matterId: matter,
        objectType: "draft",
        objectId: draftId,
        currentVersionId: "v2",
        currentVersionNumber: 2,
        lockState: "unlocked",
        lockedAt: null,
        lockedByUserId: null,
        updatedAt: new Date(),
      },
      expectedVersionId: "v1",
    });
    expect(conflict?.kind).toBe("expected_mismatch");
    expect(detectUndoConflict({
      head: {
        id: "h",
        organizationId: org,
        matterId: matter,
        objectType: "draft",
        objectId: draftId,
        currentVersionId: "v5",
        currentVersionNumber: 5,
        lockState: "unlocked",
        lockedAt: null,
        lockedByUserId: null,
        updatedAt: new Date(),
      },
      lastAction: {
        id: "a",
        organizationId: org,
        matterId: matter,
        actorUserId: userA,
        objectType: "draft",
        objectId: draftId,
        operation: "update",
        source: "user",
        beforeVersionId: "v3",
        afterVersionId: "v4",
        sessionId: null,
        checkpointId: null,
        parentActionId: null,
        reversible: true,
        irreversibleReason: null,
        description: "Updated",
        aiArtifactId: null,
        provider: null,
        model: null,
        createdAt: new Date(),
      },
      currentVersion: {
        id: "v5",
        organizationId: org,
        matterId: matter,
        objectType: "draft",
        objectId: draftId,
        versionNumber: 5,
        payload: {},
        actorUserId: userB,
        source: "user",
        priorVersionId: "v4",
        actionId: null,
        restorationOfVersionId: null,
        nativeVersionId: null,
        createdAt: new Date(),
      },
      actorUserId: userA,
    })?.kind).toBe("newer_edit");
  });
});
