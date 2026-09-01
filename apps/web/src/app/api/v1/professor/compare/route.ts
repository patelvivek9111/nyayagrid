import { compareCasesSchema } from "@nyayagrid/validation";
import { compareStudentCases } from "@nyayagrid/workspaces";
import { requireProfessorUser } from "@/lib/features";
import { handleRouteError, jsonOk } from "@/lib/http";
import { getAI } from "@/lib/infra";

export async function POST(request: Request) {
  try {
    const { db, user } = await requireProfessorUser(request.headers);
    const body = compareCasesSchema.parse(await request.json());

    const result = await compareStudentCases({
      db,
      userId: user.id,
      caseAId: body.caseAId,
      caseBId: body.caseBId,
      explanationLevel: body.explanationLevel,
      ai: getAI(),
    });

    return jsonOk({
      record: result.record,
      comparison: result.comparison,
      sources: result.sources,
      validation: result.validation,
      provider: result.provider,
      model: result.model,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
