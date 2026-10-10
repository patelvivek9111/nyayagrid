import {
  createMatterCommunication,
  listMatterCommunications,
  loadMatterMotionsCommunicationsReview,
} from "@nyayagrid/intelligence";
import { requireMatterAccess } from "@nyayagrid/permissions";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonOk } from "@/lib/http";

type Params = { params: Promise<{ matterId: string }> };

const createSchema = z.object({
  communicationType: z.string().min(1),
  subject: z.string().min(1),
  summary: z.string().nullish(),
  direction: z.string().optional(),
  status: z.string().optional(),
  occurredAt: z.string().datetime().nullish(),
  senderEntityId: z.string().uuid().nullish(),
  recipientEntityId: z.string().uuid().nullish(),
  primaryDocumentId: z.string().uuid().nullish(),
  followUpNeeded: z.boolean().optional(),
  followUpDueAt: z.string().datetime().nullish(),
  followUpTaskId: z.string().uuid().nullish(),
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
    const communications = await listMatterCommunications(db, {
      userId: user.id,
      organizationId: matter.organizationId,
      matterId,
    });
    return jsonOk({
      communications,
      communicationLinks: review.communicationLinks,
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
    const communication = await createMatterCommunication(db, {
      userId: user.id,
      organizationId: matter.organizationId,
      matterId,
      communicationType: body.communicationType,
      subject: body.subject,
      summary: body.summary ?? null,
      direction: body.direction,
      status: body.status,
      occurredAt: body.occurredAt ? new Date(body.occurredAt) : null,
      senderEntityId: body.senderEntityId ?? null,
      recipientEntityId: body.recipientEntityId ?? null,
      primaryDocumentId: body.primaryDocumentId ?? null,
      followUpNeeded: body.followUpNeeded,
      followUpDueAt: body.followUpDueAt ? new Date(body.followUpDueAt) : null,
      followUpTaskId: body.followUpTaskId ?? null,
    });
    return jsonOk({ communication }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
