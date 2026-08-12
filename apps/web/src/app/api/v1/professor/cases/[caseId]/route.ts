import {
  getCaseBrief,
  getLatestStudentCaseVersion,
  getStudentCase,
  loadStudentCasePassages,
} from "@nyayagrid/workspaces";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonOk } from "@/lib/http";

type Params = { params: Promise<{ caseId: string }> };

export async function GET(request: Request, { params }: Params) {
  try {
    const { caseId } = await params;
    const { db, user } = await requireUser(request.headers);
    const studentCase = await getStudentCase(db, user.id, caseId);
    const version = await getLatestStudentCaseVersion(db, user.id, caseId);
    const passages = await loadStudentCasePassages({
      db,
      userId: user.id,
      caseVersionId: version.id,
    });
    const brief = await getCaseBrief(db, user.id, caseId);
    return jsonOk({ case: studentCase, version, passages, brief });
  } catch (error) {
    return handleRouteError(error);
  }
}
