import { z } from "zod";
import { createProsecutionCaseMemorySchema } from "@nyayagrid/validation";
import { createProsecutionCaseMemory, listProsecutionCaseMemories } from "@nyayagrid/intelligence";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonError, jsonOk } from "@/lib/http";

type Params = { params: Promise<{ caseId: string }> };

export async function GET(request: Request, { params }: Params) {
  try {
    const { caseId } = await params;
    const { db, user } = await requireUser(request.headers);
    const url = new URL(request.url);
    const organizationId = url.searchParams.get("organizationId");
    if (
      !organizationId ||
      !z.string().uuid().safeParse(organizationId).success ||
      !z.string().uuid().safeParse(caseId).success
    ) {
      return jsonError("VALIDATION_ERROR", "organizationId and caseId must be ids", 400);
    }
    const memories = await listProsecutionCaseMemories(db, {
      userId: user.id,
      organizationId,
      caseId,
      status: url.searchParams.get("status") ?? undefined,
    });
    return jsonOk({ memories });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request, { params }: Params) {
  try {
    const { caseId } = await params;
    const { db, user } = await requireUser(request.headers);
    if (!z.string().uuid().safeParse(caseId).success) {
      return jsonError("VALIDATION_ERROR", "caseId must be an id", 400);
    }
    const body = createProsecutionCaseMemorySchema.parse(await request.json());
    // AI-proposed entries must remain proposed — never verified facts on create.
    const origin = body.origin ?? "manual";
    const status = origin === "ai" ? "proposed" : body.status;
    const memory = await createProsecutionCaseMemory(db, {
      userId: user.id,
      organizationId: body.organizationId,
      caseId,
      memoryType: body.memoryType,
      content: body.content,
      evidenceItemId: body.evidenceItemId,
      origin,
      status,
      confidence: body.confidence,
      provenance: body.provenance,
      supersedesId: body.supersedesId,
    });
    return jsonOk({ memory }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
