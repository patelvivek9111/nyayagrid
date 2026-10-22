/**
 * Week 3 Slice 2 — Graph relevance + coverage honesty live certification.
 * Local product DB only. CourtListener: 0. Shared schema migration: none.
 *
 * Requires SHARED_RUNTIME_LOCK.
 * RUN_DB_TESTS=1 DATABASE_URL=postgresql://nyayagrid:nyayagrid@localhost:5433/nyayagrid
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, asc, eq, sql } from "drizzle-orm";
import { MockAIProvider } from "@nyayagrid/ai";
import {
  closeDb,
  createDb,
  createOrganizationWithDefaults,
  clients,
  documentChunks,
  documentVersions,
  documents,
  graphEdges,
  graphEdgeSources,
  graphNodes,
  matters,
  matterMembers,
  users,
  isLocalCertificationDatabaseUrl,
} from "@nyayagrid/database";
import {
  extractGraphRelationshipCandidates,
  GraphFocusRejectedError,
  GRAPH_EXTRACT_CHUNK_CAP,
  GRAPH_EXTRACT_NODE_CAP,
} from "./index";

const runDbTests = process.env.RUN_DB_TESTS === "1";
const databaseUrl =
  process.env.DATABASE_URL ?? "postgresql://nyayagrid:nyayagrid@localhost:5433/nyayagrid";

type TimingBag = {
  wholeMatterMs: number;
  focusedMs: number;
  smallMatterMs: number;
  largeMatterMs: number;
};

const timings: TimingBag = {
  wholeMatterMs: 0,
  focusedMs: 0,
  smallMatterMs: 0,
  largeMatterMs: 0,
};

describe.runIf(runDbTests)("Week 3 Slice 2 graph relevance live certification (local DB)", () => {
  const db = createDb(databaseUrl);
  const suffix = randomUUID().slice(0, 8);
  let organizationId = "";
  let userId = "";

  let smallMatterId = "";
  let largeMatterId = "";
  let foreignMatterId = "";

  let focusNodeId = "";
  let foreignNodeId = "";
  let lateClaimNodeId = "";
  let preferredDocId = "";
  let latePreferredChunkId = "";
  let largeDocCount = 0;

  beforeAll(async () => {
    expect(isLocalCertificationDatabaseUrl(databaseUrl)).toBe(true);

    const [owner] = await db
      .insert(users)
      .values({
        authSubject: `w3s2_graph_${suffix}`,
        email: `w3s2_graph_${suffix}@example.nyayagrid.local`,
        name: "W3S2 Graph Cert",
      })
      .returning();
    userId = owner!.id;

    const org = await createOrganizationWithDefaults(db, {
      name: `W3S2 Graph Org ${suffix}`,
      slug: `w3s2-graph-${suffix}`,
      type: "firm",
      ownerUserId: userId,
    });
    organizationId = org.organization.id;

    const [client] = await db
      .insert(clients)
      .values({
        organizationId,
        displayName: "W3S2 Client",
        clientType: "organization",
        status: "active",
        createdByUserId: userId,
      })
      .returning();

    const makeMatter = async (title: string, number: string) => {
      const [matter] = await db
        .insert(matters)
        .values({
          organizationId,
          clientId: client!.id,
          title,
          matterNumber: number,
          status: "open",
          createdByUserId: userId,
        })
        .returning();
      await db.insert(matterMembers).values({
        organizationId,
        matterId: matter!.id,
        userId,
        access: "edit",
      });
      return matter!.id;
    };

    smallMatterId = await makeMatter(`W3S2 Small ${suffix}`, `W3S2S-${suffix}`);
    largeMatterId = await makeMatter(`W3S2 Large ${suffix}`, `W3S2L-${suffix}`);
    foreignMatterId = await makeMatter(`W3S2 Foreign ${suffix}`, `W3S2F-${suffix}`);

    // --- Small matter: under caps ---
    const smallPersonId = randomUUID();
    const smallDocCanonical = randomUUID();
    const [smallDoc] = await db
      .insert(documents)
      .values({
        organizationId,
        matterId: smallMatterId,
        title: "Small Matter Memo",
        createdByUserId: userId,
      })
      .returning();
    const [smallVersion] = await db
      .insert(documentVersions)
      .values({
        organizationId,
        documentId: smallDoc!.id,
        versionNumber: 1,
        storageKey: `w3s2/${smallMatterId}/${smallDoc!.id}/v1`,
        contentType: "text/plain",
        byteSize: 32,
        sha256: `sha-small-${suffix}`,
        originalFilename: "small.txt",
        uploadedByUserId: userId,
      })
      .returning();
    await db.insert(documentChunks).values([
      {
        organizationId,
        matterId: smallMatterId,
        documentId: smallDoc!.id,
        documentVersionId: smallVersion!.id,
        chunkIndex: 0,
        content: "Alice works for Acme on the small matter.",
      },
      {
        organizationId,
        matterId: smallMatterId,
        documentId: smallDoc!.id,
        documentVersionId: smallVersion!.id,
        chunkIndex: 1,
        content: "Acme engaged Alice as counsel.",
      },
    ]);
    await db.insert(graphNodes).values([
      {
        organizationId,
        matterId: smallMatterId,
        nodeType: "person",
        canonicalEntityType: "matter_entity",
        canonicalEntityId: smallPersonId,
        displayName: "Alice",
        status: "approved",
        origin: "manual",
        createdByUserId: userId,
      },
      {
        organizationId,
        matterId: smallMatterId,
        nodeType: "organization",
        canonicalEntityType: "matter_entity",
        canonicalEntityId: randomUUID(),
        displayName: "Acme",
        status: "approved",
        origin: "manual",
        createdByUserId: userId,
      },
      {
        organizationId,
        matterId: smallMatterId,
        nodeType: "document",
        canonicalEntityType: "document",
        canonicalEntityId: smallDoc!.id,
        displayName: "Small Matter Memo",
        status: "approved",
        origin: "manual",
        createdByUserId: userId,
      },
      {
        organizationId,
        matterId: smallMatterId,
        nodeType: "claim",
        canonicalEntityType: "civil_claim",
        canonicalEntityId: randomUUID(),
        displayName: "Small Claim",
        status: "approved",
        origin: "manual",
        createdByUserId: userId,
      },
    ]);
    void smallDocCanonical;

    // --- Large matter: 55 early fillers (old blind first-40 would miss later claim) ---
    // Insert fillers first so createdAt ordering places claim beyond index 40.
    const fillerRows = Array.from({ length: 55 }, (_, i) => ({
      organizationId,
      matterId: largeMatterId,
      nodeType: "other" as const,
      canonicalEntityType: "synthetic_other",
      canonicalEntityId: randomUUID(),
      displayName: `Filler ${String(i).padStart(3, "0")}`,
      status: "approved" as const,
      origin: "manual" as const,
      createdByUserId: userId,
    }));
    await db.insert(graphNodes).values(fillerRows);

    const claimCanonical = randomUUID();
    const defenseCanonical = randomUUID();
    const motionCanonical = randomUUID();
    const personCanonical = randomUUID();
    const specialInserted = await db
      .insert(graphNodes)
      .values([
        {
          organizationId,
          matterId: largeMatterId,
          nodeType: "claim",
          canonicalEntityType: "civil_claim",
          canonicalEntityId: claimCanonical,
          displayName: "Late Claim Beyond Cap",
          status: "approved",
          origin: "manual",
          createdByUserId: userId,
        },
        {
          organizationId,
          matterId: largeMatterId,
          nodeType: "defense",
          canonicalEntityType: "civil_defense",
          canonicalEntityId: defenseCanonical,
          displayName: "Defense Node",
          status: "approved",
          origin: "manual",
          createdByUserId: userId,
        },
        {
          organizationId,
          matterId: largeMatterId,
          nodeType: "motion",
          canonicalEntityType: "matter_motion",
          canonicalEntityId: motionCanonical,
          displayName: "Motion Node",
          status: "approved",
          origin: "manual",
          createdByUserId: userId,
        },
        {
          organizationId,
          matterId: largeMatterId,
          nodeType: "person",
          canonicalEntityType: "matter_entity",
          canonicalEntityId: personCanonical,
          displayName: "Focus Person",
          status: "approved",
          origin: "manual",
          createdByUserId: userId,
        },
      ])
      .returning();
    lateClaimNodeId = specialInserted.find((n) => n.canonicalEntityId === claimCanonical)!.id;
    focusNodeId = specialInserted.find((n) => n.canonicalEntityId === personCanonical)!.id;

    const [foreignNode] = await db
      .insert(graphNodes)
      .values({
        organizationId,
        matterId: foreignMatterId,
        nodeType: "person",
        canonicalEntityType: "matter_entity",
        canonicalEntityId: randomUUID(),
        displayName: "Foreign Person",
        status: "approved",
        origin: "manual",
        createdByUserId: userId,
      })
      .returning();
    foreignNodeId = foreignNode!.id;

    // 500+ documents. Insert early incidental chunks first, then preferred evidence doc last
    // so createdAt-ordered "old blind first 24" cannot include preferred chunks.
    largeDocCount = 510;
    const BATCH = 50;
    async function insertDocBatch(indices: number[], opts: { preferred?: boolean }): Promise<void> {
      const docs = await db
        .insert(documents)
        .values(
          indices.map((d) => ({
            organizationId,
            matterId: largeMatterId,
            title: opts.preferred ? "Exhibit Evidence Packet" : `Doc ${d}`,
            createdByUserId: userId,
          })),
        )
        .returning();
      const versions = await db
        .insert(documentVersions)
        .values(
          docs.map((doc, j) => ({
            organizationId,
            documentId: doc.id,
            versionNumber: 1,
            storageKey: `w3s2/${largeMatterId}/${doc.id}/v1`,
            contentType: "text/plain",
            byteSize: 64,
            sha256: `sha256-w3s2-${suffix}-${indices[j]}`,
            originalFilename: `doc-${indices[j]}.txt`,
            uploadedByUserId: userId,
          })),
        )
        .returning();
      const chunkRows = [];
      const nodeRows = [];
      for (let j = 0; j < docs.length; j++) {
        const doc = docs[j]!;
        const version = versions[j]!;
        const chunksPerDoc = opts.preferred ? 5 : 1;
        for (let c = 0; c < chunksPerDoc; c++) {
          chunkRows.push({
            organizationId,
            matterId: largeMatterId,
            documentId: doc.id,
            documentVersionId: version.id,
            chunkIndex: c,
            content: opts.preferred
              ? `Preferred evidence chunk ${c} — claim defense motion hearing.`
              : `Early incidental chunk for doc ${indices[j]}.`,
          });
        }
        nodeRows.push({
          organizationId,
          matterId: largeMatterId,
          nodeType: "document" as const,
          canonicalEntityType: "document",
          canonicalEntityId: doc.id,
          displayName: opts.preferred ? "Exhibit Evidence Packet" : `Document ${indices[j]}`,
          status: "approved" as const,
          origin: "manual" as const,
          createdByUserId: userId,
        });
        if (opts.preferred) preferredDocId = doc.id;
      }
      const insertedChunks = await db.insert(documentChunks).values(chunkRows).returning();
      await db.insert(graphNodes).values(nodeRows);
      if (opts.preferred) {
        latePreferredChunkId = insertedChunks.sort((a, b) => b.chunkIndex - a.chunkIndex)[0]!.id;
      }
    }

    // Early docs 0..508 (509 docs), then preferred as last index 509.
    for (let start = 0; start < largeDocCount - 1; start += BATCH) {
      const end = Math.min(start + BATCH, largeDocCount - 1);
      await insertDocBatch(
        Array.from({ length: end - start }, (_, j) => start + j),
        { preferred: false },
      );
    }
    await insertDocBatch([largeDocCount - 1], { preferred: true });
    // Force preferred chunks to a later createdAt so createdAt-ordered old-blind proof is unambiguous
    // even when batch inserts share the same timestamp.
    await db
      .update(documentChunks)
      .set({ createdAt: new Date(Date.now() + 60_000) })
      .where(
        and(
          eq(documentChunks.matterId, largeMatterId),
          eq(documentChunks.documentId, preferredDocId),
        ),
      );
    await db
      .update(graphNodes)
      .set({ createdAt: new Date(Date.now() + 60_000) })
      .where(eq(graphNodes.id, lateClaimNodeId));

    // Seed must expose the evidence document node; without it preferred-chunk
    // selection relies on soft-cap UUID luck and flakes under CI load.
    const preferredNodes = await db
      .select({ id: graphNodes.id, displayName: graphNodes.displayName })
      .from(graphNodes)
      .where(
        and(
          eq(graphNodes.matterId, largeMatterId),
          eq(graphNodes.organizationId, organizationId),
          eq(graphNodes.canonicalEntityId, preferredDocId),
        ),
      );
    expect(preferredNodes.length).toBe(1);
    expect(preferredNodes[0]!.displayName).toMatch(/evidence|exhibit/i);
  }, 300_000);

  afterAll(async () => {
    // eslint-disable-next-line no-console
    console.log("[w3s2-graph-live] timings_ms", JSON.stringify(timings));
    await closeDb(db);
  });

  it("1. small matter: full coverage, provenance path intact", async () => {
    const t0 = performance.now();
    const result = await extractGraphRelationshipCandidates({
      db,
      organizationId,
      matterId: smallMatterId,
      userId,
      ai: new MockAIProvider(),
    });
    timings.smallMatterMs = performance.now() - t0;

    const eligibleNodes = await db
      .select({ id: graphNodes.id })
      .from(graphNodes)
      .where(
        and(
          eq(graphNodes.matterId, smallMatterId),
          eq(graphNodes.organizationId, organizationId),
          eq(graphNodes.status, "approved"),
        ),
      );
    const [chunkCountRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(documentChunks)
      .where(
        and(
          eq(documentChunks.matterId, smallMatterId),
          eq(documentChunks.organizationId, organizationId),
        ),
      );
    const chunkCount = Number(chunkCountRow?.count) || 0;

    expect(result.coverage!.selectionMode).toBe("WHOLE_MATTER");
    expect(result.coverage!.candidateNodes).toBe(eligibleNodes.length);
    expect(result.coverage!.selectedNodes).toBe(eligibleNodes.length);
    expect(result.coverage!.candidateChunks).toBe(chunkCount);
    expect(result.coverage!.selectedChunks).toBe(chunkCount);
    expect(result.coverage!.coverageLimited).toBe(false);
    expect(result.coverage!.truncated).toBe(false);
    expect(result.coverage!.omittedNodeCount).toBe(0);
    expect(result.coverage!.omittedChunkCount).toBe(0);
    expect(result.coverage!.selectionBasis).toBe("relevance_ranked_bounded");
    expect(result.coverage!.selectedNodeIds.length).toBe(eligibleNodes.length);
    expect(result.coverage!.selectedChunkIds.length).toBe(chunkCount);

    // Provenance gate remains: any AI edges must have sources.
    const aiEdges = await db
      .select()
      .from(graphEdges)
      .where(and(eq(graphEdges.matterId, smallMatterId), eq(graphEdges.origin, "ai")));
    for (const edge of aiEdges) {
      const sources = await db
        .select()
        .from(graphEdgeSources)
        .where(eq(graphEdgeSources.graphEdgeId, edge.id));
      expect(sources.length).toBeGreaterThan(0);
    }
  }, 60_000);

  it("2–5 + 7–8. large whole-matter: bounded, beyond-old-cap, diversity, coverage", async () => {
    const t0 = performance.now();
    const result = await extractGraphRelationshipCandidates({
      db,
      organizationId,
      matterId: largeMatterId,
      userId,
      ai: new MockAIProvider(),
    });
    timings.wholeMatterMs = performance.now() - t0;
    timings.largeMatterMs = timings.wholeMatterMs;

    const cov = result.coverage!;
    expect(cov.selectionMode).toBe("WHOLE_MATTER");
    expect(cov.selectedNodes).toBeLessThanOrEqual(GRAPH_EXTRACT_NODE_CAP);
    expect(cov.selectedChunks).toBeLessThanOrEqual(GRAPH_EXTRACT_CHUNK_CAP);
    expect(cov.candidateNodes).toBeGreaterThan(GRAPH_EXTRACT_NODE_CAP);
    expect(cov.candidateChunks).toBeGreaterThan(GRAPH_EXTRACT_CHUNK_CAP);
    expect(cov.coverageLimited).toBe(true);
    expect(cov.truncated).toBe(true);
    expect(cov.omittedNodeCount).toBe(Math.max(cov.candidateNodes - cov.selectedNodes, 0));
    expect(cov.omittedChunkCount).toBe(Math.max(cov.candidateChunks - cov.selectedChunks, 0));
    expect(cov.selectionBasis).toBe("relevance_ranked_bounded");
    expect(cov.domainsRepresented.length).toBeGreaterThan(1);
    expect(cov.domainsRepresented).toEqual(
      [...cov.domainsRepresented].sort((a, b) => a.localeCompare(b)),
    );

    // Beyond-old-cap NODE proof: measure createdAt order (insertion order proxy).
    const orderedByCreated = await db
      .select({
        id: graphNodes.id,
        displayName: graphNodes.displayName,
        nodeType: graphNodes.nodeType,
      })
      .from(graphNodes)
      .where(
        and(
          eq(graphNodes.matterId, largeMatterId),
          eq(graphNodes.organizationId, organizationId),
          eq(graphNodes.status, "approved"),
        ),
      )
      .orderBy(asc(graphNodes.createdAt), asc(graphNodes.id));
    const oldBlindNodeIds = orderedByCreated.slice(0, 40).map((n) => n.id);
    expect(oldBlindNodeIds).not.toContain(lateClaimNodeId);
    expect(orderedByCreated.findIndex((n) => n.id === lateClaimNodeId)).toBeGreaterThanOrEqual(40);
    expect(cov.selectedNodeIds).toContain(lateClaimNodeId);

    // Beyond-old-cap CHUNK proof: old blind approximated as first 24 by createdAt (seed order).
    const orderedChunks = await db
      .select({
        id: documentChunks.id,
        documentId: documentChunks.documentId,
        chunkIndex: documentChunks.chunkIndex,
      })
      .from(documentChunks)
      .where(
        and(
          eq(documentChunks.matterId, largeMatterId),
          eq(documentChunks.organizationId, organizationId),
        ),
      )
      .orderBy(asc(documentChunks.createdAt), asc(documentChunks.id));
    const oldBlindChunkIds = orderedChunks.slice(0, 24).map((c) => c.id);
    const preferredChunks = orderedChunks.filter((c) => c.documentId === preferredDocId);
    expect(preferredChunks.length).toBeGreaterThan(0);
    for (const pc of preferredChunks) {
      expect(oldBlindChunkIds).not.toContain(pc.id);
    }
    const preferredIndex = orderedChunks.findIndex((c) => c.documentId === preferredDocId);
    expect(preferredIndex).toBeGreaterThanOrEqual(24);
    const selectedPreferred = cov.selectedChunkIds.filter((id) =>
      preferredChunks.some((c) => c.id === id),
    );
    expect(selectedPreferred.length).toBeGreaterThan(0);
    expect(selectedPreferred.every((id) => !oldBlindChunkIds.includes(id))).toBe(true);
    expect(latePreferredChunkId).toBeTruthy();

    // Diversity
    expect(new Set(cov.domainsRepresented).size).toBeGreaterThan(1);
    const selectedChunkRows = orderedChunks.filter((c) => cov.selectedChunkIds.includes(c.id));
    const byDoc = new Map<string, number>();
    for (const c of selectedChunkRows) {
      byDoc.set(c.documentId, (byDoc.get(c.documentId) ?? 0) + 1);
    }
    expect(byDoc.size).toBeGreaterThan(1);
    const maxFromOne = Math.max(...byDoc.values());
    expect(maxFromOne).toBeLessThan(cov.selectedChunks);
    expect(maxFromOne).toBeLessThanOrEqual(6);

    expect(largeDocCount).toBeGreaterThanOrEqual(500);
    // eslint-disable-next-line no-console
    console.log(
      "[w3s2-graph-live] large_coverage",
      JSON.stringify({
        candidateNodes: cov.candidateNodes,
        selectedNodes: cov.selectedNodes,
        candidateChunks: cov.candidateChunks,
        selectedChunks: cov.selectedChunks,
        coverageLimited: cov.coverageLimited,
        truncated: cov.truncated,
        omittedNodeCount: cov.omittedNodeCount,
        omittedChunkCount: cov.omittedChunkCount,
        domainsRepresented: cov.domainsRepresented,
        selectionBasis: cov.selectionBasis,
        maxChunksFromOneDoc: maxFromOne,
        docsRepresented: byDoc.size,
        lateClaimIndex: orderedByCreated.findIndex((n) => n.id === lateClaimNodeId),
        preferredChunkCreatedAtIndex: preferredIndex,
        selectedPreferredCount: selectedPreferred.length,
        largeDocCount,
      }),
    );
  }, 120_000);

  it("4. repeated run: identical selection IDs and coverage counts", async () => {
    const a = await extractGraphRelationshipCandidates({
      db,
      organizationId,
      matterId: largeMatterId,
      userId,
      ai: new MockAIProvider(),
    });
    const b = await extractGraphRelationshipCandidates({
      db,
      organizationId,
      matterId: largeMatterId,
      userId,
      ai: new MockAIProvider(),
    });
    expect(a.coverage!.selectedNodeIds).toEqual(b.coverage!.selectedNodeIds);
    expect(a.coverage!.selectedChunkIds).toEqual(b.coverage!.selectedChunkIds);
    expect(a.coverage!.selectionMode).toEqual(b.coverage!.selectionMode);
    expect(a.coverage!.candidateNodes).toBe(b.coverage!.candidateNodes);
    expect(a.coverage!.selectedNodes).toBe(b.coverage!.selectedNodes);
    expect(a.coverage!.candidateChunks).toBe(b.coverage!.candidateChunks);
    expect(a.coverage!.selectedChunks).toBe(b.coverage!.selectedChunks);
    expect(a.coverage!.omittedNodeCount).toBe(b.coverage!.omittedNodeCount);
    expect(a.coverage!.omittedChunkCount).toBe(b.coverage!.omittedChunkCount);
  }, 120_000);

  it("6 + 10. focused mode + foreign focus rejected + missing safe", async () => {
    const t0 = performance.now();
    const focused = await extractGraphRelationshipCandidates({
      db,
      organizationId,
      matterId: largeMatterId,
      userId,
      focusNodeId,
      ai: new MockAIProvider(),
    });
    timings.focusedMs = performance.now() - t0;

    expect(focused.coverage!.selectionMode).toBe("FOCUSED");
    expect(focused.coverage!.selectedNodeIds[0]).toBe(focusNodeId);
    expect(focused.coverage!.selectedNodeIds).toContain(focusNodeId);

    await expect(
      extractGraphRelationshipCandidates({
        db,
        organizationId,
        matterId: largeMatterId,
        userId,
        focusNodeId: foreignNodeId,
        ai: new MockAIProvider(),
      }),
    ).rejects.toBeInstanceOf(GraphFocusRejectedError);

    // Foreign node must not appear in a successful whole-matter selection for large matter.
    const whole = await extractGraphRelationshipCandidates({
      db,
      organizationId,
      matterId: largeMatterId,
      userId,
      ai: new MockAIProvider(),
    });
    expect(whole.coverage!.selectedNodeIds).not.toContain(foreignNodeId);

    const missing = await extractGraphRelationshipCandidates({
      db,
      organizationId,
      matterId: largeMatterId,
      userId,
      focusNodeId: "00000000-0000-4000-8000-000000000099",
      ai: new MockAIProvider(),
    });
    expect(missing.coverage!.selectionMode).toBe("WHOLE_MATTER");
  }, 120_000);

  it("9. provenance: AI edges always have graph_edge_sources", async () => {
    const aiEdges = await db
      .select()
      .from(graphEdges)
      .where(and(eq(graphEdges.matterId, largeMatterId), eq(graphEdges.origin, "ai")));
    for (const edge of aiEdges) {
      const sources = await db
        .select()
        .from(graphEdgeSources)
        .where(eq(graphEdgeSources.graphEdgeId, edge.id));
      expect(sources.length).toBeGreaterThan(0);
      for (const src of sources) {
        expect(src.matterId).toBe(largeMatterId);
        expect(src.organizationId).toBe(organizationId);
      }
    }
  }, 30_000);

  it("performance: large-matter extract under application P95 budget", () => {
    expect(timings.largeMatterMs).toBeGreaterThan(0);
    expect(timings.largeMatterMs).toBeLessThan(6000);
    expect(timings.smallMatterMs).toBeLessThan(6000);
    // eslint-disable-next-line no-console
    console.log("[w3s2-graph-live] perf_summary", JSON.stringify(timings));
  });
});
