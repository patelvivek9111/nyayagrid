import { eq } from "drizzle-orm";
import { users } from "@nyayagrid/database";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonOk } from "@/lib/http";

const patchProfileSchema = z.object({
  name: z.string().trim().min(1).max(120),
});

export async function GET(request: Request) {
  try {
    const { user } = await requireUser(request.headers);
    return jsonOk({
      name: user.name,
      email: user.email,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const { db, user } = await requireUser(request.headers);
    const body = patchProfileSchema.parse(await request.json());
    const [updated] = await db
      .update(users)
      .set({ name: body.name, updatedAt: new Date() })
      .where(eq(users.id, user.id))
      .returning({ name: users.name, email: users.email });
    return jsonOk({ name: updated?.name ?? body.name, email: updated?.email ?? user.email });
  } catch (error) {
    return handleRouteError(error);
  }
}
