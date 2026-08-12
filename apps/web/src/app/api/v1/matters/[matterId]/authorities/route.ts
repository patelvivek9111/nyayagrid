import { saveMatterAuthoritySchema } from "@nyayagrid/validation";
import { requireMatterAccess } from "@nyayagrid/permissions";
import {
  listMatterAuthorities,
  saveAuthorityToMatter,
  type MatterAuthorityStatus,
} from "@nyayagrid/research";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonOk } from "@/lib/http";

const VALID_STATUSES = new Set<MatterAuthorityStatus>([
  "saved",
  "key_authority",
  "rejected",
  "not_relevant",
]);

type Params = { params: Promise<{ matterId: string }> };

export async function GET(request: Request, { params }: Params) {
  try {
    const { matterId } = await params;
    const { db, user } = await requireUser(request.headers);
    const { matter } = await requireMatterAccess(db, {
      userId: user.id,
      matterId,
      minAccess: "read",
      capability: "matters.view",
    });
    const url = new URL(request.url);
    const statusParam = url.searchParams.get("status");
    const statuses = statusParam
      ?.split(",")
      .map((s) => s.trim())
      .filter((s): s is MatterAuthorityStatus => VALID_STATUSES.has(s as MatterAuthorityStatus));
    const authorities = await listMatterAuthorities({
      db,
      organizationId: matter.organizationId,
      matterId,
      statuses: statuses?.length ? statuses : undefined,
    });
    return jsonOk({ authorities });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request, { params }: Params) {
  try {
    const { matterId } = await params;
    const { db, user } = await requireUser(request.headers);
    const { matter } = await requireMatterAccess(db, {
      userId: user.id,
      matterId,
      minAccess: "edit",
      capability: "research.run",
    });
    const body = saveMatterAuthoritySchema.parse(await request.json());
    const matterAuthority = await saveAuthorityToMatter({
      db,
      organizationId: matter.organizationId,
      matterId,
      authorityId: body.authorityId,
      userId: user.id,
      status: body.status,
      relevanceNote: body.relevanceNote,
    });
    return jsonOk({ matterAuthority }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
