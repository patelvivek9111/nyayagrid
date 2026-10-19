import { requireMatterAccess } from "@nyayagrid/permissions";
import {
  extractGraphRelationshipCandidates,
  GraphFocusRejectedError,
} from "@nyayagrid/intelligence";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonError, jsonOk } from "@/lib/http";
import { getAI } from "@/lib/infra";
import { beginRouteCorrelation } from "@/lib/request-correlation";

type Params = { params: Promise<{ matterId: string }> };

export async function POST(request: Request, { params }: Params) {
  const corr = beginRouteCorrelation(request, "api.graph.extract");
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

    const focusMode = focusNodeId ? "FOCUSED" : "WHOLE_MATTER";
    const result = await extractGraphRelationshipCandidates({
      db,
      organizationId: matter.organizationId,
      matterId,
      userId: user.id,
      focusNodeId,
      ai: getAI(),
    });
    const coverage = result.coverage;
    corr.log.info("graph.extract", {
      route: "graph.extract",
      matterId,
      focusMode,
      candidateNodes: coverage?.candidateNodes ?? null,
      selectedNodes: coverage?.selectedNodes ?? null,
      candidateChunks: coverage?.candidateChunks ?? null,
      selectedChunks: coverage?.selectedChunks ?? null,
      coverageLimited: coverage?.coverageLimited ?? null,
      provider: result.provider ?? null,
      durationMs: corr.elapsedMs(),
      outcome: "ok",
    });
    return corr.attach(jsonOk(result, { status: 201 }));
  } catch (error) {
    if (error instanceof GraphFocusRejectedError) {
      corr.log.warn("graph.extract.focus_rejected", {
        route: "graph.extract",
        matterId: (await params).matterId,
        durationMs: corr.elapsedMs(),
        outcome: "GRAPH_FOCUS_REJECTED",
      });
      return corr.attach(jsonError("GRAPH_FOCUS_REJECTED", error.message, 400));
    }
    corr.log.error("graph.extract.error", {
      route: "graph.extract",
      durationMs: corr.elapsedMs(),
      outcome: "error",
    });
    return corr.attach(handleRouteError(error));
  }
}
