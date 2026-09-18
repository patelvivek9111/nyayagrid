/**
 * Queue #9 storage-growth + performance sample (local Postgres).
 * Synthetic only. Does not touch staging.
 */
import { performance } from "node:perf_hooks";
import {
  closeDb,
  createDb,
  createOrganizationWithDefaults,
  users,
  clients,
  matters,
  matterMembers,
  notes,
  sql,
} from "@nyayagrid/database";
import { createLegalWorkEngine } from "../index";

const databaseUrl =
  process.env.DATABASE_URL ?? "postgresql://nyayagrid:nyayagrid@127.0.0.1:5433/nyayagrid";

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx]!;
}

function summarize(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    n: sorted.length,
    medianMs: Math.round(pct(sorted, 50) * 100) / 100,
    p95Ms: Math.round(pct(sorted, 95) * 100) / 100,
    meanMs: Math.round((sum / sorted.length) * 100) / 100,
  };
}

async function main() {
  const db = createDb(databaseUrl);
  const suffix = `q9sg_${Date.now().toString(36)}`;
  const engine = createLegalWorkEngine(db);

  const [owner] = await db
    .insert(users)
    .values({
      authSubject: `sg_owner_${suffix}`,
      email: `sg_owner_${suffix}@example.nyayagrid.local`,
      name: "Storage Growth",
    })
    .returning();
  const org = await createOrganizationWithDefaults(db, {
    name: `SG Firm ${suffix}`,
    slug: `sg-firm-${suffix}`,
    type: "firm",
    ownerUserId: owner!.id,
  });
  const [client] = await db
    .insert(clients)
    .values({
      organizationId: org.organization.id,
      displayName: "SG Client",
      clientType: "individual",
      createdByUserId: owner!.id,
    })
    .returning();
  const [matter] = await db
    .insert(matters)
    .values({
      organizationId: org.organization.id,
      clientId: client!.id,
      matterNumber: `SG-${suffix}`,
      title: "Q9 Storage Growth Matter",
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

  const objectCount = 100;
  const versionsEach = 10;
  const noteIds: string[] = [];

  for (let i = 0; i < objectCount; i++) {
    const [note] = await db
      .insert(notes)
      .values({
        organizationId: org.organization.id,
        matterId: matter!.id,
        title: `Note ${i}`,
        content: `body-${i}-v1`,
        origin: "user",
        createdByUserId: owner!.id,
      })
      .returning();
    noteIds.push(note!.id);
    for (let v = 1; v <= versionsEach; v++) {
      await engine.recordMutation({
        organizationId: org.organization.id,
        matterId: matter!.id,
        actorUserId: owner!.id,
        objectType: "note",
        objectId: note!.id,
        operation: v === 1 ? "create" : "update",
        source: "user",
        afterPayload: { title: `Note ${i}`, content: `body-${i}-v${v}` },
        skipApply: v === 1,
      });
    }
  }

  const sizeRows = await db.execute(sql`
    select c.relname as name,
           pg_total_relation_size(c.oid)::bigint as bytes,
           coalesce(s.n_live_tup, 0)::bigint as approx_rows
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    left join pg_stat_user_tables s on s.relid = c.oid
    where n.nspname = 'public'
      and c.relname in (
        'legal_work_versions','legal_work_heads','legal_work_actions',
        'legal_work_restorations','legal_work_checkpoints','legal_work_checkpoint_items',
        'legal_work_stale_markers','legal_work_sessions','notes','draft_versions'
      )
      and c.relkind = 'r'
    order by c.relname
  `);

  const historySamples: number[] = [];
  const compareSamples: number[] = [];
  const restoreSamples: number[] = [];
  const undoSamples: number[] = [];
  const sampleIds = noteIds.slice(0, 20);

  for (const objectId of sampleIds) {
    const t0 = performance.now();
    const history = await engine.getVersionHistory({
      organizationId: org.organization.id,
      matterId: matter!.id,
      objectType: "note",
      objectId,
      role: "editor",
    });
    historySamples.push(performance.now() - t0);

    const from = history.versions[0]!;
    const to = history.versions[history.versions.length - 1]!;
    const t1 = performance.now();
    await engine.compareVersions({
      organizationId: org.organization.id,
      matterId: matter!.id,
      objectType: "note",
      objectId,
      fromVersionId: from.id,
      toVersionId: to.id,
      role: "editor",
    });
    compareSamples.push(performance.now() - t1);
  }

  for (const objectId of sampleIds.slice(0, 10)) {
    const history = await engine.getVersionHistory({
      organizationId: org.organization.id,
      matterId: matter!.id,
      objectType: "note",
      objectId,
      role: "editor",
    });
    const target = history.versions[0]!;
    const t2 = performance.now();
    await engine.restoreVersion({
      organizationId: org.organization.id,
      matterId: matter!.id,
      actorUserId: owner!.id,
      objectType: "note",
      objectId,
      targetVersionId: target.id,
      mode: "as_new_version",
      role: "editor",
    });
    restoreSamples.push(performance.now() - t2);

    await engine.recordMutation({
      organizationId: org.organization.id,
      matterId: matter!.id,
      actorUserId: owner!.id,
      objectType: "note",
      objectId,
      operation: "update",
      source: "user",
      afterPayload: { title: "undo-target", content: "after-restore-edit" },
    });
    const t3 = performance.now();
    await engine.undoLastAction({
      organizationId: org.organization.id,
      matterId: matter!.id,
      actorUserId: owner!.id,
      role: "editor",
      scope: "object",
      objectType: "note",
      objectId,
    });
    undoSamples.push(performance.now() - t3);
  }

  const session = await engine.startSession({
    organizationId: org.organization.id,
    matterId: matter!.id,
    actorUserId: owner!.id,
    reason: "perf session",
  });
  const sessionNote = noteIds[50]!;
  await engine.recordMutation({
    organizationId: org.organization.id,
    matterId: matter!.id,
    actorUserId: owner!.id,
    objectType: "note",
    objectId: sessionNote,
    operation: "update",
    source: "user",
    afterPayload: { title: "session", content: "session-edit" },
    sessionId: session.id,
  });
  const sessionPreviewSamples: number[] = [];
  const sessionRestoreSamples: number[] = [];
  for (let i = 0; i < 5; i++) {
    const tp = performance.now();
    await engine.previewSessionRestore({
      organizationId: org.organization.id,
      matterId: matter!.id,
      actorUserId: owner!.id,
      sessionId: session.id,
      role: "editor",
    });
    sessionPreviewSamples.push(performance.now() - tp);
  }
  const ts = performance.now();
  await engine.restoreSession({
    organizationId: org.organization.id,
    matterId: matter!.id,
    actorUserId: owner!.id,
    sessionId: session.id,
    role: "editor",
    idempotencyKey: `sg-session-${suffix}`,
  });
  sessionRestoreSamples.push(performance.now() - ts);

  const bulkIds = noteIds.slice(60, 70);
  const bulkOps = bulkIds.map((objectId) => ({
    objectType: "note" as const,
    objectId,
    operation: "update" as const,
    afterPayload: { title: "bulk", content: "bulk-after" },
  }));
  const { runBulkLegalWorkMutations } = await import("../recovery/bulk");
  const bulkStart = performance.now();
  const bulk = await runBulkLegalWorkMutations({
    db,
    organizationId: org.organization.id,
    matterId: matter!.id,
    actorUserId: owner!.id,
    reason: "storage growth bulk",
    operations: bulkOps,
  });
  const bulkMutateMs = performance.now() - bulkStart;
  const bulkRestoreSamples: number[] = [];
  for (let i = 0; i < 5; i++) {
    const tb = performance.now();
    await engine.restoreBulkAction({
      organizationId: org.organization.id,
      matterId: matter!.id,
      actorUserId: owner!.id,
      checkpointId: bulk.checkpoint.id,
      role: "editor",
      idempotencyKey: `sg-bulk-${suffix}-${i}`,
    });
    bulkRestoreSamples.push(performance.now() - tb);
  }

  const versionRows = await db.execute(sql`
    select count(*)::int as n,
           coalesce(sum(pg_column_size(payload)),0)::bigint as payload_bytes
    from legal_work_versions
    where matter_id = ${matter!.id}
  `);

  const report = {
    metric: "legal_work_recovery_storage_perf",
    matterId: matter!.id,
    objects: objectCount,
    versionsEach,
    expectedVersions: objectCount * versionsEach,
    relationSizes: (sizeRows as unknown as { rows?: Array<Record<string, unknown>> }).rows ?? sizeRows,
    versionPayload: (versionRows as unknown as { rows?: Array<Record<string, unknown>> }).rows?.[0] ?? versionRows,
    performance: {
      history: summarize(historySamples),
      compare: summarize(compareSamples),
      restore: summarize(restoreSamples),
      undo: summarize(undoSamples),
      sessionPreview: summarize(sessionPreviewSamples),
      sessionRestore: summarize(sessionRestoreSamples),
      bulkMutateMs: Math.round(bulkMutateMs),
      bulkRestore: summarize(bulkRestoreSamples),
    },
    draftDedupNote:
      "Draft bodies remain in draft_versions; legal_work_versions.native_version_id references them without duplicating large content blobs.",
  };

  console.log(JSON.stringify(report, null, 2));
  await closeDb(db);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
