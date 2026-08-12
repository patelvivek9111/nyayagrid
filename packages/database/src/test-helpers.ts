import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  clients,
  createOrganizationWithDefaults,
  documents,
  documentVersions,
  matterMembers,
  matters,
  notes,
  tasks,
  users,
} from "@nyayagrid/database";
import {
  createDefaultTextExtractor,
  DevelopmentMalwareScanner,
  InMemoryStorageProvider,
  sha256Buffer,
  chunkSegments,
  TxtExtractor,
} from "@nyayagrid/documents";
import {
  MockAIProvider,
  MockEmbeddingProvider,
  validateCitedAnswerAgainstPassages,
  buildNyayaUserPrompt,
} from "@nyayagrid/ai";
import { InMemoryMatterRetriever } from "@nyayagrid/search";
import {
  AuthorizationError,
  requireCapability,
  requireMatterAccess,
  storageKeyForOrganization,
} from "@nyayagrid/permissions";
import { createClientSchema, createMatterSchema } from "@nyayagrid/validation";

export async function seedOrgFixture(
  db: ReturnType<typeof import("@nyayagrid/database").createDb>,
) {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const [owner] = await db
    .insert(users)
    .values({
      authSubject: `owner_${suffix}`,
      email: `owner_${suffix}@example.nyayagrid.local`,
      name: "Owner",
    })
    .returning();
  const [outsider] = await db
    .insert(users)
    .values({
      authSubject: `outsider_${suffix}`,
      email: `outsider_${suffix}@example.nyayagrid.local`,
      name: "Outsider",
    })
    .returning();
  const created = await createOrganizationWithDefaults(db, {
    name: `Firm ${suffix}`,
    slug: `firm-${suffix}`,
    type: "firm",
    ownerUserId: owner!.id,
  });
  return {
    suffix,
    owner: owner!,
    outsider: outsider!,
    organization: created.organization,
  };
}

export {
  randomUUID,
  eq,
  clients,
  documents,
  documentVersions,
  matterMembers,
  matters,
  notes,
  tasks,
  createDefaultTextExtractor,
  DevelopmentMalwareScanner,
  InMemoryStorageProvider,
  sha256Buffer,
  chunkSegments,
  TxtExtractor,
  MockAIProvider,
  MockEmbeddingProvider,
  validateCitedAnswerAgainstPassages,
  buildNyayaUserPrompt,
  InMemoryMatterRetriever,
  AuthorizationError,
  requireCapability,
  requireMatterAccess,
  storageKeyForOrganization,
  createClientSchema,
  createMatterSchema,
};
