import { z } from "zod";
import { createCriminalCase, listCriminalCases } from "@nyayagrid/intelligence";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonError, jsonOk } from "@/lib/http";

const createSchema = z.object({
  organizationId: z.string().uuid(),
  caseNumber: z.string().trim().min(1).max(64),
  jurisdiction: z.string().trim().min(2).max(16),
  court: z.string().trim().min(1).max(80),
  courthouse: z.string().trim().max(200).nullable().optional(),
  caseStatus: z.string().trim().max(40).optional(),
  priority: z.string().trim().max(40).optional(),
  summary: z.string().max(20000).nullable().optional(),
  matterId: z.string().uuid().nullable().optional(),
});

export async function GET(request: Request) {
  try {
    const { db, user } = await requireUser(request.headers);
    const organizationId = new URL(request.url).searchParams.get("organizationId");
    if (!organizationId || !z.string().uuid().safeParse(organizationId).success) {
      return jsonError("VALIDATION_ERROR", "organizationId required", 400);
    }
    const cases = await listCriminalCases(db, { userId: user.id, organizationId });
    return jsonOk({ cases });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request) {
  try {
    const { db, user } = await requireUser(request.headers);
    const body = createSchema.parse(await request.json());
    const criminalCase = await createCriminalCase(db, { userId: user.id, ...body });
    return jsonOk({ criminalCase }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
