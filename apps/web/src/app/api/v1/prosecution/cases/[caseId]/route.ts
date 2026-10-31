import { z } from "zod";
import { getProsecutionOverview, updateCriminalCase } from "@nyayagrid/intelligence";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonError, jsonOk } from "@/lib/http";

const patchSchema = z.object({
  organizationId: z.string().uuid(),
  caseNumber: z.string().trim().min(1).max(120).optional(),
  caseStatus: z.string().trim().min(1).max(40).optional(),
  jurisdiction: z.string().trim().min(2).max(16).optional(),
  court: z.string().trim().min(1).max(200).optional(),
  courthouse: z.string().trim().max(200).nullable().optional(),
  priority: z.string().trim().min(1).max(40).optional(),
  summary: z.string().trim().max(8000).nullable().optional(),
  notes: z.string().trim().max(8000).nullable().optional(),
  assignedProsecutorId: z.string().uuid().nullable().optional(),
  supervisingProsecutorId: z.string().uuid().nullable().optional(),
  investigatingAgencyId: z.string().uuid().nullable().optional(),
  assignmentNote: z.string().trim().max(4000).nullable().optional(),
  closedDate: z.string().trim().max(40).nullable().optional(),
  closureReason: z.string().trim().max(4000).nullable().optional(),
});

export async function GET(request: Request, context: { params: Promise<{ caseId: string }> }) {
  try {
    const { db, user } = await requireUser(request.headers);
    const { caseId } = await context.params;
    const organizationId = new URL(request.url).searchParams.get("organizationId");
    if (
      !organizationId ||
      !z.string().uuid().safeParse(organizationId).success ||
      !z.string().uuid().safeParse(caseId).success
    ) {
      return jsonError("VALIDATION_ERROR", "organizationId and caseId must be ids", 400);
    }
    const overview = await getProsecutionOverview(db, { userId: user.id, organizationId, caseId });
    return jsonOk({ overview });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ caseId: string }> }) {
  try {
    const { db, user } = await requireUser(request.headers);
    const { caseId } = await context.params;
    if (!z.string().uuid().safeParse(caseId).success) {
      return jsonError("VALIDATION_ERROR", "caseId must be an id", 400);
    }
    const body = patchSchema.parse(await request.json());
    const { organizationId, ...patch } = body;
    const updated = await updateCriminalCase(db, {
      userId: user.id,
      organizationId,
      caseId,
      patch,
    });
    return jsonOk({ case: updated });
  } catch (error) {
    return handleRouteError(error);
  }
}
