import { detectDuplicatesSchema } from "@nyayagrid/validation";
import { requireMatterAccess } from "@nyayagrid/permissions";
import { detectExactDuplicates, detectNearDuplicates } from "@nyayagrid/intelligence";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonOk } from "@/lib/http";

type Params = { params: Promise<{ matterId: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const { matterId } = await params;
    const { db, user } = await requireUser(request.headers);
    const { matter } = await requireMatterAccess(db, {
      userId: user.id,
      matterId,
      minAccess: "edit",
      capability: "matters.edit",
    });
    const body = detectDuplicatesSchema.parse(await request.json().catch(() => ({})));
    const exact = await detectExactDuplicates({
      db,
      organizationId: matter.organizationId,
      matterId,
      userId: user.id,
    });
    const near = body.near
      ? await detectNearDuplicates({
          db,
          organizationId: matter.organizationId,
          matterId,
          userId: user.id,
        })
      : null;
    return jsonOk({ exact, near }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
