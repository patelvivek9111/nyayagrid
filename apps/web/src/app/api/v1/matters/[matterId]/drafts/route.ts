import { createDraftSchema, generateDraftSchema } from "@nyayagrid/validation";
import { requireMatterAccess } from "@nyayagrid/permissions";
import { createDraft, generateDraft, listDrafts } from "@nyayagrid/intelligence";
import { MockAIProvider } from "@nyayagrid/ai";
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
    const drafts = await listDrafts({ db, organizationId: matter.organizationId, matterId });
    return jsonOk({ drafts });
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
      capability: "drafts.create",
    });
    const json = await request.json();

    if (json?.action === "generate" || json?.generate === true) {
      const body = generateDraftSchema.parse(json);
      const result = await generateDraft({
        db,
        organizationId: matter.organizationId,
        matterId,
        userId: user.id,
        title: body.title,
        draftType: body.draftType,
        instructions: body.instructions,
        documentIds: body.documentIds,
        ai: process.env.AI_PROVIDER === "openai" ? undefined : new MockAIProvider(),
        executionStrategy: body.executionStrategy,
        modelId: body.modelId,
      });
      return jsonOk(result, { status: 201 });
    }

    const body = createDraftSchema.parse(json);
    const result = await createDraft({
      db,
      organizationId: matter.organizationId,
      matterId,
      userId: user.id,
      title: body.title,
      draftType: body.draftType,
      content: body.content,
    });
    return jsonOk(result, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
