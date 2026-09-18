import { afterAll, describe, expect, it } from "vitest";
import {
  closeDb,
  createDb,
  createOrganizationWithDefaults,
  users,
  clients,
  matters,
  matterMembers,
  notes,
  legalWorkVersions,
  legalWorkActions,
  legalWorkRestorations,
  legalWorkCheckpoints,
  eq,
  sql,
} from "@nyayagrid/database";
import { createDraft, saveDraftVersion, restoreDraftVersion, getDraftWithVersions } from "../draft";
import {
  createLegalWorkEngine,
  runBulkLegalWorkMutations,
  regenerateMatterSummary,
  getLatestMatterSummary,
} from "../index";
import { MockAIProvider } from "@nyayagrid/ai";
import {
  LegalWorkConflictError,
  LegalWorkForbiddenError,
  LegalWorkLockedError,
  LegalWorkNotFoundError,
} from "./errors";

const runDbTests = process.env.RUN_DB_TESTS === "1";
const databaseUrl = process.env.DATABASE_URL ?? "postgresql://nyayagrid:nyayagrid@127.0.0.1:5433/nyayagrid";

describe.runIf(runDbTests)("legal-work recovery postgres integration", () => {
  const db = createDb(databaseUrl);
  const suffix = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  afterAll(async () => {
    await closeDb(db);
  });

  async function seedMatter(label: string) {
    const [owner] = await db
      .insert(users)
      .values({
        authSubject: `lw_${label}_${suffix}`,
        email: `lw_${label}_${suffix}@example.nyayagrid.local`,
        name: "Owner",
      })
      .returning();
    const [other] = await db
      .insert(users)
      .values({
        authSubject: `lw_other_${label}_${suffix}`,
        email: `lw_other_${label}_${suffix}@example.nyayagrid.local`,
        name: "Other",
      })
      .returning();
    const org = await createOrganizationWithDefaults(db, {
      name: `LW ${label} ${suffix}`,
      slug: `lw-${label}-${suffix}`,
      type: "firm",
      ownerUserId: owner!.id,
    });
    const [client] = await db
      .insert(clients)
      .values({
        organizationId: org.organization.id,
        displayName: "Recovery Client",
        clientType: "individual",
        createdByUserId: owner!.id,
      })
      .returning();
    const [matter] = await db
      .insert(matters)
      .values({
        organizationId: org.organization.id,
        clientId: client!.id,
        matterNumber: `LW-${label}-${suffix}`,
        title: "Recovery Matter",
        status: "open",
        createdByUserId: owner!.id,
      })
      .returning();
    await db.insert(matterMembers).values({
      organizationId: org.organization.id,
      matterId: matter!.id,
      userId: owner!.id,
      access: "manage",
    });
    return {
      owner: owner!,
      other: other!,
      orgId: org.organization.id,
      matterId: matter!.id,
    };
  }

  it("Draft: restore creates new native version, keeps history, links generic row", async () => {
    const ctx = await seedMatter("draft");
    const created = await createDraft({
      db,
      organizationId: ctx.orgId,
      matterId: ctx.matterId,
      userId: ctx.owner.id,
      title: "Memo",
      draftType: "memo",
      content: "Version one body",
    });
    await saveDraftVersion({
      db,
      organizationId: ctx.orgId,
      matterId: ctx.matterId,
      draftId: created.draft.id,
      userId: ctx.owner.id,
      content: "AI rewrite body",
      // origin inferred via track as user unless we use transform; content alone is enough
    });
    await saveDraftVersion({
      db,
      organizationId: ctx.orgId,
      matterId: ctx.matterId,
      draftId: created.draft.id,
      userId: ctx.owner.id,
      content: "Attorney edit body",
    });
    const restored = await restoreDraftVersion({
      db,
      organizationId: ctx.orgId,
      matterId: ctx.matterId,
      draftId: created.draft.id,
      versionNumber: 1,
      userId: ctx.owner.id,
      idempotencyKey: `draft-restore-${created.draft.id}`,
    });
    expect(restored.versionNumber).toBe(4);
    expect(restored.content).toBe("Version one body");

    const withVersions = await getDraftWithVersions({
      db,
      organizationId: ctx.orgId,
      matterId: ctx.matterId,
      draftId: created.draft.id,
    });
    expect(withVersions?.versions.map((v) => v.versionNumber)).toEqual([1, 2, 3, 4]);
    expect(withVersions?.versions.map((v) => v.content)).toEqual([
      "Version one body",
      "AI rewrite body",
      "Attorney edit body",
      "Version one body",
    ]);

    const engine = createLegalWorkEngine(db);
    const history = await engine.getVersionHistory({
      organizationId: ctx.orgId,
      matterId: ctx.matterId,
      objectType: "draft",
      objectId: created.draft.id,
      role: "editor",
    });
    expect(history.versions.length).toBeGreaterThanOrEqual(4);
    const headVersion = history.versions.find((v) => v.id === history.head?.currentVersionId);
    expect(headVersion?.restorationOfVersionId).toBeTruthy();
    expect(headVersion?.nativeVersionId).toBe(restored.id);
    // Generic payload should reference native id rather than only embedding giant duplicate independently of native store
    expect(headVersion?.payload.nativeVersionId).toBe(restored.id);

    const again = await restoreDraftVersion({
      db,
      organizationId: ctx.orgId,
      matterId: ctx.matterId,
      draftId: created.draft.id,
      versionNumber: 1,
      userId: ctx.owner.id,
      idempotencyKey: `draft-restore-${created.draft.id}`,
    });
    expect(again.versionNumber).toBe(4);

    await expect(
      engine.recordMutation({
        organizationId: ctx.orgId,
        matterId: ctx.matterId,
        actorUserId: ctx.owner.id,
        objectType: "draft",
        objectId: created.draft.id,
        operation: "update",
        source: "user",
        afterPayload: { content: "stale" },
        expectedVersionNumber: 1,
        skipApply: true,
      }),
    ).rejects.toBeInstanceOf(LegalWorkConflictError);
  });

  it("bulk auto-checkpoint restores A, conflicts on B, keeps C lineage-safe", async () => {
    const ctx = await seedMatter("bulk");
    const [a, b, c] = await db
      .insert(notes)
      .values([
        {
          organizationId: ctx.orgId,
          matterId: ctx.matterId,
          title: "A",
          content: "A1",
          origin: "user",
          createdByUserId: ctx.owner.id,
        },
        {
          organizationId: ctx.orgId,
          matterId: ctx.matterId,
          title: "B",
          content: "B1",
          origin: "user",
          createdByUserId: ctx.owner.id,
        },
        {
          organizationId: ctx.orgId,
          matterId: ctx.matterId,
          title: "C",
          content: "C1",
          origin: "user",
          createdByUserId: ctx.owner.id,
        },
      ])
      .returning();

    const bulk = await runBulkLegalWorkMutations({
      db,
      organizationId: ctx.orgId,
      matterId: ctx.matterId,
      actorUserId: ctx.owner.id,
      reason: "Bulk note rewrite",
      operations: [
        { objectType: "note", objectId: a!.id, operation: "update", afterPayload: { title: "A", content: "A2" } },
        { objectType: "note", objectId: b!.id, operation: "update", afterPayload: { title: "B", content: "B2" } },
        { objectType: "note", objectId: c!.id, operation: "update", afterPayload: { title: "C", content: "C2" } },
      ],
    });
    expect(bulk.checkpoint.id).toBeTruthy();
    expect(bulk.applied).toHaveLength(3);

    const engine = createLegalWorkEngine(db);
    await engine.recordMutation({
      organizationId: ctx.orgId,
      matterId: ctx.matterId,
      actorUserId: ctx.other.id,
      objectType: "note",
      objectId: b!.id,
      operation: "update",
      source: "user",
      afterPayload: { title: "B", content: "B3 by other" },
    });
    await engine.recordMutation({
      organizationId: ctx.orgId,
      matterId: ctx.matterId,
      actorUserId: ctx.owner.id,
      objectType: "note",
      objectId: c!.id,
      operation: "update",
      source: "user",
      afterPayload: { title: "C", content: "C3 later by same user" },
    });

    const result = await engine.restoreBulkAction({
      organizationId: ctx.orgId,
      matterId: ctx.matterId,
      actorUserId: ctx.owner.id,
      checkpointId: bulk.checkpoint.id,
      role: "editor",
    });
    expect(result.restored.length).toBeGreaterThanOrEqual(1);
    expect(result.conflicts.length).toBeGreaterThanOrEqual(1);
    expect(result.summary).toContain("won't be overwritten");

    const [noteA] = await db.select().from(notes).where(eq(notes.id, a!.id)).limit(1);
    const [noteB] = await db.select().from(notes).where(eq(notes.id, b!.id)).limit(1);
    const [noteC] = await db.select().from(notes).where(eq(notes.id, c!.id)).limit(1);
    expect(noteA?.content).toBe("A1");
    expect(noteB?.content).toBe("B3 by other");
    // Later edits after the bulk action are not overwritten.
    expect(noteC?.content).toBe("C3 later by same user");
    expect(result.conflicts.some((row) => row.objectId === b!.id)).toBe(true);
    const cBlocked =
      result.conflicts.some((row) => row.objectId === c!.id) ||
      result.skipped.some((row) => row.objectId === c!.id);
    expect(cBlocked).toBe(true);
    expect(result.restored.some((r) => r.version?.objectId === a!.id)).toBe(true);
  });

  it("session preview/execute and collaborative undo conflict", async () => {
    const ctx = await seedMatter("session");
    const engine = createLegalWorkEngine(db);
    const [note] = await db
      .insert(notes)
      .values({
        organizationId: ctx.orgId,
        matterId: ctx.matterId,
        title: "Session note",
        content: "start",
        origin: "user",
        createdByUserId: ctx.owner.id,
      })
      .returning();
    // Baseline exists before the session so restore has a prior version.
    await engine.recordMutation({
      organizationId: ctx.orgId,
      matterId: ctx.matterId,
      actorUserId: ctx.owner.id,
      objectType: "note",
      objectId: note!.id,
      operation: "create",
      source: "user",
      afterPayload: { title: "Session note", content: "start" },
      skipApply: true,
    });
    const session = await engine.startSession({
      organizationId: ctx.orgId,
      matterId: ctx.matterId,
      actorUserId: ctx.owner.id,
      reason: "Hearing prep",
    });
    await engine.recordMutation({
      organizationId: ctx.orgId,
      matterId: ctx.matterId,
      actorUserId: ctx.owner.id,
      objectType: "note",
      objectId: note!.id,
      operation: "update",
      source: "user",
      afterPayload: { title: "Session note", content: "session edit" },
      sessionId: session.id,
    });
    await engine.recordMutation({
      organizationId: ctx.orgId,
      matterId: ctx.matterId,
      actorUserId: ctx.other.id,
      objectType: "note",
      objectId: note!.id,
      operation: "update",
      source: "user",
      afterPayload: { title: "Session note", content: "other later" },
    });

    const preview = await engine.previewSessionRestore({
      organizationId: ctx.orgId,
      matterId: ctx.matterId,
      actorUserId: ctx.owner.id,
      sessionId: session.id,
      role: "editor",
    });
    expect(preview.items.length).toBeGreaterThanOrEqual(1);
    expect(preview.conflictCount + preview.restorableCount + preview.irreversibleCount).toBeGreaterThan(0);
    expect(preview.conflictCount).toBeGreaterThanOrEqual(1);

    await expect(
      engine.undoLastAction({
        organizationId: ctx.orgId,
        matterId: ctx.matterId,
        actorUserId: ctx.owner.id,
        role: "editor",
        scope: "object",
        objectType: "note",
        objectId: note!.id,
      }),
    ).rejects.toBeInstanceOf(LegalWorkConflictError);
  });

  it("summary current pointer follows restore head, not only MAX(createdAt)", async () => {
    const ctx = await seedMatter("summary");
    const ai = new MockAIProvider();
    const first = await regenerateMatterSummary({
      db,
      organizationId: ctx.orgId,
      matterId: ctx.matterId,
      matterTitle: "Recovery Matter",
      userId: ctx.owner.id,
      ai,
    });
    const second = await regenerateMatterSummary({
      db,
      organizationId: ctx.orgId,
      matterId: ctx.matterId,
      matterTitle: "Recovery Matter",
      userId: ctx.owner.id,
      ai,
    });
    expect(second.id).not.toBe(first.id);
    const engine = createLegalWorkEngine(db);
    const history = await engine.getVersionHistory({
      organizationId: ctx.orgId,
      matterId: ctx.matterId,
      objectType: "summary",
      objectId: ctx.matterId,
      role: "editor",
    });
    const v1 = history.versions[0];
    expect(v1).toBeTruthy();
    await engine.restoreVersion({
      organizationId: ctx.orgId,
      matterId: ctx.matterId,
      actorUserId: ctx.owner.id,
      objectType: "summary",
      objectId: ctx.matterId,
      targetVersionId: v1!.id,
      mode: "as_new_version",
      role: "editor",
    });
    const current = await getLatestMatterSummary({
      db,
      organizationId: ctx.orgId,
      matterId: ctx.matterId,
    });
    expect(current?.id).not.toBe(second.id);
    expect(current?.summary).toBe(first.summary);
  });

  it("cross-tenant/matter IDOR fails closed; append-only triggers reject mutation", async () => {
    const a = await seedMatter("idor_a");
    const b = await seedMatter("idor_b");
    const engine = createLegalWorkEngine(db);
    const [note] = await db
      .insert(notes)
      .values({
        organizationId: a.orgId,
        matterId: a.matterId,
        title: "Secret",
        content: "tenant-a",
        origin: "user",
        createdByUserId: a.owner.id,
      })
      .returning();
    const recorded = await engine.recordMutation({
      organizationId: a.orgId,
      matterId: a.matterId,
      actorUserId: a.owner.id,
      objectType: "note",
      objectId: note!.id,
      operation: "create",
      source: "user",
      afterPayload: { title: "Secret", content: "tenant-a" },
      skipApply: true,
    });
    await expect(
      engine.restoreVersion({
        organizationId: b.orgId,
        matterId: b.matterId,
        actorUserId: b.owner.id,
        objectType: "note",
        objectId: note!.id,
        targetVersionId: recorded.version.id,
        mode: "as_new_version",
        role: "editor",
      }),
    ).rejects.toBeInstanceOf(LegalWorkNotFoundError);

    await expect(
      engine.restoreVersion({
        organizationId: a.orgId,
        matterId: a.matterId,
        actorUserId: a.owner.id,
        objectType: "note",
        objectId: note!.id,
        targetVersionId: recorded.version.id,
        mode: "as_new_version",
        role: "viewer",
      }),
    ).rejects.toBeInstanceOf(LegalWorkForbiddenError);

    async function expectAppendOnlyRejected(fn: () => Promise<unknown>) {
      try {
        await fn();
        expect.fail("expected append-only rejection");
      } catch (error) {
        const text = error instanceof Error ? `${error.message} ${String((error as { cause?: unknown }).cause ?? "")}` : String(error);
        expect(text).toMatch(/append-only|legal work history/i);
      }
    }

    await expectAppendOnlyRejected(() =>
      db.execute(sql`UPDATE ${legalWorkVersions} SET payload = '{}'::jsonb WHERE id = ${recorded.version.id}`),
    );
    await expectAppendOnlyRejected(() =>
      db.execute(sql`DELETE FROM ${legalWorkActions} WHERE id = ${recorded.action.id}`),
    );

    const checkpoint = await engine.createCheckpoint({
      organizationId: a.orgId,
      matterId: a.matterId,
      actorUserId: a.owner.id,
      kind: "bulk",
      objects: [{ objectType: "note", objectId: note!.id }],
    });
    await expectAppendOnlyRejected(() =>
      db.execute(sql`DELETE FROM ${legalWorkCheckpoints} WHERE id = ${checkpoint.checkpoint.id}`),
    );

    const after = await engine.recordMutation({
      organizationId: a.orgId,
      matterId: a.matterId,
      actorUserId: a.owner.id,
      objectType: "note",
      objectId: note!.id,
      operation: "update",
      source: "user",
      afterPayload: { title: "Secret", content: "changed" },
    });
    const restored = await engine.restoreVersion({
      organizationId: a.orgId,
      matterId: a.matterId,
      actorUserId: a.owner.id,
      objectType: "note",
      objectId: note!.id,
      targetVersionId: recorded.version.id,
      mode: "as_new_version",
      role: "editor",
      idempotencyKey: `idor-restore-${note!.id}`,
    });
    expect(restored.version?.versionNumber).toBe(after.version.versionNumber + 1);
    await expectAppendOnlyRejected(() =>
      db.execute(
        sql`UPDATE ${legalWorkRestorations} SET reason = 'tamper' WHERE id = ${restored.restoration!.id}`,
      ),
    );

    // locked/finalized head refuses restore
    const head = (
      await engine.getVersionHistory({
        organizationId: a.orgId,
        matterId: a.matterId,
        objectType: "note",
        objectId: note!.id,
        role: "editor",
      })
    ).head!;
    await db.execute(
      sql`UPDATE legal_work_heads SET lock_state = 'finalized' WHERE id = ${head.id}`,
    );
    await expect(
      engine.restoreVersion({
        organizationId: a.orgId,
        matterId: a.matterId,
        actorUserId: a.owner.id,
        objectType: "note",
        objectId: note!.id,
        targetVersionId: recorded.version.id,
        mode: "as_new_version",
        role: "editor",
      }),
    ).rejects.toBeInstanceOf(LegalWorkLockedError);
  });

  it("performance sample: history/restore/diff latency for modest volumes", async () => {
    const ctx = await seedMatter("perf");
    const engine = createLegalWorkEngine(db);
    const [note] = await db
      .insert(notes)
      .values({
        organizationId: ctx.orgId,
        matterId: ctx.matterId,
        title: "Perf",
        content: "v0",
        origin: "user",
        createdByUserId: ctx.owner.id,
      })
      .returning();
    let firstVersionId = "";
    for (let i = 1; i <= 12; i++) {
      const recorded = await engine.recordMutation({
        organizationId: ctx.orgId,
        matterId: ctx.matterId,
        actorUserId: ctx.owner.id,
        objectType: "note",
        objectId: note!.id,
        operation: i === 1 ? "create" : "update",
        source: "user",
        afterPayload: { title: "Perf", content: `v${i}` },
        skipApply: i === 1,
      });
      if (i === 1) firstVersionId = recorded.version.id;
    }
    const historyStart = performance.now();
    const history = await engine.getVersionHistory({
      organizationId: ctx.orgId,
      matterId: ctx.matterId,
      objectType: "note",
      objectId: note!.id,
      role: "editor",
    });
    const historyMs = performance.now() - historyStart;
    expect(history.versions.length).toBeGreaterThanOrEqual(12);

    const compareStart = performance.now();
    await engine.compareVersions({
      organizationId: ctx.orgId,
      matterId: ctx.matterId,
      objectType: "note",
      objectId: note!.id,
      fromVersionId: firstVersionId,
      toVersionId: history.head!.currentVersionId,
      role: "editor",
    });
    const compareMs = performance.now() - compareStart;

    const restoreStart = performance.now();
    await engine.restoreVersion({
      organizationId: ctx.orgId,
      matterId: ctx.matterId,
      actorUserId: ctx.owner.id,
      objectType: "note",
      objectId: note!.id,
      targetVersionId: firstVersionId,
      mode: "as_new_version",
      role: "editor",
    });
    const restoreMs = performance.now() - restoreStart;

    // Soft ceilings for local docker; record values for the report.
    expect(historyMs).toBeLessThan(2000);
    expect(compareMs).toBeLessThan(2000);
    expect(restoreMs).toBeLessThan(3000);
    console.log(
      JSON.stringify({
        metric: "legal_work_recovery_perf_sample",
        historyMs: Math.round(historyMs),
        compareMs: Math.round(compareMs),
        restoreMs: Math.round(restoreMs),
        versions: history.versions.length,
      }),
    );
  });
});
