import { updateStudentCaseSchema } from "@nyayagrid/validation";
import {
  getCaseBrief,
  getLatestStudentCaseVersion,
  getStudentCase,
  listStudentNotes,
  loadStudentCasePassages,
  StudentAccessError,
  updateStudentCaseCourseLabel,
} from "@nyayagrid/workspaces";
import { requireProfessorUser } from "@/lib/features";
import { handleRouteError, jsonOk } from "@/lib/http";

type Params = { params: Promise<{ caseId: string }> };

export async function GET(request: Request, { params }: Params) {
  try {
    const { caseId } = await params;
    const { db, user } = await requireProfessorUser(request.headers);
    const studentCase = await getStudentCase(db, user.id, caseId);

    let version = null;
    let passages: Awaited<ReturnType<typeof loadStudentCasePassages>> = [];
    if (studentCase.processingState === "ready") {
      try {
        version = await getLatestStudentCaseVersion(db, user.id, caseId);
        passages = await loadStudentCasePassages({
          db,
          userId: user.id,
          caseVersionId: version.id,
        });
      } catch (error) {
        if (!(error instanceof StudentAccessError)) throw error;
      }
    }

    const brief = await getCaseBrief(db, user.id, caseId);
    const notes = await listStudentNotes({ db, userId: user.id, caseId });
    return jsonOk({ case: studentCase, version, passages, brief, notes });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const { caseId } = await params;
    const { db, user } = await requireProfessorUser(request.headers);
    const body = updateStudentCaseSchema.parse(await request.json());
    const studentCase = await updateStudentCaseCourseLabel({
      db,
      userId: user.id,
      caseId,
      courseLabel: body.courseLabel ?? null,
    });
    return jsonOk({ case: studentCase });
  } catch (error) {
    return handleRouteError(error);
  }
}
