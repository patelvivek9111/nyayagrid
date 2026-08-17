import { exportUserPersonalData } from "@nyayagrid/platform";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonOk } from "@/lib/http";

export async function GET(request: Request) {
  try {
    const { db, user } = await requireUser(request.headers);
    const exported = await exportUserPersonalData({ db, userId: user.id });
    return jsonOk(exported);
  } catch (error) {
    return handleRouteError(error);
  }
}
