import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { and, eq } from "drizzle-orm";
import { ensureUserFromIdentity } from "@nyayagrid/auth";
import {
  createAIProviderFromEnv,
  createEmbeddingProviderFromEnv,
  type EmbeddingProvider,
} from "@nyayagrid/ai";
import {
  clients,
  closeDb,
  createDb,
  createOrganizationWithDefaults,
  documents,
  documentVersions,
  matterMembers,
  matters,
  organizations,
  type Database,
} from "@nyayagrid/database";
import { storageKeyForOrganization } from "@nyayagrid/permissions";
import {
  createStorageProviderFromEnv,
  DevelopmentMalwareScanner,
  processDocumentPipeline,
  sha256Buffer,
} from "@nyayagrid/documents";
import { extractMatterIntelligenceForReadyDocuments } from "@nyayagrid/intelligence";
import { assertIngestibleDocumentPath } from "./isolate";
import { datasetRoot } from "./paths";
import type { BenchDocument, BenchScenario } from "./catalog";

const ORG_SLUG = "nyaya-bench";
const ORG_NAME = "SYNTH Nyaya Bench";

export type IngestedDocument = BenchDocument & {
  nyayaDocumentId: string;
  nyayaVersionId: string;
  processingState: string;
};

export type IngestedMatter = {
  organizationId: string;
  matterId: string;
  userId: string;
  documents: IngestedDocument[];
};

function contentTypeFor(filename: string): string {
  if (filename.toLowerCase().endsWith(".pdf")) return "application/pdf";
  if (filename.toLowerCase().endsWith(".txt")) return "text/plain";
  return "application/octet-stream";
}

