import { requireAnyCapability } from "@nyayagrid/permissions";
import { searchAuthorities } from "@nyayagrid/research";
import { createEmbeddingProviderFromEnv } from "@nyayagrid/ai";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonError, jsonOk } from "@/lib/http";

const RESEARCH_CAPABILITIES = ["research.run", "matters.view"] as const;

export async function GET(request: Request) {
  try {
    const { db, user } = await requireUser(request.headers);
    const url = new URL(request.url);
    const organizationId = url.searchParams.get("organizationId");
    if (!organizationId) {
      return jsonError("VALIDATION_ERROR", "organizationId is required", 400);
    }
    await requireAnyCapability(db, {
      userId: user.id,
      organizationId,
      capabilities: [...RESEARCH_CAPABILITIES],
    });

    const q = url.searchParams.get("q")?.trim();
    if (!q) {
      return jsonOk({ authorities: [] });
    }
    const results = await searchAuthorities({
      db,
      embeddings: createEmbeddingProviderFromEnv(),
      query: q,
      filters: {
        jurisdiction: url.searchParams.get("jurisdiction") ?? undefined,
        court: url.searchParams.get("court") ?? undefined,
        authorityType: url.searchParams.get("authorityType") ?? undefined,
        citation: url.searchParams.get("citation") ?? undefined,
        dateFrom: url.searchParams.get("dateFrom") ?? undefined,
        dateTo: url.searchParams.get("dateTo") ?? undefined,
      },
      limit: Number(url.searchParams.get("limit") ?? "20") || 20,
    });
    return jsonOk({ authorities: results });
  } catch (error) {
    return handleRouteError(error);
  }
}
