import {
  createMatterMotion,
  listMatterMotions,
  loadMatterMotionsCommunicationsReview,
} from "@nyayagrid/intelligence";
import { requireMatterAccess } from "@nyayagrid/permissions";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonOk } from "@/lib/http";

type Params = { params: Promise<{ matterId: string }> };

const createSchema = z.object({
  motionType: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().nullish(),
  status: z.string().optional(),
  movingPartyEntityId: z.string().uuid().nullish(),
  opposingPartyEntityId: z.string().uuid().nullish(),
  filedAt: z.string().datetime().nullish(),
  servedAt: z.string().datetime().nullish(),
  oppositionDueAt: z.string().datetime().nullish(),
  replyDueAt: z.string().datetime().nullish(),
  hearingAt: z.string().datetime().nullish(),
  disposition: z.string().nullish(),
  rulingSummary: z.string().nullish(),
  primaryDocumentId: z.string().uuid().nullish(),
  orderDocumentId: z.string().uuid().nullish(),
});

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
    const review = await loadMatterMotionsCommunicationsReview(db, {
      userId: user.id,
      organizationId: matter.organizationId,
      matterId,
    });
    const motions = await listMatterMotions(db, {
      userId: user.id,
      organizationId: matter.organizationId,
      matterId,
    });
    return jsonOk({
      motions,
      motionLinks: review.motionLinks,
      motionDocuments: review.motionDocuments,
    });
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
      capability: "matters.edit",
    });
    const body = createSchema.parse(await request.json());
    const motion = await createMatterMotion(db, {
      userId: user.id,
      organizationId: matter.organizationId,
      matterId,
      motionType: body.motionType,
      title: body.title,
      summary: body.summary ?? null,
      status: body.status,
      movingPartyEntityId: body.movingPartyEntityId ?? null,
      opposingPartyEntityId: body.opposingPartyEntityId ?? null,
      filedAt: body.filedAt ? new Date(body.filedAt) : null,
      servedAt: body.servedAt ? new Date(body.servedAt) : null,
      oppositionDueAt: body.oppositionDueAt ? new Date(body.oppositionDueAt) : null,
      replyDueAt: body.replyDueAt ? new Date(body.replyDueAt) : null,
      hearingAt: body.hearingAt ? new Date(body.hearingAt) : null,
      disposition: body.disposition ?? null,
      rulingSummary: body.rulingSummary ?? null,
      primaryDocumentId: body.primaryDocumentId ?? null,
      orderDocumentId: body.orderDocumentId ?? null,
    });
    return jsonOk({ motion }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
