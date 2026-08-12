import { transformDraftSchema } from "@nyayagrid/validation";
import { requireMatterAccess } from "@nyayagrid/permissions";
import { transformDraftSection } from "@nyayagrid/intelligence";
import { MockAIProvider } from "@nyayagrid/ai";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonOk } from "@/lib/http";

type Params = { params: Promise<{ matterId: string; draftId: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const { matterId, draftId } = await params;
    const { db, user } = await requireUser(request.headers);
    const { matter } = await requireMatterAccess(db, {
      userId: user.id,
      matterId,
      minAccess: "edit",
      capability: "drafts.create",
    });
    const body = transformDraftSchema.parse(await request.json());
    const sectionHint = [body.sectionHint, body.toneHint ? `tone: ${body.toneHint}` : null]
      .filter(Boolean)
      .join("; ");

    const version = await transformDraftSection({
      db,
      organizationId: matter.organizationId,
      matterId,
      draftId,
      userId: user.id,
      action: body.action,
      sectionHint: sectionHint || undefined,
      ai: process.env.AI_PROVIDER === "openai" ? undefined : new MockAIProvider(),
    });
    return jsonOk({ version }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
