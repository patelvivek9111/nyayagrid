import {
  createMatterMemorySchema,
  proposeMatterMemorySchema,
  supersedeMatterMemorySchema,
} from "@nyayagrid/validation";
import { requireMatterAccess } from "@nyayagrid/permissions";
import {
  createMatterMemory,
  listMatterMemories,
  proposeMatterMemories,
  supersedeMatterMemory,
} from "@nyayagrid/intelligence";
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
    const url = new URL(request.url);
    const memories = await listMatterMemories({
      db,
      organizationId: matter.organizationId,
      matterId,
      status: url.searchParams.get("status") ?? undefined,
    });
    return jsonOk({ memories });
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
      capability: "timeline.manage",
    });
    const json = await request.json();
    if (json?.action === "propose") {
      const body = proposeMatterMemorySchema.parse({
        question: json.question,
        hint: json.hint,
      });
      const result = await proposeMatterMemories({
        db,
        organizationId: matter.organizationId,
        matterId,
        matterTitle: matter.title,
        userId: user.id,
        question: body.question,
        hint: body.hint,
        ai: process.env.AI_PROVIDER === "openai" ? undefined : new MockAIProvider(),
      });
      if ((result.proposals?.length ?? 0) === 0 && body.hint?.trim()) {
        const memory = await createMatterMemory({
          db,
          organizationId: matter.organizationId,
          matterId,
          userId: user.id,
          memoryType: "verified_context",
          title: body.hint.trim().slice(0, 80),
          content: body.hint.trim(),
          importance: "normal",
          origin: "ai",
          status: "proposed",
          sourceType: "ai_proposal",
          sourceReference: {
            rationale: "Recorded from the attorney hint so the suggestion can be reviewed.",
          },
        });
        return jsonOk({ ...result, proposals: [memory] }, { status: 201 });
      }
      return jsonOk(result, { status: 201 });
    }
    if (json?.oldMemoryId) {
      const body = supersedeMatterMemorySchema.parse(json);
      const memory = await supersedeMatterMemory({
        db,
        organizationId: matter.organizationId,
        matterId,
        userId: user.id,
        ...body,
      });
      return jsonOk({ memory }, { status: 201 });
    }
    const body = createMatterMemorySchema.parse(json);
    const memory = await createMatterMemory({
      db,
      organizationId: matter.organizationId,
      matterId,
      userId: user.id,
      origin: "manual",
      status: "approved",
      ...body,
    });
    return jsonOk({ memory }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
