import { generateCaseBriefSchema } from "@nyayagrid/validation";
import { generateCaseBrief } from "@nyayagrid/workspaces";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonOk } from "@/lib/http";
import { getAI } from "@/lib/infra";

type Params = { params: Promise<{ caseId: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const { caseId } = await params;
    const { db, user } = await requireUser(request.headers);
    const body = generateCaseBriefSchema.parse(await request.json().catch(() => ({})));

    const result = await generateCaseBrief({
      db,
      userId: user.id,
      caseId,
      explanationLevel: body.explanationLevel,
      ai: getAI(),
    });

    return jsonOk({
      record: result.record,
      brief: result.brief,
      sectionSources: result.sectionSources,
      validation: result.validation,
      passageCount: result.passageCount,
      provider: result.provider,
      model: result.model,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
