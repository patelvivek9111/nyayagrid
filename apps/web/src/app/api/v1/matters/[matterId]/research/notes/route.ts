import { createResearchNoteSchema } from "@nyayagrid/validation";
import { requireMatterAccess } from "@nyayagrid/permissions";
import { createResearchNote, listResearchNotes } from "@nyayagrid/research";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonOk } from "@/lib/http";

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
    const notes = await listResearchNotes({ db, organizationId: matter.organizationId, matterId });
    return jsonOk({ notes });
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
    const body = createResearchNoteSchema.parse(await request.json());
    const note = await createResearchNote({
      db,
      organizationId: matter.organizationId,
      matterId,
      authorityId: body.authorityId,
      authorityChunkId: body.authorityChunkId,
      content: body.content,
      origin: "manual",
      userId: user.id,
    });
    return jsonOk({ note }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
