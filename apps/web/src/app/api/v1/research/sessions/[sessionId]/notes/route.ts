import { createResearchNoteSchema } from "@nyayagrid/validation";
import { requireAnyCapability } from "@nyayagrid/permissions";
import { createResearchNote, getResearchSession, listResearchNotes } from "@nyayagrid/research";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonError, jsonOk } from "@/lib/http";

const RESEARCH_CAPABILITIES = ["research.run", "matters.view"] as const;

type Params = { params: Promise<{ sessionId: string }> };

export async function GET(request: Request, { params }: Params) {
  try {
    const { sessionId } = await params;
    const { db, user } = await requireUser(request.headers);
    const url = new URL(request.url);
    const organizationId = url.searchParams.get("organizationId");
    if (!organizationId) {
      return jsonError("VALIDATION_ERROR", "organizationId is required", 400);
    }
    await requireAnyCapability(db, {
      userId: user.id,
      organizationId,
      capabilities: [...RESEARCH_CAPABILITIES],
    });
    const session = await getResearchSession({ db, organizationId, sessionId });
    if (!session) return jsonError("NOT_FOUND", "Research session not found", 404);
    const notes = await listResearchNotes({ db, organizationId, sessionId });
    return jsonOk({ notes });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request, { params }: Params) {
  try {
    const { sessionId } = await params;
    const { db, user } = await requireUser(request.headers);
    const body = createResearchNoteSchema.parse(await request.json());
    const url = new URL(request.url);
    const organizationId = body.organizationId ?? url.searchParams.get("organizationId");
    if (!organizationId) {
      return jsonError("VALIDATION_ERROR", "organizationId is required", 400);
    }
    await requireAnyCapability(db, {
      userId: user.id,
      organizationId,
      capabilities: [...RESEARCH_CAPABILITIES],
    });
    const session = await getResearchSession({ db, organizationId, sessionId });
    if (!session) return jsonError("NOT_FOUND", "Research session not found", 404);
    const note = await createResearchNote({
      db,
      organizationId,
      sessionId: session.id,
      matterId: session.matterId,
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
