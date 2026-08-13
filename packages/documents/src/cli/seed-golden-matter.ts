#!/usr/bin/env node
/**
 * Seed the synthetic golden lease matter into local Postgres + object storage.
 *
 * Usage:
 *   npm run seed:golden-matter
 *
 * Requires DATABASE_URL and storage env (docker compose defaults work).
 * Creates / reuses org slug `synth-golden-demo` and matter number `SYNTH-GOLDEN-LEASE-V1`.
 * All documents are clearly labeled SYNTH — not real authorities.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq } from "drizzle-orm";
import { ensureUserFromIdentity } from "@nyayagrid/auth";
import {
  buildGoldenFixtureDocuments,
  GOLDEN_MATTER_ID,
  MockEmbeddingProvider,
} from "@nyayagrid/ai";
import {
  clients,
  createDb,
  createOrganizationWithDefaults,
  documents,
  documentVersions,
  matterMembers,
  matters,
  organizations,
} from "@nyayagrid/database";
import { storageKeyForOrganization } from "@nyayagrid/permissions";
import {
  createStorageProviderFromEnv,
  DevelopmentMalwareScanner,
  processDocumentPipeline,
  sha256Buffer,
} from "../index";

const MATTER_NUMBER = "SYNTH-GOLDEN-LEASE-V1";
const ORG_SLUG = "synth-golden-demo";
const ORG_NAME = "SYNTH Golden Demo Firm";

function fixturesDir(): string {
  return join(
    dirname(fileURLToPath(import.meta.url)),
    "../../../ai/src/evals/golden-fixtures",
  );
}

async function main() {
  const databaseUrl =
    process.env.DATABASE_URL ?? "postgresql://nyayagrid:nyayagrid@localhost:5433/nyayagrid";
  if (!process.env.DATABASE_URL) {
    console.warn(
      `[seed:golden-matter] DATABASE_URL unset; using docker-compose default (${databaseUrl})`,
    );
  }

  const db = createDb(databaseUrl);
  const storage = createStorageProviderFromEnv();
  await storage.ensureBucket();
  const scanner = new DevelopmentMalwareScanner();
  const embeddings = new MockEmbeddingProvider();

  const user = await ensureUserFromIdentity(db, {
    subject: process.env.DEV_AUTH_USER_ID ?? "dev_user_owner",
    email: process.env.DEV_AUTH_EMAIL ?? "owner@example.nyayagrid.local",
    name: process.env.DEV_AUTH_NAME ?? "Dev Owner",
  });

  let org = await db.query.organizations.findFirst({
    where: eq(organizations.slug, ORG_SLUG),
  });
  if (!org) {
    const created = await createOrganizationWithDefaults(db, {
      name: ORG_NAME,
      slug: ORG_SLUG,
      type: "firm",
      ownerUserId: user.id,
    });
    org = created.organization;
  }

  let client = await db.query.clients.findFirst({
    where: and(
      eq(clients.organizationId, org.id),
      eq(clients.displayName, "SYNTH Golden Tenant Co"),
    ),
  });
  if (!client) {
    const [created] = await db
      .insert(clients)
      .values({
        organizationId: org.id,
        clientType: "organization",
        displayName: "SYNTH Golden Tenant Co",
        organizationName: "SYNTH Golden Tenant Co",
        createdByUserId: user.id,
      })
      .returning();
    client = created!;
  }

  let matter = await db.query.matters.findFirst({
    where: and(eq(matters.organizationId, org.id), eq(matters.matterNumber, MATTER_NUMBER)),
  });
  if (!matter) {
    const [created] = await db
      .insert(matters)
      .values({
        organizationId: org.id,
        clientId: client.id,
        matterNumber: MATTER_NUMBER,
        title: `SYNTH Golden Lease (${GOLDEN_MATTER_ID})`,
        description:
          "Synthetic eval/demo Case — not a real matter. Upload fixtures from packages/ai/src/evals/golden-fixtures.",
        practiceArea: "commercial_lease",
        jurisdiction: "SYNTH / Demo",
        createdByUserId: user.id,
      })
      .returning();
    matter = created!;
    await db.insert(matterMembers).values({
      organizationId: org.id,
      matterId: matter.id,
      userId: user.id,
      access: "manage",
    });
  }

  const fixtureDocs = buildGoldenFixtureDocuments();
  const dir = fixturesDir();
  const uploaded: Array<{ title: string; processingState: string }> = [];

  for (const fixture of fixtureDocs) {
    const existing = await db.query.documents.findFirst({
      where: and(
        eq(documents.organizationId, org.id),
        eq(documents.matterId, matter.id),
        eq(documents.title, fixture.title),
      ),
    });
    if (existing) {
      uploaded.push({
        title: fixture.title,
        processingState: existing.processingState,
      });
      continue;
    }

    const bodyFromDisk = readFileSync(join(dir, fixture.filename));
    const body = Buffer.from(bodyFromDisk);
    const documentId = randomUUID();
    const versionId = randomUUID();
    const key = storageKeyForOrganization({
      organizationId: org.id,
      documentId,
      versionId,
      filename: fixture.filename,
    });
    await storage.putObject({ key, body, contentType: "text/plain" });

    await db.insert(documents).values({
      id: documentId,
      organizationId: org.id,
      matterId: matter.id,
      title: fixture.title,
      createdByUserId: user.id,
      processingState: "uploaded",
    });

    await db.insert(documentVersions).values({
      id: versionId,
      documentId,
      organizationId: org.id,
      versionNumber: 1,
      storageKey: key,
      contentType: "text/plain",
      byteSize: body.length,
      sha256: sha256Buffer(body),
      originalFilename: fixture.filename,
      uploadedByUserId: user.id,
    });

    const processed = await processDocumentPipeline(
      { db, storage, scanner, embeddings },
      {
        organizationId: org.id,
        matterId: matter.id,
        documentId,
        documentVersionId: versionId,
      },
    );
    uploaded.push({ title: fixture.title, processingState: processed.state });
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  console.log(
    JSON.stringify(
      {
        message: "Seeded SYNTH golden matter (not real authorities)",
        corpus: GOLDEN_MATTER_ID,
        organizationId: org.id,
        organizationSlug: ORG_SLUG,
        matterId: matter.id,
        matterNumber: MATTER_NUMBER,
        caseUrl: `${baseUrl}/app/cases/${matter.id}`,
        documentsUrl: `${baseUrl}/app/cases/${matter.id}/documents`,
        documents: uploaded,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
