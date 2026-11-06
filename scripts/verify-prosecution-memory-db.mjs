import { and, eq, sql } from "drizzle-orm";
import {
  closeDb,
  createDb,
  createOrganizationWithDefaults,
  prosecutionCaseMemories,
  users,
} from "@nyayagrid/database";
import {
  createCriminalCase,
  createProsecutionCaseMemory,
  listProsecutionCaseMemories,
  reviewProsecutionCaseMemory,
  ProsecutionError,
} from "@nyayagrid/intelligence";

const url = process.env.DATABASE_URL ?? "postgresql://nyayagrid:nyayagrid@localhost:5433/nyayagrid";
if (!/localhost|127\.0\.0\.1/.test(url)) throw new Error("localhost only");
const db = createDb(url);
const suffix = Date.now().toString(36);
const ids = {};
const provenance = { extractionOrigin: "human", humanEntered: true };

try {
  const table = await db.execute(sql`
    select table_name from information_schema.tables
    where table_schema = 'public' and table_name = 'prosecution_case_memories'
  `);
  if (table.length !== 1) throw new Error("prosecution_case_memories missing");

  const [ownerA] = await db
    .insert(users)
    .values({
      authSubject: `pcm_a_${suffix}`,
      email: `pcm_a_${suffix}@example.nyayagrid.local`,
      name: "ownerA",
    })
    .returning();
  const [ownerB] = await db
    .insert(users)
    .values({
      authSubject: `pcm_b_${suffix}`,
      email: `pcm_b_${suffix}@example.nyayagrid.local`,
      name: "ownerB",
    })
    .returning();
  ids.ownerA = ownerA.id;
  ids.ownerB = ownerB.id;

  const orgA = await createOrganizationWithDefaults(db, {
    name: `PCM A ${suffix}`,
    slug: `pcm-a-${suffix}`,
    type: "firm",
    ownerUserId: ids.ownerA,
  });
  const orgB = await createOrganizationWithDefaults(db, {
    name: `PCM B ${suffix}`,
    slug: `pcm-b-${suffix}`,
    type: "firm",
    ownerUserId: ids.ownerB,
  });
  ids.orgA = orgA.organization.id;
  ids.orgB = orgB.organization.id;

  const caseA = await createCriminalCase(db, {
    userId: ids.ownerA,
    organizationId: ids.orgA,
    caseNumber: `PCM-${suffix}`,
    jurisdiction: "PA",
    court: "st-pa-trial",
  });
  ids.caseA = caseA.id;
  const caseB = await createCriminalCase(db, {
    userId: ids.ownerB,
    organizationId: ids.orgB,
    caseNumber: `PCM-B-${suffix}`,
    jurisdiction: "PA",
    court: "st-pa-trial",
  });
  ids.caseB = caseB.id;

  const proposed = await createProsecutionCaseMemory(db, {
    userId: ids.ownerA,
    organizationId: ids.orgA,
    caseId: ids.caseA,
    memoryType: "allegation",
    content: "Synthetic note: witness reported a blue vehicle near the scene.",
    origin: "ai",
    status: "approved",
    confidence: "high",
    provenance,
  });
  if (proposed.status !== "proposed") throw new Error(`expected proposed got ${proposed.status}`);
  if (proposed.isVerifiedFact) throw new Error("AI proposed must not be verified");

  const approved = await reviewProsecutionCaseMemory(db, {
    userId: ids.ownerA,
    organizationId: ids.orgA,
    caseId: ids.caseA,
    memoryId: proposed.id,
    action: "approve",
  });
  if (!approved.isVerifiedFact || approved.status !== "approved") {
    throw new Error("approve did not verify");
  }

  const listed = await listProsecutionCaseMemories(db, {
    userId: ids.ownerA,
    organizationId: ids.orgA,
    caseId: ids.caseA,
  });
  if (!listed.some((row) => row.id === proposed.id)) throw new Error("missing from list");

  let denied = false;
  try {
    await listProsecutionCaseMemories(db, {
      userId: ids.ownerB,
      organizationId: ids.orgB,
      caseId: ids.caseA,
    });
  } catch (err) {
    denied = err instanceof ProsecutionError;
  }
  if (!denied) throw new Error("cross-office list should deny");

  console.log(
    JSON.stringify({
      ok: true,
      memoryId: proposed.id,
      statusPath: "proposed->approved",
      caseB: ids.caseB,
    }),
  );
} finally {
  if (ids.caseA) {
    await db
      .delete(prosecutionCaseMemories)
      .where(eq(prosecutionCaseMemories.criminalCaseId, ids.caseA));
  }
  if (ids.orgA) {
    await db
      .delete(prosecutionCaseMemories)
      .where(and(eq(prosecutionCaseMemories.organizationId, ids.orgA)));
  }
  await closeDb(db);
}
