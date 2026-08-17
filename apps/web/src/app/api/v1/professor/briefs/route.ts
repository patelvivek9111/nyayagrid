import { listStudentBriefs } from "@nyayagrid/workspaces";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonOk } from "@/lib/http";

export async function GET(request: Request) {
  try {
    const { db, user } = await requireUser(request.headers);
    const briefs = await listStudentBriefs(db, user.id);
    return jsonOk({ briefs });
  } catch (error) {
    return handleRouteError(error);
  }
}
