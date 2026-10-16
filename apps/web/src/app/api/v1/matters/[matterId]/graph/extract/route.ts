import { MockAIProvider } from "@nyayagrid/ai";
import { requireMatterAccess } from "@nyayagrid/permissions";
import {
  extractGraphRelationshipCandidates,
  GraphFocusRejectedError,
} from "@nyayagrid/intelligence";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonError, jsonOk } from "@/lib/http";

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

    let focusNodeId: string | null = null;
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      try {
        const body = (await request.json()) as { focusNodeId?: unknown };
        if (typeof body.focusNodeId === "string" && body.focusNodeId.trim()) {
          focusNodeId = body.focusNodeId.trim();
        }
      } catch {
        // Empty or invalid body: whole-matter mode.
      }
    }

    const result = await extractGraphRelationshipCandidates({
      db,
      organizationId: matter.organizationId,
      matterId,
      userId: user.id,
      focusNodeId,
      ai: process.env.AI_PROVIDER === "openai" ? undefined : new MockAIProvider(),
    });
    return jsonOk(result, { status: 201 });
  } catch (error) {
    if (error instanceof GraphFocusRejectedError) {
      return jsonError("GRAPH_FOCUS_REJECTED", error.message, 400);
    }
    return handleRouteError(error);
  }
}
