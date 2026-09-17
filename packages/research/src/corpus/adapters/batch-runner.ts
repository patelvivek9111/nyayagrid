/**
 * Checkpointed batch runner for LegalSourceAdapter discover → fetch → parse.
 */

import {
  emptyCheckpoint,
  type AdapterAuthorityRecord,
  type IngestCheckpoint,
  type LegalSourceAdapter,
} from "./types";

export type AdapterBatchPersistFn = (records: AdapterAuthorityRecord[]) => Promise<{
  imported: number;
  skipped: number;
}>;

export type AdapterBatchSummary = {
  adapterName: string;
  dryRun: boolean;
  imported: number;
  skipped: number;
  failed: number;
  quarantined: number;
  processed: number;
  checkpoint: IngestCheckpoint;
  records: AdapterAuthorityRecord[];
};

export async function runAdapterBatch(params: {
  adapter: LegalSourceAdapter;
  checkpoint?: IngestCheckpoint | null;
  dryRun?: boolean;
  maxItems?: number;
  persist?: AdapterBatchPersistFn;
}): Promise<AdapterBatchSummary> {
  const dryRun = params.dryRun ?? false;
  const maxItems = params.maxItems ?? 50;
  const checkpoint: IngestCheckpoint = params.checkpoint
    ? {
        ...params.checkpoint,
        completedExternalIds: [...params.checkpoint.completedExternalIds],
        failedExternalIds: [...params.checkpoint.failedExternalIds],
        quarantinedExternalIds: [...params.checkpoint.quarantinedExternalIds],
      }
    : emptyCheckpoint(params.adapter.name);

  if (checkpoint.adapterName !== params.adapter.name) {
    throw new Error(
      `Checkpoint adapterName "${checkpoint.adapterName}" does not match "${params.adapter.name}".`,
    );
  }

  const completed = new Set(checkpoint.completedExternalIds);
  let imported = 0;
  let skipped = 0;
  let failed = 0;
  let quarantined = 0;
  let processed = 0;
  const collected: AdapterAuthorityRecord[] = [];

  let cursor: string | undefined = checkpoint.cursor ?? undefined;

  while (processed < maxItems) {
    if (!params.adapter.discover) break;
    const page = await params.adapter.discover(cursor, Math.min(25, maxItems - processed));
    if (page.items.length === 0) {
      checkpoint.cursor = null;
      break;
    }

    const pending = page.items.filter((item) => !completed.has(item.sourceExternalId));
    if (pending.length === 0) {
      cursor = page.nextCursor;
      checkpoint.cursor = page.nextCursor ?? null;
      if (!page.nextCursor) break;
      continue;
    }

    const batch = pending.slice(0, maxItems - processed);
    let fetched =
      params.adapter.fetch != null
        ? await params.adapter.fetch(batch)
        : batch.map((item) => ({
            sourceExternalId: item.sourceExternalId,
            raw: item,
            retrievedAt: new Date().toISOString(),
            canonicalUrl: item.canonicalUrl,
          }));

    let parsed;
    try {
      parsed = await params.adapter.parse(fetched);
    } catch (error) {
      for (const item of batch) {
        failed += 1;
        checkpoint.failedExternalIds.push({
          id: item.sourceExternalId,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
      processed += batch.length;
      break;
    }

    quarantined += parsed.quarantined.length;
    for (const q of parsed.quarantined) {
      checkpoint.quarantinedExternalIds.push({ id: q.sourceExternalId, reason: q.reason });
      completed.add(q.sourceExternalId);
      checkpoint.completedExternalIds.push(q.sourceExternalId);
    }

    const records = parsed.records.map((r) => params.adapter.normalize?.(r) ?? r);
    const accepted: AdapterAuthorityRecord[] = [];
    for (const record of records) {
      const validation = params.adapter.validate?.(record) ?? { ok: true };
      if (!validation.ok) {
        quarantined += 1;
        checkpoint.quarantinedExternalIds.push({
          id: record.sourceExternalId,
          reason: validation.reason ?? "validation_failed",
        });
        completed.add(record.sourceExternalId);
        checkpoint.completedExternalIds.push(record.sourceExternalId);
        continue;
      }
      accepted.push(record);
      completed.add(record.sourceExternalId);
      checkpoint.completedExternalIds.push(record.sourceExternalId);
    }

    if (dryRun || !params.persist) {
      skipped += accepted.length;
      collected.push(...accepted);
    } else {
      try {
        const result = await params.persist(accepted);
        imported += result.imported;
        skipped += result.skipped;
        collected.push(...accepted);
      } catch (error) {
        for (const record of accepted) {
          failed += 1;
          checkpoint.failedExternalIds.push({
            id: record.sourceExternalId,
            reason: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    processed += batch.length;
    cursor = page.nextCursor;
    checkpoint.cursor = page.nextCursor ?? null;
    if (!page.nextCursor) break;
  }

  checkpoint.importedCount += imported;
  checkpoint.skippedCount += skipped;
  checkpoint.updatedAt = new Date().toISOString();

  return {
    adapterName: params.adapter.name,
    dryRun,
    imported,
    skipped,
    failed,
    quarantined,
    processed,
    checkpoint,
    records: collected,
  };
}
