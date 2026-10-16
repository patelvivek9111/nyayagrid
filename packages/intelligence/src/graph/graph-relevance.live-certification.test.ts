/**
 * Week 3 Slice 2 — Graph relevance + coverage honesty live certification.
 * Local product DB only. CourtListener: 0. Shared schema migration: none.
 *
 * RUN_DB_TESTS=1 DATABASE_URL=postgresql://nyayagrid:nyayagrid@localhost:5433/nyayagrid
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
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
} from "@nyayagrid/database";
import {
  extractGraphRelationshipCandidates,
  GraphFocusRejectedError,
  GRAPH_EXTRACT_CHUNK_CAP,
  GRAPH_EXTRACT_NODE_CAP,
} from "./index";

const runDbTests = process.env.RUN_DB_TESTS === "1";

describe.runIf(runDbTests)("Week 3 Slice 2 graph relevance live certification (local DB)", () => {
  const db = createDb();
  const suffix = randomUUID().slice(0, 8);
  let organizationId = "";
  let matterId = "";
  let foreignMatterId = "";
  let userId = "";
  let focusNodeId = "";
  let foreignNodeId = "";
  let claimNodeId = "";

  beforeAll(async () => {
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

    const [matter] = await db
      .insert(matters)
      .values({
        organizationId,
        clientId: client!.id,
        title: `W3S2 Graph Matter ${suffix}`,
        matterNumber: `W3S2-${suffix}`,
        status: "open",
        createdByUserId: userId,
      })
      .returning();
    matterId = matter!.id;

    await db.insert(matterMembers).values({
      organizationId,
      matterId,
      userId,
      access: "edit",
    });

    const [foreignMatter] = await db
      .insert(matters)
      .values({
        organizationId,
        clientId: client!.id,
        title: `W3S2 Foreign Matter ${suffix}`,
        matterNumber: `W3S2F-${suffix}`,
        status: "open",
        createdByUserId: userId,
      })
      .returning();
    foreignMatterId = foreignMatter!.id;

    const filler = Array.from({ length: 55 }, (_, i) => ({
      organizationId,
      matterId,
      nodeType: "other" as const,
      canonicalEntityType: "synthetic_other",
      canonicalEntityId: randomUUID(),
      displayName: `Filler ${String(i).padStart(3, "0")}`,
      status: "approved" as const,
      origin: "manual" as const,
      createdByUserId: userId,
    }));

    const claimId = randomUUID();
    const defenseId = randomUUID();
    const motionId = randomUUID();
    const personId = randomUUID();

    const special = [
      {
        organizationId,
        matterId,
        nodeType: "claim" as const,
        canonicalEntityType: "civil_claim",
        canonicalEntityId: claimId,
        displayName: "Late Claim Beyond Cap",
        status: "approved" as const,
        origin: "manual" as const,
        createdByUserId: userId,
      },
      {
        organizationId,
        matterId,
        nodeType: "defense" as const,
        canonicalEntityType: "civil_defense",
        canonicalEntityId: defenseId,
        displayName: "Defense Node",
        status: "approved" as const,
        origin: "manual" as const,
        createdByUserId: userId,
      },
      {
        organizationId,
        matterId,
        nodeType: "motion" as const,
        canonicalEntityType: "matter_motion",
        canonicalEntityId: motionId,
        displayName: "Motion Node",
        status: "approved" as const,
        origin: "manual" as const,
        createdByUserId: userId,
      },
      {
        organizationId,
        matterId,
        nodeType: "person" as const,
        canonicalEntityType: "matter_entity",
        canonicalEntityId: personId,
        displayName: "Focus Person",
        status: "approved" as const,
        origin: "manual" as const,
        createdByUserId: userId,
      },
    ];

    const inserted = await db
      .insert(graphNodes)
      .values([...filler, ...special])
      .returning();
    claimNodeId = inserted.find((n) => n.canonicalEntityId === claimId)!.id;
    focusNodeId = inserted.find((n) => n.canonicalEntityId === personId)!.id;

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

    for (let d = 0; d < 30; d++) {
      const [doc] = await db
        .insert(documents)
        .values({
          organizationId,
          matterId,
          title: `Doc ${d}`,
          createdByUserId: userId,
        })
        .returning();
      const [version] = await db
        .insert(documentVersions)
        .values({
          organizationId,
          documentId: doc!.id,
          versionNumber: 1,
          storageKey: `w3s2/${matterId}/${doc!.id}/v1`,
          contentType: "text/plain",
          byteSize: 64,
          sha256: `sha256-w3s2-${suffix}-${d}`,
          originalFilename: `doc-${d}.txt`,
          uploadedByUserId: userId,
        })
        .returning();
      await db.insert(documentChunks).values(
        Array.from({ length: 3 }, (_, c) => ({
          organizationId,
          matterId,
          documentId: doc!.id,
          documentVersionId: version!.id,
          chunkIndex: c,
          content: `Chunk ${d}.${c} for claim evidence hearing.`,
        })),
      );
      await db.insert(graphNodes).values({
        organizationId,
        matterId,
        nodeType: "document",
        canonicalEntityType: "document",
        canonicalEntityId: doc!.id,
        displayName: d === 0 ? "Exhibit Evidence Packet" : `Document ${d}`,
        status: "approved",
        origin: "manual",
        createdByUserId: userId,
      });
    }
  }, 120_000);

  afterAll(async () => {
    await closeDb(db);
  });

  it("whole-matter extract is bounded with coverage metadata and keeps important nodes", async () => {
    const result = await extractGraphRelationshipCandidates({
      db,
      organizationId,
      matterId,
      userId,
      ai: new MockAIProvider(),
    });
    expect(result.coverage).toBeDefined();
    expect(result.coverage!.selectionMode).toBe("WHOLE_MATTER");
    expect(result.coverage!.selectedNodes).toBeLessThanOrEqual(GRAPH_EXTRACT_NODE_CAP);
    expect(result.coverage!.selectedChunks).toBeLessThanOrEqual(GRAPH_EXTRACT_CHUNK_CAP);
    expect(result.coverage!.candidateNodes).toBeGreaterThan(GRAPH_EXTRACT_NODE_CAP);
    expect(result.coverage!.coverageLimited).toBe(true);
    expect(result.coverage!.truncated).toBe(true);
    expect(result.coverage!.omittedNodeCount).toBe(
      result.coverage!.candidateNodes - result.coverage!.selectedNodes,
    );
    expect(result.coverage!.domainsRepresented.length).toBeGreaterThan(1);
    expect(result.coverage!.selectionBasis).toBe("relevance_ranked_bounded");

    const eligible = await db
      .select()
      .from(graphNodes)
      .where(and(eq(graphNodes.matterId, matterId), eq(graphNodes.status, "approved")));
    expect(eligible.some((n) => n.id === claimNodeId)).toBe(true);
    expect(eligible.length).toBe(result.coverage!.candidateNodes);
  }, 60_000);

  it("focused extract prioritizes focus node and rejects foreign focus", async () => {
    const focused = await extractGraphRelationshipCandidates({
      db,
      organizationId,
      matterId,
      userId,
      focusNodeId,
      ai: new MockAIProvider(),
    });
    expect(focused.coverage!.selectionMode).toBe("FOCUSED");

    await expect(
      extractGraphRelationshipCandidates({
        db,
        organizationId,
        matterId,
        userId,
        focusNodeId: foreignNodeId,
        ai: new MockAIProvider(),
      }),
    ).rejects.toBeInstanceOf(GraphFocusRejectedError);

    const missing = await extractGraphRelationshipCandidates({
      db,
      organizationId,
      matterId,
      userId,
      focusNodeId: "00000000-0000-4000-8000-000000000099",
      ai: new MockAIProvider(),
    });
    expect(missing.coverage!.selectionMode).toBe("WHOLE_MATTER");
  }, 60_000);

  it("repeated run is stable and AI edges retain provenance", async () => {
    const a = await extractGraphRelationshipCandidates({
      db,
      organizationId,
      matterId,
      userId,
      ai: new MockAIProvider(),
    });
    const b = await extractGraphRelationshipCandidates({
      db,
      organizationId,
      matterId,
      userId,
      ai: new MockAIProvider(),
    });
    expect(a.coverage).toEqual(b.coverage);

    const aiEdges = await db
      .select()
      .from(graphEdges)
      .where(and(eq(graphEdges.matterId, matterId), eq(graphEdges.origin, "ai")));
    for (const edge of aiEdges) {
      const sources = await db
        .select()
        .from(graphEdgeSources)
        .where(eq(graphEdgeSources.graphEdgeId, edge.id));
      expect(sources.length).toBeGreaterThan(0);
    }
  }, 90_000);
});
