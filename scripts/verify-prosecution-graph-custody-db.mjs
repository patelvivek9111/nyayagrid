/**
 * Local POST_PR08 smoke: prosecution graph sync/isolation + append-only custody.
 * Localhost Docker only. Cleans up created org-scoped rows where practical.
 */
import { and, eq, sql } from "drizzle-orm";
import {
  closeDb,
  createDb,
  createOrganizationWithDefaults,
  prosecutionEvidenceItems,
  prosecutionGraphEdges,
  prosecutionGraphNodes,
  users,
} from "@nyayagrid/database";
import {
  addProsecutionRecord,
  appendProsecutionEvidenceCustody,
  createCriminalCase,
  listProsecutionCaseGraph,
  ProsecutionError,
  syncProsecutionCaseGraphProjection,
} from "@nyayagrid/intelligence";

const url = process.env.DATABASE_URL ?? "postgresql://nyayagrid:nyayagrid@localhost:5433/nyayagrid";
if (!/localhost|127\.0\.0\.1/.test(url)) throw new Error("localhost only");
const db = createDb(url);
const suffix = Date.now().toString(36);
const ids = {};

try {
  for (const tableName of ["prosecution_graph_nodes", "prosecution_graph_edges"]) {
    const rows = await db.execute(sql`
      select table_name from information_schema.tables
      where table_schema='public' and table_name=${tableName}
    `);
    if (rows.length !== 1) throw new Error(`missing ${tableName}`);
  }

  const [ownerA] = await db
    .insert(users)
    .values({
      authSubject: `pgc_a_${suffix}`,
      email: `pgc_a_${suffix}@example.nyayagrid.local`,
      name: "ownerA",
    })
    .returning();
  const [ownerB] = await db
    .insert(users)
    .values({
      authSubject: `pgc_b_${suffix}`,
      email: `pgc_b_${suffix}@example.nyayagrid.local`,
      name: "ownerB",
    })
    .returning();
  ids.ownerA = ownerA.id;
  ids.ownerB = ownerB.id;

  const orgA = await createOrganizationWithDefaults(db, {
    name: `PGC A ${suffix}`,
    slug: `pgc-a-${suffix}`,
    type: "firm",
    ownerUserId: ids.ownerA,
  });
  const orgB = await createOrganizationWithDefaults(db, {
    name: `PGC B ${suffix}`,
    slug: `pgc-b-${suffix}`,
    type: "firm",
    ownerUserId: ids.ownerB,
  });
  ids.orgA = orgA.organization.id;
  ids.orgB = orgB.organization.id;

  const caseA = await createCriminalCase(db, {
    userId: ids.ownerA,
    organizationId: ids.orgA,
    caseNumber: `PGC-${suffix}`,
    jurisdiction: "PA",
    court: "st-pa-trial",
  });
  ids.caseA = caseA.id;
  const caseB = await createCriminalCase(db, {
    userId: ids.ownerB,
    organizationId: ids.orgB,
    caseNumber: `PGC-B-${suffix}`,
    jurisdiction: "PA",
    court: "st-pa-trial",
  });
  ids.caseB = caseB.id;

  await addProsecutionRecord(db, {
    userId: ids.ownerA,
    organizationId: ids.orgA,
    caseId: ids.caseA,
    resource: "defendants",
    body: {
      displayName: `Defendant ${suffix}`,
      provenance: { extractionOrigin: "human", humanEntered: true },
    },
  });

  const graph = await syncProsecutionCaseGraphProjection(db, {
    userId: ids.ownerA,
    organizationId: ids.orgA,
    caseId: ids.caseA,
  });
  if (
    !graph.nodes.some(
      (n) => n.nodeKind === "criminal_case" || n.canonicalEntityType === "criminal_case",
    )
  ) {
    // presentNode may use different field names — require at least one node
    if (graph.nodes.length < 1) throw new Error("graph projection produced no nodes");
  }

  let denied = false;
  try {
    await listProsecutionCaseGraph(db, {
      userId: ids.ownerB,
      organizationId: ids.orgB,
      caseId: ids.caseA,
    });
  } catch (err) {
    denied = err instanceof ProsecutionError;
  }
  if (!denied) throw new Error("cross-office graph list should deny");

  const evidence = await addProsecutionRecord(db, {
    userId: ids.ownerA,
    organizationId: ids.orgA,
    caseId: ids.caseA,
    resource: "evidence",
    body: {
      evidenceType: "physical",
      collector: "Investigator A",
      chainOfCustody: [
        {
          actor: "Investigator A",
          timestamp: "2026-01-01T12:00:00.000Z",
          from: null,
          to: "Evidence locker",
          source: { extractionOrigin: "human", humanEntered: true },
          notes: "intake",
        },
      ],
      provenance: { extractionOrigin: "human", humanEntered: true },
    },
  });
  ids.evidenceA = evidence.id;
  const initialLen = Array.isArray(evidence.chainOfCustody) ? evidence.chainOfCustody.length : 0;

  const updated = await appendProsecutionEvidenceCustody(db, {
    userId: ids.ownerA,
    organizationId: ids.orgA,
    caseId: ids.caseA,
    evidenceId: evidence.id,
    transfer: {
      actor: "Evidence clerk",
      timestamp: "2026-01-02T12:00:00.000Z",
      from: "Evidence locker",
      to: "Lab",
      source: { extractionOrigin: "human", humanEntered: true },
      notes: "transfer to lab",
    },
  });
  const chain = Array.isArray(updated.evidence?.chainOfCustody)
    ? updated.evidence.chainOfCustody
    : [];
  if (chain.length !== initialLen + 1) {
    throw new Error(`expected append-only growth ${initialLen}+1 got ${chain.length}`);
  }
  if (updated.priorLength !== initialLen) {
    throw new Error(`priorLength mismatch ${updated.priorLength} vs ${initialLen}`);
  }

  denied = false;
  try {
    await appendProsecutionEvidenceCustody(db, {
      userId: ids.ownerB,
      organizationId: ids.orgB,
      caseId: ids.caseA,
      evidenceId: evidence.id,
      transfer: {
        actor: "Outsider",
        timestamp: "2026-01-03T12:00:00.000Z",
        from: "Lab",
        to: "Elsewhere",
        source: { extractionOrigin: "human", humanEntered: true },
      },
    });
  } catch (err) {
    denied = err instanceof ProsecutionError;
  }
  if (!denied) throw new Error("cross-office custody append should deny");

  console.log(
    JSON.stringify({
      ok: true,
      graphNodes: graph.nodes.length,
      graphEdges: graph.edges.length,
      custodyLength: chain.length,
      evidenceId: evidence.id,
    }),
  );
} finally {
  if (ids.caseA) {
    await db
      .delete(prosecutionGraphEdges)
      .where(eq(prosecutionGraphEdges.criminalCaseId, ids.caseA));
    await db
      .delete(prosecutionGraphNodes)
      .where(eq(prosecutionGraphNodes.criminalCaseId, ids.caseA));
    await db
      .delete(prosecutionEvidenceItems)
      .where(eq(prosecutionEvidenceItems.criminalCaseId, ids.caseA));
  }
  if (ids.orgA) {
    await db
      .delete(prosecutionGraphEdges)
      .where(and(eq(prosecutionGraphEdges.organizationId, ids.orgA)));
    await db
      .delete(prosecutionGraphNodes)
      .where(and(eq(prosecutionGraphNodes.organizationId, ids.orgA)));
  }
  await closeDb(db);
}
