import { and, eq } from "drizzle-orm";
import { legalAuthorities, matterAuthorities, tasks, type Database } from "@nyayagrid/database";
import { requireMatterAccess } from "@nyayagrid/permissions";
import { loadCivilClaimsReview } from "../civil/adapter";
import { loadDiscoveryLedgerReview } from "../discovery-ledger/adapter";
import { loadMatterMotionsCommunicationsReview } from "../motions-communications/postgres";
import { loadVerifiedMatterIntelligence } from "../verified";
import { assembleWholeMatterIntelligence } from "./assemble";
import type { AuthorityContextItem, WholeMatterIntelligence } from "./types";

/** Map ingestion/corpus signals to honesty buckets — never treat failed/processing as resolved. */
export function resolveAuthorityResolutionBucket(row: {
  ingestionStatus?: string | null;
  metadata?: Record<string, unknown> | null;
}): AuthorityContextItem["resolution"] {
  const meta = row.metadata ?? {};
  const corpusComplete = meta.corpusComplete === true || meta.fullTextPresent === true;
  if (corpusComplete) return "CORPUS_COMPLETE";
  if (
    row.ingestionStatus === "ready" ||
    row.ingestionStatus === "indexed" ||
    row.ingestionStatus === "imported"
  ) {
    return "AUTHORITY_RESOLVED";
  }
  // pending | processing | failed | null | unknown — identity not verified
  return "IDENTITY_UNRESOLVED";
}

async function loadMatterAuthorityContext(
  db: Database,
  params: { organizationId: string; matterId: string },
): Promise<AuthorityContextItem[]> {
  const rows = await db
    .select({
      matterAuthorityId: matterAuthorities.id,
      authorityId: matterAuthorities.authorityId,
      citation: legalAuthorities.citation,
      title: legalAuthorities.title,
      ingestionStatus: legalAuthorities.ingestionStatus,
      metadata: legalAuthorities.metadata,
    })
    .from(matterAuthorities)
    .innerJoin(legalAuthorities, eq(legalAuthorities.id, matterAuthorities.authorityId))
    .where(
      and(
        eq(matterAuthorities.organizationId, params.organizationId),
        eq(matterAuthorities.matterId, params.matterId),
      ),
    )
    .limit(100);

  return rows.map((row) => {
    const meta = (row.metadata ?? {}) as Record<string, unknown>;
    const treatmentVerified = meta.treatmentVerified === true;
    const resolution = resolveAuthorityResolutionBucket({
      ingestionStatus: row.ingestionStatus,
      metadata: meta,
    });
    return {
      id: row.authorityId,
      citation: row.citation,
      title: row.title,
      // Identity/corpus buckets stay independent of treatment verification.
      resolution,
      treatmentVerified,
      relatedClaimIds: [],
      relatedIssueIds: [],
    };
  });
}

/**
 * Batched whole-matter load — parallel domain loaders, single assemble pass.
 * Org/matter scoped via requireMatterAccess + each domain loader.
 */
export async function loadWholeMatterIntelligence(
  db: Database,
  params: { userId: string; organizationId: string; matterId: string },
): Promise<WholeMatterIntelligence> {
  await requireMatterAccess(db, {
    userId: params.userId,
    matterId: params.matterId,
    minAccess: "read",
    capability: "matters.view",
  });

  const [civil, discovery, motionsComms, verified, taskRows, authorities] = await Promise.all([
    loadCivilClaimsReview(db, params).catch(() => null),
    loadDiscoveryLedgerReview(db, params).catch(() => null),
    loadMatterMotionsCommunicationsReview(db, params).catch(() => null),
    loadVerifiedMatterIntelligence({
      db,
      organizationId: params.organizationId,
      matterId: params.matterId,
    }).catch(() => null),
    db
      .select({
        id: tasks.id,
        title: tasks.title,
        status: tasks.status,
        dueAt: tasks.dueAt,
      })
      .from(tasks)
      .where(and(eq(tasks.organizationId, params.organizationId), eq(tasks.matterId, params.matterId)))
      .limit(500)
      .catch(() => []),
    loadMatterAuthorityContext(db, params).catch(() => []),
  ]);

  return assembleWholeMatterIntelligence({
    organizationId: params.organizationId,
    matterId: params.matterId,
    civil,
    discovery,
    motionsComms,
    verified: verified
      ? {
          facts: verified.facts.map((f) => ({
            id: f.id,
            label: f.label,
            value: f.value,
            status: f.status,
          })),
          events: verified.events.map((e) => ({
            id: e.id,
            title: e.title,
            eventType: e.eventType,
            eventDate: e.eventDate,
          })),
          deadlines: verified.deadlines.map((d) => ({
            id: d.id,
            title: d.title,
            dueAt: d.dueAt,
            dateKind: d.dateKind,
            status: d.status,
          })),
          entities: verified.entities.map((e) => ({
            id: e.id,
            displayName: e.displayName,
          })),
        }
      : null,
    tasks: taskRows,
    authorities,
  });
}
