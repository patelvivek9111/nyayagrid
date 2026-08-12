import { importAuthorityRequestSchema } from "@nyayagrid/validation";
import { requireAnyCapability } from "@nyayagrid/permissions";
import { importAuthority } from "@nyayagrid/research";
import { createEmbeddingProviderFromEnv } from "@nyayagrid/ai";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonOk } from "@/lib/http";

/**
 * Explicit-metadata authority import. Intended for dev/admin tooling and the CLI's HTTP
 * equivalent — never infers metadata from an uploaded filename or from model output.
 */
export async function POST(request: Request) {
  try {
    const { db, user } = await requireUser(request.headers);
    const body = importAuthorityRequestSchema.parse(await request.json());
    await requireAnyCapability(db, {
      userId: user.id,
      organizationId: body.organizationId,
      capabilities: ["documents.upload", "organization.manage"],
    });

    const embeddings = createEmbeddingProviderFromEnv();
    const results = [];
    for (const input of body.authorities) {
      const result = await importAuthority({
        db,
        embeddings,
        input,
        actor: { organizationId: body.organizationId, userId: user.id },
      });
      results.push({
        authorityId: result.authority.id,
        title: result.authority.title,
        versionNumber: result.version.versionNumber,
        chunkCount: result.chunkCount,
        citationCount: result.citationCount,
        skipped: Boolean(result.skipped),
      });
    }
    return jsonOk({ imported: results }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
