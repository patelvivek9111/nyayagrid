import { desc, eq, guideSituations } from "@nyayagrid/database";
import { createGuideSituationSchema } from "@nyayagrid/validation";
import { createSituation } from "@nyayagrid/workspaces";
import { requireGuideUser } from "@/lib/features";
import { handleRouteError, jsonOk } from "@/lib/http";

export async function GET(request: Request) {
  try {
    const { db, user } = await requireGuideUser(request.headers);
    const situations = await db
      .select()
      .from(guideSituations)
      .where(eq(guideSituations.userId, user.id))
      .orderBy(desc(guideSituations.updatedAt));
    return jsonOk({ situations });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request) {
  try {
    const { db, user } = await requireGuideUser(request.headers);
    const body = createGuideSituationSchema.parse(await request.json());
    const situation = await createSituation(db, user.id, body);
    return jsonOk({ situation }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