export async function ingestScenario(params: {
  db: Database;
  scenario: BenchScenario;
  runId: string;
  extractIntelligence?: boolean;
  organizationSlug?: string;
  organizationName?: string;
  skipPipelineFilenames?: string[];
  excludeFilenames?: string[];
}): Promise<IngestedMatter> {
  const datasetRootPath = datasetRoot(params.scenario.dataset);
  const storage = createStorageProviderFromEnv();
  await storage.ensureBucket();
  const scanner = new DevelopmentMalwareScanner();
  const embeddings: EmbeddingProvider = createEmbeddingProviderFromEnv();
  const ai = createAIProviderFromEnv();
  const skipPipeline = new Set((params.skipPipelineFilenames ?? []).map((name) => name.toLowerCase()));
  const exclude = new Set((params.excludeFilenames ?? []).map((name) => name.toLowerCase()));
  const orgSlug = params.organizationSlug ?? ORG_SLUG;
  const orgName = params.organizationName ?? ORG_NAME;

  const user = await ensureUserFromIdentity(params.db, {
    subject: process.env.DEV_AUTH_USER_ID ?? "nyaya_bench_owner",
    email: process.env.DEV_AUTH_EMAIL ?? "bench@example.nyayagrid.local",
    name: process.env.DEV_AUTH_NAME ?? "Nyaya Bench",
  });

  let org = await params.db.query.organizations.findFirst({
    where: eq(organizations.slug, orgSlug),
  });
  if (!org) {
    const created = await createOrganizationWithDefaults(params.db, {
      name: orgName,
      slug: orgSlug,
      type: "firm",
      ownerUserId: user.id,
    });
    org = created.organization;
  }

  const clientName = `SYNTH Bench ${params.scenario.scenarioId}`;
  let client = await params.db.query.clients.findFirst({
    where: and(eq(clients.organizationId, org.id), eq(clients.displayName, clientName)),
  });
  if (!client) {
    const [created] = await params.db
      .insert(clients)
      .values({
        organizationId: org.id,
        clientType: "organization",
        displayName: clientName,
        organizationName: clientName,
        createdByUserId: user.id,
      })
      .returning();
    client = created!;
  }

  const matterNumber = `NB-${params.scenario.scenarioId}-${params.runId}`;
  const [matter] = await params.db
    .insert(matters)
    .values({
      organizationId: org.id,
      clientId: client.id,
      matterNumber,
      title: `SYNTH ${params.scenario.title}`,
      description: `Nyaya Bench ${params.scenario.dataset} scenario ${params.scenario.scenarioId}. Fictional test data only.`,
      practiceArea: params.scenario.matterType,
      jurisdiction: "SYNTH / Bench",
      createdByUserId: user.id,
    })
    .returning();
  if (!matter) throw new Error("Failed to create benchmark matter");

  await params.db.insert(matterMembers).values({
    organizationId: org.id,
    matterId: matter.id,
    userId: user.id,
    access: "manage",
  });

  const ingested: IngestedDocument[] = [];
  for (const doc of params.scenario.documents) {
    const filenameHint = basename(doc.absolutePath).toLowerCase();
    if (exclude.has(filenameHint) || exclude.has(doc.filename.toLowerCase())) continue;
    const absolutePath = assertIngestibleDocumentPath(datasetRootPath, doc.absolutePath);
    const body = readFileSync(absolutePath);
    const documentId = randomUUID();
    const versionId = randomUUID();
    const filename = basename(absolutePath);
    const key = storageKeyForOrganization({
      organizationId: org.id,
      documentId,
      versionId,
      filename,
    });
    await storage.putObject({
      key,
      body: Buffer.from(body),
      contentType: contentTypeFor(filename),
    });
    await params.db.insert(documents).values({
      id: documentId,
      organizationId: org.id,
      matterId: matter.id,
      title: doc.title,
      createdByUserId: user.id,
      processingState: "uploaded",
    });
    await params.db.insert(documentVersions).values({
      id: versionId,
      documentId,
      organizationId: org.id,
      versionNumber: 1,
      storageKey: key,
      contentType: contentTypeFor(filename),
      byteSize: body.length,
      sha256: sha256Buffer(Buffer.from(body)),
      originalFilename: filename,
      uploadedByUserId: user.id,
    });
    const skipThis = skipPipeline.has(filename.toLowerCase()) || skipPipeline.has(doc.filename.toLowerCase());
    let processingState = "uploaded";
    if (!skipThis) {
      const processed = await processDocumentPipeline(
        { db: params.db, storage, scanner, embeddings },
        {
          organizationId: org.id,
          matterId: matter.id,
          documentId,
          documentVersionId: versionId,
        },
      );
      processingState = processed.state;
    }
    ingested.push({
      ...doc,
      nyayaDocumentId: documentId,
      nyayaVersionId: versionId,
      processingState,
    });
  }

  if (params.extractIntelligence !== false) {
    try {
      await extractMatterIntelligenceForReadyDocuments({
        db: params.db,
        organizationId: org.id,
        matterId: matter.id,
        userId: user.id,
        ai,
      });
    } catch (error) {
      console.warn(
        `[nyaya-bench] intelligence extract skipped: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return {
    organizationId: org.id,
    matterId: matter.id,
    userId: user.id,
    documents: ingested,
  };
}

/** Upload additional scenario documents into an existing matter (late ingest / race tests). */
export async function ingestFilesIntoMatter(params: {
  db: Database;
  matter: IngestedMatter;
  scenario: BenchScenario;
  filenames: string[];
  skipPipeline?: boolean;
}): Promise<IngestedDocument[]> {
  const datasetRootPath = datasetRoot(params.scenario.dataset);
  const storage = createStorageProviderFromEnv();
  await storage.ensureBucket();
  const scanner = new DevelopmentMalwareScanner();
  const embeddings: EmbeddingProvider = createEmbeddingProviderFromEnv();
  const wanted = new Set(params.filenames.map((name) => name.toLowerCase()));
  const added: IngestedDocument[] = [];
  for (const doc of params.scenario.documents) {
    if (!wanted.has(doc.filename.toLowerCase()) && !wanted.has(basename(doc.absolutePath).toLowerCase())) {
      continue;
    }
    const absolutePath = assertIngestibleDocumentPath(datasetRootPath, doc.absolutePath);
    const body = readFileSync(absolutePath);
    const documentId = randomUUID();
    const versionId = randomUUID();
    const filename = basename(absolutePath);
    const key = storageKeyForOrganization({
      organizationId: params.matter.organizationId,
      documentId,
      versionId,
      filename,
    });
    await storage.putObject({
      key,
      body: Buffer.from(body),
      contentType: contentTypeFor(filename),
    });
    await params.db.insert(documents).values({
      id: documentId,
      organizationId: params.matter.organizationId,
      matterId: params.matter.matterId,
      title: doc.title,
      createdByUserId: params.matter.userId,
      processingState: "uploaded",
    });
    await params.db.insert(documentVersions).values({
      id: versionId,
      documentId,
      organizationId: params.matter.organizationId,
      versionNumber: 1,
      storageKey: key,
      contentType: contentTypeFor(filename),
      byteSize: body.length,
      sha256: sha256Buffer(Buffer.from(body)),
      originalFilename: filename,
      uploadedByUserId: params.matter.userId,
    });
    let processingState = "uploaded";
    if (!params.skipPipeline) {
      const processed = await processDocumentPipeline(
        { db: params.db, storage, scanner, embeddings },
        {
          organizationId: params.matter.organizationId,
          matterId: params.matter.matterId,
          documentId,
          documentVersionId: versionId,
        },
      );
      processingState = processed.state;
    }
    added.push({
      ...doc,
      nyayaDocumentId: documentId,
      nyayaVersionId: versionId,
      processingState,
    });
  }
  return added;
}

export function createBenchDb(): Database {
  const databaseUrl =
    process.env.DATABASE_URL ?? "postgresql://nyayagrid:nyayagrid@localhost:5433/nyayagrid";
  return createDb(databaseUrl);
}

export async function closeBenchDb(db: Database): Promise<void> {
  await closeDb(db);
}
