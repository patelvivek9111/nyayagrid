import { z } from "zod";
import {
  createProsecutionGraphEdge,
  listProsecutionCaseGraph,
  syncProsecutionCaseGraphProjection,
} from "@nyayagrid/intelligence";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonError, jsonOk } from "@/lib/http";

type Params = { params: Promise<{ caseId: string }> };

const provenanceSchema = z
  .object({
    documentId: z.string().uuid().nullable().optional(),
    authorityId: z.string().uuid().nullable().optional(),
    sourceSpan: z.string().trim().max(8000).nullable().optional(),
    sourcePage: z.number().int().nullable().optional(),
    section: z.string().trim().max(200).nullable().optional(),
    extractionOrigin: z
      .enum(["human", "import", "deterministic_fixture", "source_metadata"])
      .optional(),
    humanEntered: z.boolean().optional(),
  })
  .refine(
    (value) =>
      value.humanEntered === true ||
      value.extractionOrigin === "human" ||
      Boolean(value.documentId || value.authorityId || value.sourceSpan),
    { message: "Provenance requires a document, authority, source span, or human origin." },
  );

const postSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("sync_projection"),
    organizationId: z.string().uuid(),
  }),
  z.object({
    action: z.literal("create_edge"),
    organizationId: z.string().uuid(),
    fromNodeId: z.string().uuid(),
    toNodeId: z.string().uuid(),
    relationshipType: z.string().trim().min(1).max(80),
    confidence: z.enum(["low", "medium", "high"]).nullable().optional(),
    provenance: provenanceSchema,
  }),
]);

export async function GET(request: Request, { params }: Params) {
  try {
    const { caseId } = await params;
    if (!z.string().uuid().safeParse(caseId).success) {
      return jsonError("VALIDATION_ERROR", "caseId must be a UUID", 400);
    }
    const { db, user } = await requireUser(request.headers);
    const url = new URL(request.url);
    const organizationId = url.searchParams.get("organizationId");
    if (!organizationId || !z.string().uuid().safeParse(organizationId).success) {
      return jsonError("VALIDATION_ERROR", "organizationId required", 400);
    }
    const graph = await listProsecutionCaseGraph(db, {
      userId: user.id,
      organizationId,
      caseId,
      status: url.searchParams.get("status"),
    });
    return jsonOk(graph);
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request, { params }: Params) {
  try {
    const { caseId } = await params;
    if (!z.string().uuid().safeParse(caseId).success) {
      return jsonError("VALIDATION_ERROR", "caseId must be a UUID", 400);
    }
    const { db, user } = await requireUser(request.headers);
    const body = postSchema.parse(await request.json());
    if (body.action === "sync_projection") {
      const graph = await syncProsecutionCaseGraphProjection(db, {
        userId: user.id,
        organizationId: body.organizationId,
        caseId,
      });
      return jsonOk(graph);
    }
    const edge = await createProsecutionGraphEdge(db, {
      userId: user.id,
      organizationId: body.organizationId,
      caseId,
      fromNodeId: body.fromNodeId,
      toNodeId: body.toNodeId,
      relationshipType: body.relationshipType,
      provenance: body.provenance,
      confidence: body.confidence,
    });
    return jsonOk({ edge }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
