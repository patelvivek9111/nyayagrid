#!/usr/bin/env node
/**
 * Product Postgres warrant validation for Deepening Pass 2.
 * Uses local product DATABASE_URL only. Zero CourtListener. Zero Neon writes.
 */
"use strict";

async function main() {
  process.env.DATABASE_URL = process.env.PRODUCT_DATABASE_URL || process.env.DATABASE_URL;
  if (!process.env.DATABASE_URL || !/localhost|127\.0\.0\.1|:5433/.test(process.env.DATABASE_URL)) {
    console.log(JSON.stringify({ ok: false, reason: "PRODUCT_DATABASE_URL must be local Postgres" }));
    process.exit(2);
  }
  if (/neon\.tech|ep-jolly-brook/i.test(process.env.DATABASE_URL)) {
    console.log(JSON.stringify({ ok: false, reason: "Refusing to write product validation to Neon corpus" }));
    process.exit(2);
  }

  const { createDb, closeDb, createOrganizationWithDefaults, users, memberships } = await import("@nyayagrid/database");
  const {
    createCriminalCase,
    addProsecutionRecord,
    getProsecutionOverview,
  } = await import("@nyayagrid/intelligence");

  const db = createDb(process.env.DATABASE_URL);
  const suffix = Date.now().toString(36);
  const provenance = { extractionOrigin: "human", humanEntered: true };
  const failures = [];

  try {
    const [owner] = await db
      .insert(users)
      .values({
        authSubject: `pass2_owner_${suffix}`,
        email: `pass2_owner_${suffix}@example.nyayagrid.local`,
        name: "Pass2 Owner",
      })
      .returning();
    const org = await createOrganizationWithDefaults(db, {
      name: `Pass2 Org ${suffix}`,
      slug: `pass2-${suffix}`,
      type: "firm",
      ownerUserId: owner.id,
    });

    const criminalCase = await createCriminalCase(db, {
      userId: owner.id,
      organizationId: org.organization.id,
      caseNumber: `PASS2-${suffix}`,
      jurisdiction: "US",
      court: "us-d-pa-ed",
    });

    const ada = await addProsecutionRecord(db, {
      userId: owner.id,
      organizationId: org.organization.id,
      caseId: criminalCase.id,
      resource: "defendants",
      body: { displayName: "Ada Pass2", provenance },
    });
    const ben = await addProsecutionRecord(db, {
      userId: owner.id,
      organizationId: org.organization.id,
      caseId: criminalCase.id,
      resource: "defendants",
      body: { displayName: "Ben Pass2", provenance },
    });

    const evAda = await addProsecutionRecord(db, {
      userId: owner.id,
      organizationId: org.organization.id,
      caseId: criminalCase.id,
      resource: "evidence",
      body: {
        evidenceType: "device",
        storageReference: "PASS2-ADA",
        relatedDefendantIds: [ada.id],
        provenance,
      },
    });
    const evJoint = await addProsecutionRecord(db, {
      userId: owner.id,
      organizationId: org.organization.id,
      caseId: criminalCase.id,
      resource: "evidence",
      body: {
        evidenceType: "scene_photo",
        storageReference: "PASS2-JOINT",
        relatedDefendantIds: [ada.id, ben.id],
        provenance,
      },
    });

    const warrantAda = await addProsecutionRecord(db, {
      userId: owner.id,
      organizationId: org.organization.id,
      caseId: criminalCase.id,
      resource: "warrants",
      body: {
        warrantType: "search",
        issuingCourt: "us-d-pa-ed",
        applicationDate: "2026-03-01",
        issueDate: "2026-03-01",
        executionDate: "2026-03-02",
        scope: "Ada phone",
        probableCauseFacts: [],
        seizedEvidenceIds: [evAda.id],
        relatedSuppressionIssueIds: [],
        provenance,
      },
    });
    const warrantJoint = await addProsecutionRecord(db, {
      userId: owner.id,
      organizationId: org.organization.id,
      caseId: criminalCase.id,
      resource: "warrants",
      body: {
        warrantType: "search",
        issuingCourt: "us-d-pa-ed",
        applicationDate: "2026-03-10",
        issueDate: "2026-03-11",
        executionDate: "2026-03-12",
        scope: "shared residence",
        probableCauseFacts: ["Observation dated 2026-03-09 at the shared residence."],
        seizedEvidenceIds: [evJoint.id],
        returnNotes: "Inventory listed a bag.",
        relatedSuppressionIssueIds: [],
        provenance,
      },
    });

    await addProsecutionRecord(db, {
      userId: owner.id,
      organizationId: org.organization.id,
      caseId: criminalCase.id,
      resource: "warrant-affidavits",
      body: {
        warrantId: warrantJoint.id,
        affiant: "Officer Pass2",
        statement: "Observation dated 2026-03-09 at the shared residence.",
        provenance,
      },
    });

    await addProsecutionRecord(db, {
      userId: owner.id,
      organizationId: org.organization.id,
      caseId: criminalCase.id,
      resource: "timeline",
      body: {
        eventType: "WARRANT_ISSUED",
        title: "Ada warrant issued",
        eventDate: "2026-03-01T12:00:00.000Z",
        provenance,
      },
    });
    await addProsecutionRecord(db, {
      userId: owner.id,
      organizationId: org.organization.id,
      caseId: criminalCase.id,
      resource: "timeline",
      body: {
        eventType: "WARRANT_EXECUTED",
        title: "Ada warrant executed",
        eventDate: "2026-03-02T12:00:00.000Z",
        provenance,
      },
    });
    await addProsecutionRecord(db, {
      userId: owner.id,
      organizationId: org.organization.id,
      caseId: criminalCase.id,
      resource: "timeline",
      body: {
        eventType: "WARRANT_ISSUED",
        title: "Residence warrant issued",
        eventDate: "2026-03-11T12:00:00.000Z",
        provenance,
      },
    });
    await addProsecutionRecord(db, {
      userId: owner.id,
      organizationId: org.organization.id,
      caseId: criminalCase.id,
      resource: "timeline",
      body: {
        eventType: "WARRANT_EXECUTED",
        title: "Residence warrant executed",
        eventDate: "2026-03-12T12:00:00.000Z",
        provenance,
      },
    });

    const overview = await getProsecutionOverview(db, {
      userId: owner.id,
      organizationId: org.organization.id,
      caseId: criminalCase.id,
    });
    const reloaded = await getProsecutionOverview(db, {
      userId: owner.id,
      organizationId: org.organization.id,
      caseId: criminalCase.id,
    });

    if (!overview.suppressionReview) failures.push("suppressionReview missing");
    if (overview.suppressionConclusion != null) failures.push("suppression conclusion present");
    if (overview.suppressionReview?.validityConclusion != null) failures.push("validity conclusion present");
    if (overview.guiltConclusion != null) failures.push("guilt conclusion present");
    if ((overview.suppressionReview?.warrants?.length ?? 0) !== 2) failures.push("expected two warrants");

    const adaView = overview.suppressionReview.warrants.find((w) => w.id === warrantAda.id);
    const jointView = overview.suppressionReview.warrants.find((w) => w.id === warrantJoint.id);
    if (!adaView || !jointView) failures.push("warrant views missing after reload");
    if (adaView.evidence.some((e) => e.evidenceId !== evAda.id)) failures.push("Ada warrant evidence leak");
    if (jointView.evidence.some((e) => e.evidenceId !== evJoint.id)) failures.push("joint warrant evidence leak");
    if (JSON.stringify(adaView) !== JSON.stringify(reloaded.suppressionReview.warrants.find((w) => w.id === warrantAda.id))) {
      failures.push("warrant review changed on reload");
    }

    const adaIssues = overview.suppressionReview.issues.filter((i) => i.warrantId === warrantAda.id);
    const jointIssues = overview.suppressionReview.issues.filter((i) => i.warrantId === warrantJoint.id);
    if (adaIssues.length === 0 || jointIssues.length === 0) failures.push("issues not separated by warrant");
    if (!adaIssues.some((i) => i.missingFacts.length > 0)) failures.push("Ada missing facts not surfaced");
    if (adaIssues.some((i) => i.linkedEvidence.some((e) => e.evidenceId === evJoint.id))) failures.push("cross-warrant evidence on Ada issue");
    if (jointIssues.some((i) => i.linkedEvidence.some((e) => e.evidenceId === evAda.id))) failures.push("cross-warrant evidence on joint issue");

    const gates = overview.suppressionReview.issues
      .flatMap((i) => i.authorities.map((a) => ({ dim: i.dimension, citation: a.citation, treatment: a.treatment })))
      .filter((a) => a.citation === "462 U.S. 213");
    if (!gates.some((a) => a.dim === "PROBABLE_CAUSE")) failures.push("Gates not on probable cause");
    if (gates.some((a) => a.dim === "GOOD_FAITH")) failures.push("Gates leaked onto good faith");
    if (gates.some((a) => a.treatment !== "UNVERIFIED")) failures.push("Gates treatment not unverified");

    const leon = overview.suppressionReview.issues
      .flatMap((i) => i.authorities.map((a) => ({ dim: i.dimension, citation: a.citation })))
      .filter((a) => a.citation === "468 U.S. 897");
    if (leon.some((a) => a.dim === "PROBABLE_CAUSE")) failures.push("Leon leaked onto probable cause");

    // Cross-tenant blocked
    const [otherOwner] = await db
      .insert(users)
      .values({
        authSubject: `pass2_other_${suffix}`,
        email: `pass2_other_${suffix}@example.nyayagrid.local`,
        name: "Other",
      })
      .returning();
    const otherOrg = await createOrganizationWithDefaults(db, {
      name: `Pass2 Other ${suffix}`,
      slug: `pass2-other-${suffix}`,
      type: "firm",
      ownerUserId: otherOwner.id,
    });
    let blocked = false;
    try {
      await getProsecutionOverview(db, {
        userId: otherOwner.id,
        organizationId: otherOrg.organization.id,
        caseId: criminalCase.id,
      });
    } catch {
      blocked = true;
    }
    if (!blocked) failures.push("cross-case access was not blocked");

    console.log(
      JSON.stringify(
        {
          ok: failures.length === 0,
          failures,
          caseId: criminalCase.id,
          organizationId: org.organization.id,
          warrants: overview.suppressionReview.warrants.map((w) => w.id),
          issueCount: overview.suppressionReview.issues.length,
          dimensions: [...new Set(overview.suppressionReview.issues.map((i) => i.dimension))],
          authorityCitations: [
            ...new Set(overview.suppressionReview.issues.flatMap((i) => i.authorities.map((a) => a.citation))),
          ],
          suppressionConclusion: overview.suppressionReview.suppressionConclusion,
          validityConclusion: overview.suppressionReview.validityConclusion,
          guiltConclusion: overview.guiltConclusion,
        },
        null,
        2,
      ),
    );
    if (failures.length > 0) process.exit(1);
  } finally {
    await closeDb(db);
  }
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: String(err && err.message ? err.message : err) }));
  process.exit(1);
});
