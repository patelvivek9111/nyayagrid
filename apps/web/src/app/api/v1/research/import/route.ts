import { importAuthorityRequestSchema } from "@nyayagrid/validation";
import { requireCapability } from "@nyayagrid/permissions";
import { importAuthority } from "@nyayagrid/research";
import { createEmbeddingProviderFromEnv } from "@nyayagrid/ai";
import { isAuthorityHttpImportEnabled } from "@nyayagrid/platform";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonError, jsonOk } from "@/lib/http";
import { enforceRateLimit } from "@/lib/rate-limit";

/**
 * Operator-only HTTP path into the shared legal authority corpus. Ordinary tenant roles
 * (lawyer/staff/guest) cannot write the global corpus. Staging/production additionally require
 * ALLOW_AUTHORITY_HTTP_IMPORT=1.
 */
export async function POST(request: Request) {
  try {
    if (!isAuthorityHttpImportEnabled()) {
      return jsonError(
        "FORBIDDEN",
        "HTTP authority import is disabled. Populate the shared corpus with the operator CLI.",
        403,
      );
    }
    const { db, user } = await requireUser(request.headers);
    const body = importAuthorityRequestSchema.parse(await request.json());
    await requireCapability(db, {
      userId: user.id,
      organizationId: body.organizationId,
      capability: "organization.manage",
    });
    const limited = await enforceRateLimit(request, {
      endpointClass: "research",
      organizationId: body.organizationId,
      userId: user.id,
    });
    if (limited) return limited;

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
