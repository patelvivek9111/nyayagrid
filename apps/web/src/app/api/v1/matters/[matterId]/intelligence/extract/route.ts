import { MockAIProvider } from "@nyayagrid/ai";
import { extractIntelligenceSchema } from "@nyayagrid/validation";
import { requireMatterAccess, writeAuditEvent } from "@nyayagrid/permissions";
import { extractMatterIntelligenceForReadyDocuments } from "@nyayagrid/intelligence";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonOk } from "@/lib/http";

type Params = { params: Promise<{ matterId: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const { matterId } = await params;
    const { db, user } = await requireUser(request.headers);
    const { matter } = await requireMatterAccess(db, {
      userId: user.id,
      matterId,
      minAccess: "edit",
      capability: "timeline.manage",
    });
    const body = extractIntelligenceSchema.parse(await request.json().catch(() => ({})));
    const results = await extractMatterIntelligenceForReadyDocuments({
      db,
      organizationId: matter.organizationId,
      matterId,
      userId: user.id,
      documentVersionId: body.documentVersionId ?? undefined,
      ai: process.env.AI_PROVIDER === "openai" ? undefined : new MockAIProvider(),
    });

    await writeAuditEvent(db, {
      organizationId: matter.organizationId,
      actorUserId: user.id,
      matterId,
      action: "matter_intelligence.extract_requested",
      targetType: "matter",
      targetId: matterId,
      metadata: { runs: results.length },
    });

    return jsonOk({ results }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
