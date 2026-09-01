import { listStudentBriefs } from "@nyayagrid/workspaces";
import { requireProfessorUser } from "@/lib/features";
import { handleRouteError, jsonOk } from "@/lib/http";

export async function GET(request: Request) {
  try {
    const { db, user } = await requireProfessorUser(request.headers);
    const briefs = await listStudentBriefs(db, user.id);
    return jsonOk({ briefs });
  } catch (error) {
    return handleRouteError(error);
  }
}
