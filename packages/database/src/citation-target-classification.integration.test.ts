import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  closeDb,
  createDb,
  legalAuthorities,
  legalAuthorityCitations,
} from "./index";

const runDbTests = process.env.RUN_DB_TESTS === "1";

describe.runIf(runDbTests)("citation_target_classification migration integration", () => {
  const db = createDb(
    process.env.DATABASE_URL ?? "postgresql://nyayagrid:nyayagrid@localhost:5433/nyayagrid",
  );
  const suffix = Date.now().toString(36);
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    const cols = await db.execute(sql`
      SELECT column_name, column_default, is_nullable, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'legal_authority_citations'
        AND column_name = 'citation_target_classification'
    `);
    const colRows = cols as unknown as Array<{
      column_name: string;
      column_default: string | null;
      is_nullable: string;
      data_type: string;
    }>;
    expect(colRows.length).toBeGreaterThan(0);
    const col = colRows[0]!;
    expect(col.data_type).toBe("text");
    expect(col.is_nullable).toBe("NO");
    expect(String(col.column_default)).toMatch(/UNKNOWN/);

    const [fromAuth] = await db
      .insert(legalAuthorities)
      .values({
        authorityType: "case",
        title: `CTC From ${suffix}`,
        citation: `1 F.3d ${suffix.slice(-3)}`,
        normalizedCitation: `1 F.3d ${suffix.slice(-3)}`,
        ingestionStatus: "ready",
      })
      .returning();
    const [toAuth] = await db
      .insert(legalAuthorities)
      .values({
        authorityType: "case",
        title: `CTC To ${suffix}`,
        citation: `2 F.3d ${suffix.slice(-3)}`,
        normalizedCitation: `2 F.3d ${suffix.slice(-3)}`,
        ingestionStatus: "ready",
      })
      .returning();
    ids.fromAuth = fromAuth!.id;
    ids.toAuth = toAuth!.id;
  });

  afterAll(async () => {
    if (ids.fromAuth) {
      await db.delete(legalAuthorityCitations).where(eq(legalAuthorityCitations.fromAuthorityId, ids.fromAuth));
      await db.delete(legalAuthorities).where(eq(legalAuthorities.id, ids.fromAuth));
    }
    if (ids.toAuth) {
      await db.delete(legalAuthorities).where(eq(legalAuthorities.id, ids.toAuth));
    }
    await closeDb(db);
  });

  it("defaults new rows to UNKNOWN without mutating authority mapping or raw text", async () => {
    const raw = `410 U.S. 113 CTC-${suffix}`;
    const [unresolved] = await db
      .insert(legalAuthorityCitations)
      .values({
        fromAuthorityId: ids.fromAuth!,
        toAuthorityId: null,
        rawCitation: raw,
        normalizedCitation: "410 U.S. 113",
      })
      .returning();
    expect(unresolved!.citationTargetClassification).toBe("UNKNOWN");
    expect(unresolved!.rawCitation).toBe(raw);
    expect(unresolved!.toAuthorityId).toBeNull();
    ids.edgeUnresolved = unresolved!.id;

    const [resolved] = await db
      .insert(legalAuthorityCitations)
      .values({
        fromAuthorityId: ids.fromAuth!,
        toAuthorityId: ids.toAuth!,
        rawCitation: `2 F.3d CTC-${suffix}`,
        normalizedCitation: `2 F.3d ${suffix.slice(-3)}`,
        citationTargetClassification: "CASE_CITATION",
      })
      .returning();
    expect(resolved!.citationTargetClassification).toBe("CASE_CITATION");
    expect(resolved!.toAuthorityId).toBe(ids.toAuth);
    ids.edgeResolved = resolved!.id;
  });

  it("preserves raw citation when classification is updated; does not clear to_authority_id", async () => {
    await db
      .update(legalAuthorityCitations)
      .set({ citationTargetClassification: "STATUTE" })
      .where(eq(legalAuthorityCitations.id, ids.edgeUnresolved!));

    const [row] = await db
      .select()
      .from(legalAuthorityCitations)
      .where(eq(legalAuthorityCitations.id, ids.edgeUnresolved!));
    expect(row!.citationTargetClassification).toBe("STATUTE");
    expect(row!.rawCitation).toContain("410 U.S. 113");
    expect(row!.toAuthorityId).toBeNull();

    const [stillResolved] = await db
      .select()
      .from(legalAuthorityCitations)
      .where(eq(legalAuthorityCitations.id, ids.edgeResolved!));
    expect(stillResolved!.toAuthorityId).toBe(ids.toAuth);
    expect(stillResolved!.citationTargetClassification).toBe("CASE_CITATION");
  });

  it("supports classification-aware unresolved queries without dropping RAW null-authority semantics", async () => {
    const rawUnresolved = await db
      .select({ id: legalAuthorityCitations.id })
      .from(legalAuthorityCitations)
      .where(
        sql`${legalAuthorityCitations.fromAuthorityId} = ${ids.fromAuth} AND ${legalAuthorityCitations.toAuthorityId} IS NULL`,
      );
    expect(rawUnresolved.some((r) => r.id === ids.edgeUnresolved)).toBe(true);

    const trueCase = await db
      .select({ id: legalAuthorityCitations.id })
      .from(legalAuthorityCitations)
      .where(
        sql`${legalAuthorityCitations.fromAuthorityId} = ${ids.fromAuth}
          AND ${legalAuthorityCitations.toAuthorityId} IS NULL
          AND ${legalAuthorityCitations.citationTargetClassification} = 'CASE_CITATION'`,
      );
    expect(trueCase.some((r) => r.id === ids.edgeUnresolved)).toBe(false);

    const artifacts = await db
      .select({ id: legalAuthorityCitations.id })
      .from(legalAuthorityCitations)
      .where(
        sql`${legalAuthorityCitations.fromAuthorityId} = ${ids.fromAuth}
          AND ${legalAuthorityCitations.toAuthorityId} IS NULL
          AND ${legalAuthorityCitations.citationTargetClassification} = 'STATUTE'`,
      );
    expect(artifacts.some((r) => r.id === ids.edgeUnresolved)).toBe(true);

    // Resolved edge never appears in unresolved buckets.
    const unresolvedIds = new Set(rawUnresolved.map((r) => r.id));
    expect(unresolvedIds.has(ids.edgeResolved!)).toBe(false);
  });

  it("rejects invalid classification values", async () => {
    await expect(
      db.execute(sql`
        UPDATE legal_authority_citations
        SET citation_target_classification = 'NOT_A_REAL_CLASS'
        WHERE id = ${ids.edgeUnresolved}::uuid
      `),
    ).rejects.toThrow();
  });
});
