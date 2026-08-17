import { challengeBriefSectionSchema } from "@nyayagrid/validation";
import { createStudentNote, getCaseBrief } from "@nyayagrid/workspaces";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonError, jsonOk } from "@/lib/http";

type Params = { params: Promise<{ caseId: string }> };

/**
 * Flag a generated brief section as not matching the passage. Does not overwrite the validated brief.
 */
export async function POST(request: Request, { params }: Params) {
  try {
    const { caseId } = await params;
    const { db, user } = await requireUser(request.headers);
    const body = challengeBriefSectionSchema.parse(await request.json());
    const brief = await getCaseBrief(db, user.id, caseId);
    if (!brief) {
      return jsonError("VALIDATION_ERROR", "Generate a brief before challenging a section.", 400);
    }

    const note = await createStudentNote({
      db,
      userId: user.id,
      input: {
        title: `Challenge: ${body.sectionKey}`,
        content: body.note,
        caseId,
        briefId: brief.id,
        kind: "brief_challenge",
        sectionKey: body.sectionKey,
      },
    });
    return jsonOk({ note }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
