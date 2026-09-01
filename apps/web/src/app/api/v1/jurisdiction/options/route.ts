import { forumTypeSchema } from "@nyayagrid/validation";
import { circuitShortName, listCourts, listUsStates } from "@nyayagrid/jurisdiction";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonError, jsonOk } from "@/lib/http";
import { requireCapability } from "@nyayagrid/permissions";
import { z } from "zod";

const querySchema = z.object({
  organizationId: z.string().uuid(),
  state: z.string().trim().max(40).optional(),
  forumType: forumTypeSchema.optional(),
});

export async function GET(request: Request) {
  try {
    const { db, user } = await requireUser(request.headers);
    const url = new URL(request.url);
    const parsed = querySchema.parse({
      organizationId: url.searchParams.get("organizationId") ?? undefined,
      state: url.searchParams.get("state") ?? undefined,
      forumType: url.searchParams.get("forumType") ?? undefined,
    });
    await requireCapability(db, {
      userId: user.id,
      organizationId: parsed.organizationId,
      capability: "matters.view",
    });
    const states = listUsStates().map((state) => ({
      code: state.code,
      name: state.name,
    }));
    const courts = listCourts({
      state: parsed.state,
      forumType: parsed.forumType,
    }).map((court) => ({
      id: court.id,
      name: court.name,
      shortName: court.shortName,
      jurisdictionType: court.jurisdictionType,
      state: court.state,
      level: court.level,
      federalCircuit: court.federalCircuit,
      federalCircuitLabel: circuitShortName(court.federalCircuit),
    }));
    return jsonOk({ states, courts });
  } catch (error) {
    if (error instanceof z.ZodError) return jsonError("VALIDATION_ERROR", "Invalid request", 400);
    return handleRouteError(error);
  }
}
