/**
 * Live DB civil graph materialization.
 *
 * Requires:
 *   SHARED_RUNTIME_LOCK for DEEPENING PASS 3 CIVIL GRAPH MATERIALIZATION
 *   RUN_DB_TESTS=1
 *   DATABASE_URL=postgresql://nyayagrid:nyayagrid@localhost:5433/nyayagrid
 *   migrations 0020 + 0021 applied locally
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  closeDb,
  createDb,
  createOrganizationWithDefaults,
  clients,
  matters,
  users,
  graphNodes,
  graphEdges,
  and,
  eq,
} from "@nyayagrid/database";
import {
  addCivilClaimElement,
  createCivilClaim,
  createCivilCounterclaim,
  createCivilDefense,
  createCivilEvidenceItem,
  createCivilPleading,
  linkCivilEvidence,
  materializeCivilGraph,
  persistCivilClaimsReview,
  runComplexCivilClaimsFixture,
  supersedeCivilClaim,
} from "@nyayagrid/intelligence";
import { matterEntities } from "@nyayagrid/database";

const runDbTests = process.env.RUN_DB_TESTS === "1";
const provenance = { extractionOrigin: "human" as const, humanEntered: true };

describe.runIf(runDbTests)("civil graph materialization integration", () => {
  const db = createDb(
    process.env.DATABASE_URL ?? "postgresql://nyayagrid:nyayagrid@localhost:5433/nyayagrid",
  );
  const suffix = Date.now().toString(36);
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    const [owner] = await db
      .insert(users)
      .values({
        authSubject: `civil_graph_owner_${suffix}`,
        email: `civil_graph_owner_${suffix}@example.nyayagrid.local`,
        name: "Civil Graph Owner",
      })
      .returning();
    ids.owner = owner!.id;
    const org = await createOrganizationWithDefaults(db, {
      name: `Civil Graph ${suffix}`,
      slug: `civil-graph-${suffix}`,
      type: "firm",
      ownerUserId: ids.owner!,
    });
    ids.org = org.organization.id;
    const [client] = await db
      .insert(clients)
      .values({
        organizationId: ids.org!,
        clientType: "organization",
        displayName: "River Graph Client",
        createdByUserId: ids.owner!,
      })
      .returning();
    const [matter] = await db
      .insert(matters)
      .values({
        organizationId: ids.org!,
        clientId: client!.id,
        matterNumber: `CG-${suffix}`,
        title: "Civil Graph Matter",
        status: "open",
        createdByUserId: ids.owner!,
      })
      .returning();
    ids.matter = matter!.id;

    const [plaintiff] = await db
      .insert(matterEntities)
      .values({
        organizationId: ids.org!,
        matterId: ids.matter!,
        entityType: "organization",
        displayName: "River",
        normalizedName: "river",
        status: "approved",
        origin: "manual",
        createdByUserId: ids.owner!,
      })
      .returning();
    const [defendant] = await db
      .insert(matterEntities)
      .values({
        organizationId: ids.org!,
        matterId: ids.matter!,
        entityType: "organization",
        displayName: "Acme",
        normalizedName: "acme",
        status: "approved",
        origin: "manual",
        createdByUserId: ids.owner!,
      })
      .returning();
    ids.plaintiff = plaintiff!.id;
    ids.defendant = defendant!.id;

    const pleading = await createCivilPleading(db, {
      userId: ids.owner!,
      organizationId: ids.org!,
      matterId: ids.matter!,
      label: "Complaint",
      provenance,
    });
    ids.pleading = pleading.id;
    const claim = await createCivilClaim(db, {
      userId: ids.owner!,
      organizationId: ids.org!,
      matterId: ids.matter!,
      kind: "CLAIM",
      label: "Breach",
      pleadingId: pleading.id,
      parties: [
        { partyEntityId: ids.plaintiff!, role: "PLAINTIFF" },
        { partyEntityId: ids.defendant!, role: "DEFENDANT" },
      ],
      provenance,
    });
    ids.claim = claim.id;
    const element = await addCivilClaimElement(db, {
      userId: ids.owner!,
      organizationId: ids.org!,
      matterId: ids.matter!,
      claimId: claim.id,
      label: "Breach element",
      status: "PARTIALLY_SUPPORTED",
      provenance,
    });
    const evidence = await createCivilEvidenceItem(db, {
      userId: ids.owner!,
      organizationId: ids.org!,
      matterId: ids.matter!,
      label: "Notice letter",
      provenance,
    });
    await linkCivilEvidence(db, {
      userId: ids.owner!,
      organizationId: ids.org!,
      matterId: ids.matter!,
      elementId: element.id,
      evidenceId: evidence.id,
      role: "SUPPORTS",
      provenance,
    });
    await createCivilCounterclaim(db, {
      userId: ids.owner!,
      organizationId: ids.org!,
      matterId: ids.matter!,
      label: "Unpaid invoice",
      parties: [
        { partyEntityId: ids.defendant!, role: "COUNTERCLAIMANT" },
        { partyEntityId: ids.plaintiff!, role: "COUNTERCLAIM_DEFENDANT" },
      ],
      provenance,
    });
    await createCivilDefense(db, {
      userId: ids.owner!,
      organizationId: ids.org!,
      matterId: ids.matter!,
      kind: "AFFIRMATIVE",
      label: "Waiver",
      againstClaimIds: [claim.id],
      assertingPartyIds: [ids.defendant!],
      provenance,
    });
    await supersedeCivilClaim(db, {
      userId: ids.owner!,
      organizationId: ids.org!,
      matterId: ids.matter!,
      priorClaimId: claim.id,
      label: "Breach (amended)",
      pleadingId: pleading.id,
      provenance,
    });
  });

  afterAll(async () => {
    await closeDb(db);
  });

  it("persists claim/defense nodes and civil edges without duplicating parties", async () => {
    const result = await materializeCivilGraph({
      db,
      organizationId: ids.org!,
      matterId: ids.matter!,
      userId: ids.owner!,
    });
    expect(result.nodesUpserted).toBeGreaterThan(0);

    const nodes = await db
      .select()
      .from(graphNodes)
      .where(and(eq(graphNodes.organizationId, ids.org!), eq(graphNodes.matterId, ids.matter!)));
    expect(nodes.some((node) => node.nodeType === "claim")).toBe(true);
    expect(nodes.some((node) => node.nodeType === "defense")).toBe(true);
    expect(nodes.filter((node) => node.canonicalEntityType === "matter_entity").length).toBe(2);

    const edges = await db
      .select()
      .from(graphEdges)
      .where(and(eq(graphEdges.organizationId, ids.org!), eq(graphEdges.matterId, ids.matter!)));
    expect(edges.some((edge) => edge.relationshipType === "involves_party")).toBe(true);
    expect(edges.some((edge) => edge.relationshipType === "responds_to")).toBe(true);
    expect(edges.some((edge) => edge.relationshipType === "has_element")).toBe(true);

    const second = await materializeCivilGraph({
      db,
      organizationId: ids.org!,
      matterId: ids.matter!,
      userId: ids.owner!,
    });
    expect(second.edgesMerged).toBeGreaterThan(0);

    const claimNodes = nodes.filter((node) => node.nodeType === "claim");
    expect(claimNodes.some((node) => (node.metadata as { isCurrent?: boolean })?.isCurrent === false)).toBe(
      true,
    );
  });

  it("materializes D3 fixture persist without liability conclusions", async () => {
    const [matterD3] = await db
      .insert(matters)
      .values({
        organizationId: ids.org!,
        clientId: (
          await db.select().from(clients).where(eq(clients.organizationId, ids.org!)).limit(1)
        )[0]!.id,
        matterNumber: `D3G-${suffix}`,
        title: "D3 Civil Graph Persist",
        status: "open",
        createdByUserId: ids.owner!,
      })
      .returning();
    const fixture = runComplexCivilClaimsFixture();
    await persistCivilClaimsReview(db, {
      userId: ids.owner!,
      review: { ...fixture.review, organizationId: ids.org!, matterId: matterD3!.id },
    });
    const result = await materializeCivilGraph({
      db,
      organizationId: ids.org!,
      matterId: matterD3!.id,
      userId: ids.owner!,
    });
    expect(result.plan.nodes.some((node) => node.nodeType === "claim")).toBe(true);
    expect(JSON.stringify(result.plan)).not.toMatch(/\bLIABLE\b|\bWIN\b|\bLOSE\b/);
  });
});
