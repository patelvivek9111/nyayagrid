import { z } from "zod";
import {
  provisionProsecutionRolesAsAdmin,
  reconcileProfessionalRolesAsAdmin,
} from "@nyayagrid/intelligence";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonOk } from "@/lib/http";

type Params = { params: Promise<{ organizationId: string }> };

const postSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("provision_prosecution"),
  }),
  z.object({
    action: z.literal("reconcile_professional"),
    mode: z.enum(["additive", "strict"]).optional(),
  }),
]);

/**
 * Explicit administrative path for system-role provisioning / reconciliation.
 * Requires organization.manage (enforced inside the intelligence helpers).
 * Never invoked by audit GET or other read paths.
 */
export async function POST(request: Request, { params }: Params) {
  try {
    const { organizationId } = await params;
    const { db, user } = await requireUser(request.headers);
    const body = postSchema.parse(await request.json());
    if (body.action === "provision_prosecution") {
      const result = await provisionProsecutionRolesAsAdmin(db, {
        userId: user.id,
        organizationId,
      });
      return jsonOk({ result });
    }
    const result = await reconcileProfessionalRolesAsAdmin(db, {
      userId: user.id,
      organizationId,
      mode: body.mode,
    });
    return jsonOk({ result });
  } catch (error) {
    return handleRouteError(error);
  }
}
