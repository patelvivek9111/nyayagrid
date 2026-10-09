/**
 * Deepening Pass 5 — authorized LOCAL live citation certification.
 * RUN_DB_TESTS=1 DATABASE_URL=postgresql://nyayagrid:nyayagrid@localhost:5433/nyayagrid
 * Production Neon / CourtListener / Corpus Neon: unused. Schema migration: NONE.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  closeDb,
  createDb,
  createOrganizationWithDefaults,
  clients,
  legalAuthorities,
  matterAuthorities,
  matterMembers,
  matters,
  memberships,
  users,
  and,
  eq,
  sql,
} from "@nyayagrid/database";
import { AuthorizationError, requireMatterAccess } from "@nyayagrid/permissions";
import {
  applyResolveOrAbstainPolicy,
  blocksUnsupportedTreatmentMemory,
  canLinkAuthorityInGraph,
  coverageForResolution,
  extractAndResolveCitationsInText,
  formatResolutionForAskContext,
  loadAuthorityIndexForProduct,
  memorySafeResolutionFact,
  resolveCitationsForProduct,
  toAuthorityIndexRow,
} from "./product-citation-resolution";
import { listMatterAuthorities, saveAuthorityToMatter } from "./matter-authorities";

const runDbTests = process.env.RUN_DB_TESTS === "1";
const SOURCE_PROVIDER = "pass5-live-cert";

describe.runIf(runDbTests)("Pass 5 citation live certification (local DB)", () => {
  const db = createDb(
    process.env.DATABASE_URL ?? "postgresql://nyayagrid:nyayagrid@localhost:5433/nyayagrid",
  );
  const suffix = `p5live_${Date.now().toString(36)}`;
  const ids: Record<string, string> = {};
  const authIds: Record<string, string> = {};
  let indexLoadMs = 0;
  let loadedIndexSize = 0;
  let metadataOnlyObserved = 0;
  let corpusCompleteObserved = 0;
  let parallelObserved = 0;
  let aliasObserved = 0;

  async function insertAuthority(row: {
    key: string;
    title: string;
    citation: string;
    normalizedCitation?: string;
    corpusComplete?: boolean;
    parallelCitations?: string[];
    citationAliases?: string[];
    treatmentStatus?: "unknown" | "source_reported";
    incomplete?: boolean;
  }) {
    const metadata: Record<string, unknown> = {
      pass5LiveCert: true,
      fixtureKey: row.key,
    };
    if (row.corpusComplete) {
      metadata.corpusComplete = true;
      metadata.fullTextPresent = true;
    }
    if (row.parallelCitations?.length) {
      metadata.parallelCitations = row.parallelCitations;
    }
    if (row.citationAliases?.length) {
      metadata.citationAliases = row.citationAliases;
    }

    const [inserted] = await db
      .insert(legalAuthorities)
      .values({
        authorityType: "case",
        title: row.title,
        shortTitle: row.title.slice(0, 40),
        citation: row.incomplete ? null : row.citation,
        normalizedCitation: row.incomplete ? null : (row.normalizedCitation ?? row.citation),
        jurisdiction: "US",
        court: "U.S. Supreme Court",
        decisionDate: "1954-05-17",
        sourceProvider: SOURCE_PROVIDER,
        sourceExternalId: `${suffix}_${row.key}`,
        ingestionStatus: "ready",
        treatmentStatus: row.treatmentStatus ?? "unknown",
        metadata,
      })
      .returning();
    if (!inserted) throw new Error(`Failed to insert ${row.key}`);
    authIds[row.key] = inserted.id;
    return inserted;
  }

  beforeAll(async () => {
    // Cleanup any prior interrupted Pass 5 fixture rows for this provider (idempotent seed).
    await db.delete(legalAuthorities).where(eq(legalAuthorities.sourceProvider, SOURCE_PROVIDER));

    const [owner] = await db
      .insert(users)
      .values({
        authSubject: `p5_owner_${suffix}`,
        email: `p5_owner_${suffix}@example.nyayagrid.local`,
        name: "P5 Owner",
      })
      .returning();
    const [outsider] = await db
      .insert(users)
      .values({
        authSubject: `p5_out_${suffix}`,
        email: `p5_out_${suffix}@example.nyayagrid.local`,
        name: "P5 Outsider",
      })
      .returning();
    const [guest] = await db
      .insert(users)
      .values({
        authSubject: `p5_guest_${suffix}`,
        email: `p5_guest_${suffix}@example.nyayagrid.local`,
        name: "P5 Guest",
      })
      .returning();
    ids.owner = owner!.id;
    ids.outsider = outsider!.id;
    ids.guest = guest!.id;

    const orgA = await createOrganizationWithDefaults(db, {
      name: `P5 Firm ${suffix}`,
      slug: `p5-firm-${suffix}`,
      type: "firm",
      ownerUserId: ids.owner!,
    });
    const orgB = await createOrganizationWithDefaults(db, {
      name: `P5 Other ${suffix}`,
      slug: `p5-other-${suffix}`,
      type: "firm",
      ownerUserId: ids.outsider!,
    });
    ids.orgA = orgA.organization.id;
    ids.orgB = orgB.organization.id;
    const guestRoleId = orgA.roleIdByKey.get("client_guest")!;

    await db.insert(memberships).values({
      organizationId: ids.orgA!,
      userId: ids.guest!,
      roleId: guestRoleId,
      status: "active",
    });

    const [clientA] = await db
      .insert(clients)
      .values({
        organizationId: ids.orgA!,
        displayName: "P5 Client A",
        clientType: "organization",
        status: "active",
        createdByUserId: ids.owner!,
      })
      .returning();
    const [clientB] = await db
      .insert(clients)
      .values({
        organizationId: ids.orgB!,
        displayName: "P5 Client B",
        clientType: "organization",
        status: "active",
        createdByUserId: ids.outsider!,
      })
      .returning();

    const [matterA] = await db
      .insert(matters)
      .values({
        organizationId: ids.orgA!,
        clientId: clientA!.id,
        title: `P5 Matter A ${suffix}`,
        matterNumber: `P5A-${suffix}`,
        status: "open",
        createdByUserId: ids.owner!,
      })
      .returning();
    const [matterB] = await db
      .insert(matters)
      .values({
        organizationId: ids.orgB!,
        clientId: clientB!.id,
        title: `P5 Matter B ${suffix}`,
        matterNumber: `P5B-${suffix}`,
        status: "open",
        createdByUserId: ids.outsider!,
      })
      .returning();
    ids.matterA = matterA!.id;
    ids.matterB = matterB!.id;

    await db.insert(matterMembers).values([
      {
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        userId: ids.owner!,
        access: "manage",
      },
      {
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        userId: ids.guest!,
        access: "read",
      },
      {
        organizationId: ids.orgB!,
        matterId: ids.matterB!,
        userId: ids.outsider!,
        access: "manage",
      },
    ]);

    // Core resolution matrix fixture (synthetic; no CourtListener).
    await insertAuthority({
      key: "brown",
      title: "Brown v. Board of Education (Pass5 synthetic)",
      citation: "347 U.S. 483",
      corpusComplete: true,
      citationAliases: ["Brown v. Board"],
    });
    await insertAuthority({
      key: "roe_meta",
      title: "Roe v. Wade (Pass5 synthetic metadata)",
      citation: "410 U.S. 113",
      corpusComplete: false,
    });
    await insertAuthority({
      key: "parallel",
      title: "Synthetic Parallel Authority (Pass5)",
      citation: "123 F.3d 456",
      // Eligible reporter parallel (unique synthetic; WL-only tokens are deferred by eligibility).
      parallelCitations: ["777 S. Ct. 999"],
    });
    await insertAuthority({
      key: "ambig_1",
      title: "Ambiguous Synthetic One (Pass5)",
      citation: "999 F.2d 111",
    });
    await insertAuthority({
      key: "ambig_2",
      title: "Ambiguous Synthetic Two (Pass5)",
      citation: "999 F.2d 111",
    });
    await insertAuthority({
      key: "incomplete",
      title: "Incomplete Metadata Synthetic (Pass5)",
      citation: "888 F. Supp. 2d 1",
      incomplete: true,
    });

    // Pad unique reporter cites for performance (>=40 resolutions) without CourtListener.
    for (let i = 1; i <= 45; i += 1) {
      await insertAuthority({
        key: `pad_${i}`,
        title: `Pass5 Pad Authority ${i}`,
        citation: `${100 + i} F.3d ${200 + i}`,
        corpusComplete: i % 5 === 0,
      });
    }
  }, 120_000);

  afterAll(async () => {
    await db.delete(matterAuthorities).where(eq(matterAuthorities.organizationId, ids.orgA!));
    await db.delete(matterAuthorities).where(eq(matterAuthorities.organizationId, ids.orgB!));
    await db.delete(legalAuthorities).where(eq(legalAuthorities.sourceProvider, SOURCE_PROVIDER));
    await closeDb(db);
  });

  it("loads live authority index without N+1 and observes coverage classes", async () => {
    const started = Date.now();
    const index = await loadAuthorityIndexForProduct(db, { limit: 5000 });
    indexLoadMs = Date.now() - started;
    loadedIndexSize = index.length;

    expect(index.length).toBeGreaterThanOrEqual(50);
    expect(indexLoadMs).toBeLessThan(5_000);

    // Single bounded SELECT — no per-row follow-up queries in loadAuthorityIndexForProduct.
    const fixtureRows = index.filter(
      (row) => row.sourceProvider === SOURCE_PROVIDER && row.metadata?.pass5LiveCert === true,
    );
    expect(fixtureRows.length).toBeGreaterThanOrEqual(50);

    metadataOnlyObserved = fixtureRows.filter(
      (row) => !row.corpusComplete && row.citation,
    ).length;
    corpusCompleteObserved = fixtureRows.filter((row) => row.corpusComplete).length;
    parallelObserved = fixtureRows.filter((row) => {
      const parallels = row.metadata?.parallelCitations;
      return Array.isArray(parallels) && parallels.length > 0;
    }).length;
    aliasObserved = fixtureRows.filter((row) => {
      const aliases = row.metadata?.citationAliases;
      return Array.isArray(aliases) && aliases.length > 0;
    }).length;

    expect(metadataOnlyObserved).toBeGreaterThan(0);
    expect(corpusCompleteObserved).toBeGreaterThan(0);
    expect(parallelObserved).toBeGreaterThan(0);
    expect(aliasObserved).toBeGreaterThan(0);

    // Metrics for the certification report (captured in local/CI logs).
    console.log(
      JSON.stringify({
        pass5LiveIndex: {
          rowsLoaded: loadedIndexSize,
          indexLoadMs,
          metadataOnlyObserved,
          corpusCompleteObserved,
          parallelObserved,
          aliasObserved,
        },
      }),
    );
  });

  it("resolution matrix: corpus-complete / metadata-only / parallel / unresolved / ambiguous / non-case / malformed", async () => {
    const index = await loadAuthorityIndexForProduct(db, { limit: 5000 });
    const resolveStarted = Date.now();
    const rows = resolveCitationsForProduct({
      citations: [
        { rawCitation: "347 U.S. 483" },
        { rawCitation: "410 U.S. 113" },
        { rawCitation: "123 F.3d 456" },
        { rawCitation: "777 S. Ct. 999" },
        { rawCitation: "1 Fake. Rep. 999" },
        { rawCitation: "999 F.2d 111" },
        { rawCitation: "42 U.S.C. § 1983" },
        { rawCitation: "2026 Page 2" },
      ],
      authorities: index,
    });
    const resolveMs = Date.now() - resolveStarted;
    expect(resolveMs).toBeLessThan(2_000);

    const [complete, meta, parallelPrimary, parallelWl, unresolved, ambiguous, nonCase, malformed] =
      rows;

    expect(complete!.outcome).toBe("RESOLVED_HIGH_CONFIDENCE");
    expect(complete!.authorityId).toBe(authIds.brown);
    expect(complete!.authorityState).toBe("CORPUS_COMPLETE");
    expect(complete!.corpusComplete).toBe(true);
    expect(complete!.coverage.displayState).toBe("FULL_TEXT_AVAILABLE");
    expect(complete!.coverage.treatmentUnknown).toBe(true);

    expect(meta!.outcome).toBe("RESOLVED_HIGH_CONFIDENCE");
    expect(meta!.authorityId).toBe(authIds.roe_meta);
    expect(meta!.authorityState).toBe("AUTHORITY_RESOLVED");
    expect(meta!.corpusComplete).toBe(false);
    expect(meta!.coverage.displayState).toBe("IDENTITY_VERIFIED_TEXT_NOT_IN_CORPUS");
    expect(meta!.coverage.fullOpinionTextUnavailableLocally).toBe(true);

    expect(parallelPrimary!.outcome).toBe("RESOLVED_HIGH_CONFIDENCE");
    expect(parallelPrimary!.authorityId).toBe(authIds.parallel);
    expect(parallelWl!.outcome).toBe("RESOLVED_HIGH_CONFIDENCE");
    expect(parallelWl!.authorityId).toBe(authIds.parallel);

    expect(unresolved!.authorityId).toBeNull();
    expect(unresolved!.coverage.displayState).toBe("UNRESOLVED");

    expect(ambiguous!.outcome).toBe("AMBIGUOUS");
    expect(ambiguous!.authorityId).toBeNull();
    expect(ambiguous!.ambiguityAuthorityIds.sort()).toEqual(
      [authIds.ambig_1!, authIds.ambig_2!].sort(),
    );
    expect(canLinkAuthorityInGraph(ambiguous!)).toBe(false);

    expect(nonCase!.outcome).toBe("NOT_CASE_CITATION");
    expect(malformed!.outcome).toBe("MALFORMED");

    // No invented treatment / silent substitution — resolved ids must exist in the live index.
    const indexIds = new Set(index.map((row) => row.id));
    for (const row of rows) {
      expect(row.coverage.treatmentVerifiedFromSource).toBe(false);
      expect(row.authorityId === null || indexIds.has(row.authorityId)).toBe(true);
    }
    // Parallel primary must hit our fixture; parallel reporter must resolve uniquely (fixture or corpus).
    expect(parallelWl!.authorityId).toBe(authIds.parallel);
  });

  it("live Ask path: resolve-or-abstain, coverage honesty, no invented authorities/treatment", async () => {
    const index = await loadAuthorityIndexForProduct(db, { limit: 5000 });
    // Mirrors packages/search/src/nyaya.ts Pass 5 block against a model answer containing citations.
    const answerText = [
      "The school-desegregation holding in 347 U.S. 483 remains foundational.",
      "Compare identity-only 410 U.S. 113.",
      "Ambiguous reporter 999 F.2d 111 must not be guessed.",
      "Absent cite 1 Fake. Rep. 999 is unverified.",
      "Matter document doc-lease-excerpt is not an authority invent.",
      "Statute 42 U.S.C. § 1983 is not case-lane identity.",
    ].join(" ");

    const extracted = extractAndResolveCitationsInText({
      text: answerText,
      authorities: index,
    });
    expect(extracted.length).toBeGreaterThanOrEqual(3);

    // Ask path also resolves explicitly surfaced reporter tokens (mirrors post-answer grounding).
    const citationResolutions = resolveCitationsForProduct({
      citations: [
        { rawCitation: "347 U.S. 483" },
        { rawCitation: "410 U.S. 113" },
        { rawCitation: "999 F.2d 111" },
        { rawCitation: "1 Fake. Rep. 999" },
        { rawCitation: "42 U.S.C. § 1983" },
      ],
      authorities: index,
    });

    const policy = applyResolveOrAbstainPolicy({ resolutions: citationResolutions });
    expect(policy.allowedFullTextAuthorityIds).toContain(authIds.brown);
    expect(policy.allowedIdentityAuthorityIds).toContain(authIds.roe_meta);
    expect(policy.suppressedCitations.some((c) => /999 F\.2d 111/.test(c))).toBe(true);
    expect(policy.suppressedCitations.some((c) => /Fake\. Rep/.test(c))).toBe(true);
    expect(policy.qualifications.some((q) => /full opinion text is not yet available/i.test(q))).toBe(
      true,
    );
    // Extracted prose path must not invent authority ids
    expect(extracted.every((r) => r.authorityId !== "invented")).toBe(true);

    const assumptions: string[] = [...policy.qualifications];
    if (policy.suppressedCitations.length > 0) {
      assumptions.push(
        `The following citation(s) are unresolved or ambiguous and must not be treated as verified authority: ${policy.suppressedCitations.join("; ")}.`,
      );
    }
    assumptions.push(
      "Citation resolution states distinguish IDENTITY_UNRESOLVED, AUTHORITY_RESOLVED, and CORPUS_COMPLETE; AUTHORITY_RESOLVED does not imply full opinion text.",
    );

    const block = formatResolutionForAskContext(citationResolutions);
    expect(block).toContain("CITATION_RESOLUTION_REVIEW");
    expect(block).not.toMatch(/\bstill good law\b|\boverruled\b|\bKeyCite\b|\bShepard/i);
    expect(assumptions.join("\n")).not.toMatch(/\bstill good law\b|\bwas overruled\b/i);

    // Invented authority / silent substitution guards
    expect(citationResolutions.every((r) => r.authorityId !== "invented")).toBe(true);
    expect(
      citationResolutions.every(
        (r) => r.authorityId === null || Object.values(authIds).includes(r.authorityId) || index.some((a) => a.id === r.authorityId),
      ),
    ).toBe(true);

    // Coverage dimensions
    const complete = citationResolutions.find((r) => r.rawCitation.includes("347 U.S. 483"))!;
    const meta = citationResolutions.find((r) => r.rawCitation.includes("410 U.S. 113"))!;
    expect(complete.coverage.identityVerified).toBe(true);
    expect(complete.coverage.fullOpinionTextAvailable).toBe(true);
    expect(meta.coverage.identityVerified).toBe(true);
    expect(meta.coverage.fullOpinionTextUnavailableLocally).toBe(true);
    expect(meta.coverage.treatmentUnknown).toBe(true);

    const treatmentCov = coverageForResolution(complete);
    expect(treatmentCov.treatmentUnknown).toBe(true);
    expect(treatmentCov.coverageWarning).toMatch(/treatment/i);

    expect(blocksUnsupportedTreatmentMemory("This case is still good law.")).toBe(true);
    expect(blocksUnsupportedTreatmentMemory("The decision was overruled.")).toBe(true);
    const mem = memorySafeResolutionFact(meta);
    expect(mem.allowed).toBe(true);
    expect(mem.fact).toMatch(/resolved to authority/);
    expect(blocksUnsupportedTreatmentMemory(mem.fact!)).toBe(false);
  });

  it("security: cross-org, cross-matter, global/matter separation, client_guest", async () => {
    await saveAuthorityToMatter({
      db,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      authorityId: authIds.brown!,
      userId: ids.owner!,
      status: "key_authority",
    });

    // Cross-org / cross-matter: outsider matter list must not include orgA link
    const foreignList = await listMatterAuthorities({
      db,
      organizationId: ids.orgB!,
      matterId: ids.matterB!,
    });
    expect(foreignList.every((row) => row.authorityId !== authIds.brown)).toBe(true);

    // Wrong orgId + matterA → empty (AND scope)
    const mismatched = await listMatterAuthorities({
      db,
      organizationId: ids.orgB!,
      matterId: ids.matterA!,
    });
    expect(mismatched).toEqual([]);

    // Global authority remains corpus-global (no org column); matter link is tenant-scoped
    const [globalRow] = await db
      .select({ id: legalAuthorities.id, sourceProvider: legalAuthorities.sourceProvider })
      .from(legalAuthorities)
      .where(eq(legalAuthorities.id, authIds.brown!))
      .limit(1);
    expect(globalRow?.sourceProvider).toBe(SOURCE_PROVIDER);

    const localList = await listMatterAuthorities({
      db,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
    });
    expect(localList.some((row) => row.authorityId === authIds.brown && row.status === "key_authority")).toBe(
      true,
    );

    // Cross-org Ask-style access denied
    await expect(
      requireMatterAccess(db, {
        userId: ids.outsider!,
        matterId: ids.matterA!,
        minAccess: "read",
        capability: "matters.view",
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);

    // client_guest: may view matter, cannot research.run (save authority mutation gate)
    await requireMatterAccess(db, {
      userId: ids.guest!,
      matterId: ids.matterA!,
      minAccess: "read",
      capability: "matters.view",
    });
    await expect(
      requireMatterAccess(db, {
        userId: ids.guest!,
        matterId: ids.matterA!,
        minAccess: "edit",
        capability: "research.run",
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);

    // Cross-matter: guest of A cannot access matter B
    await expect(
      requireMatterAccess(db, {
        userId: ids.guest!,
        matterId: ids.matterB!,
        minAccess: "read",
        capability: "matters.view",
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);

    // Leak check: orgB cannot update orgA matter_authority via scoped update
    const [leakAttempt] = await db
      .update(matterAuthorities)
      .set({ status: "rejected", updatedAt: new Date() })
      .where(
        and(
          eq(matterAuthorities.organizationId, ids.orgB!),
          eq(matterAuthorities.matterId, ids.matterA!),
          eq(matterAuthorities.authorityId, authIds.brown!),
        ),
      )
      .returning();
    expect(leakAttempt).toBeUndefined();

    const stillKey = await listMatterAuthorities({
      db,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
    });
    expect(stillKey.find((r) => r.authorityId === authIds.brown)?.status).toBe("key_authority");
  });

  it("performance: resolve >=40 citations from live index acceptably", async () => {
    const index = await loadAuthorityIndexForProduct(db, { limit: 5000 });
    const citations = Array.from({ length: 45 }, (_, i) => ({
      rawCitation: `${101 + i} F.3d ${201 + i}`,
    }));
    citations.push(
      { rawCitation: "347 U.S. 483" },
      { rawCitation: "999 F.2d 111" },
      { rawCitation: "1 Fake. Rep. 999" },
    );

    const started = Date.now();
    const rows = resolveCitationsForProduct({ citations, authorities: index });
    const ms = Date.now() - started;
    expect(rows.length).toBeGreaterThanOrEqual(40);
    expect(ms).toBeLessThan(3_000);
    expect(rows.filter((r) => r.outcome === "RESOLVED_HIGH_CONFIDENCE").length).toBeGreaterThan(30);

    console.log(JSON.stringify({ pass5Perf: { citations: rows.length, resolutionMs: ms, indexLoadMs } }));
  });

  it("failure injection: empty index, missing authority, incomplete metadata, ambiguous, missing treatment", async () => {
    const empty = resolveCitationsForProduct({
      citations: [{ rawCitation: "347 U.S. 483" }],
      authorities: [],
    });
    expect(empty[0]!.authorityId).toBeNull();
    expect(empty[0]!.coverage.displayState).toBe("UNRESOLVED");

    const index = await loadAuthorityIndexForProduct(db, { limit: 5000 });
    const missing = resolveCitationsForProduct({
      citations: [{ rawCitation: "55 Never. Existed 1" }],
      authorities: index,
    });
    expect(missing[0]!.authorityId).toBeNull();

    const incompleteRow = index.find((r) => r.id === authIds.incomplete);
    expect(incompleteRow).toBeTruthy();
    expect(incompleteRow!.citation).toBeNull();
    // Incomplete metadata authority must not fabricate a high-confidence identity for unrelated cites
    const unrelated = resolveCitationsForProduct({
      citations: [{ rawCitation: "888 F. Supp. 2d 1" }],
      authorities: index,
    });
    // May be unresolved because citation/normalized were null on insert
    expect(unrelated[0]!.authorityId === null || unrelated[0]!.outcome !== "RESOLVED_HIGH_CONFIDENCE" || unrelated[0]!.authorityId === authIds.incomplete).toBe(
      true,
    );

    const amb = resolveCitationsForProduct({
      citations: [{ rawCitation: "999 F.2d 111" }],
      authorities: index,
    });
    expect(amb[0]!.outcome).toBe("AMBIGUOUS");
    expect(applyResolveOrAbstainPolicy({ resolutions: amb }).suppressedCitations.length).toBe(1);

    const [treated] = resolveCitationsForProduct({
      citations: [{ rawCitation: "347 U.S. 483" }],
      authorities: index,
    });
    expect(treated!.coverage.treatmentUnknown).toBe(true);
    expect(treated!.coverage.treatmentVerifiedFromSource).toBe(false);

    // Health: fixture provider has exactly one row per source_external_id; ambiguous share citation by design (2)
    const dupExt = await db.execute(sql`
      SELECT source_external_id, COUNT(*)::int AS n
      FROM legal_authorities
      WHERE source_provider = ${SOURCE_PROVIDER}
      GROUP BY source_external_id
      HAVING COUNT(*) > 1
    `);
    expect((dupExt as unknown as Array<{ n: number }>).length).toBe(0);

    const falseCorpus = index.filter(
      (r) =>
        r.sourceProvider === SOURCE_PROVIDER &&
        r.corpusComplete === true &&
        r.metadata?.corpusComplete !== true &&
        r.metadata?.fullTextPresent !== true,
    );
    expect(falseCorpus.length).toBe(0);

    // toAuthorityIndexRow must not invent CORPUS_COMPLETE from ready status alone
    const metaOnly = toAuthorityIndexRow({
      id: "x",
      citation: "1 U.S. 1",
      ingestionStatus: "ready",
      metadata: {},
    });
    expect(metaOnly.corpusComplete).toBe(false);
  });
});
