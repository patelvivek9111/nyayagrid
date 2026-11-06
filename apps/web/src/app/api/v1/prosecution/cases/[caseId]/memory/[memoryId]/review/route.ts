import { z } from "zod";
import { reviewProsecutionCaseMemorySchema } from "@nyayagrid/validation";
import { reviewProsecutionCaseMemory } from "@nyayagrid/intelligence";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonError, jsonOk } from "@/lib/http";

type Params = { params: Promise<{ caseId: string; memoryId: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const { caseId, memoryId } = await params;
    const { db, user } = await requireUser(request.headers);
    if (
      !z.string().uuid().safeParse(caseId).success ||
      !z.string().uuid().safeParse(memoryId).success
    ) {
      return jsonError("VALIDATION_ERROR", "caseId and memoryId must be ids", 400);
    }
    const body = reviewProsecutionCaseMemorySchema.parse(await request.json());
    const memory = await reviewProsecutionCaseMemory(db, {
      userId: user.id,
      organizationId: body.organizationId,
      caseId,
      memoryId,
      action: body.action,
      content: body.content,
      memoryType: body.memoryType,
      evidenceItemId: body.evidenceItemId,
      rejectionReason: body.rejectionReason,
      provenance: body.provenance,
    });
    return jsonOk({ memory });
  } catch (error) {
    return handleRouteError(error);
  }
}
