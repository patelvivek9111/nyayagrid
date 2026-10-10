import {
  getMatterCommunication,
  linkMatterCommunicationTarget,
  listMatterCommunicationLinks,
  updateMatterCommunication,
} from "@nyayagrid/intelligence";
import { requireMatterAccess } from "@nyayagrid/permissions";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonOk } from "@/lib/http";

type Params = { params: Promise<{ matterId: string; communicationId: string }> };

const patchSchema = z.object({
  communicationType: z.string().optional(),
  subject: z.string().optional(),
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

const linkSchema = z.object({
  linkType: z.string().min(1),
  targetId: z.string().uuid(),
  note: z.string().nullish(),
});

export async function GET(request: Request, { params }: Params) {
  try {
    const { matterId, communicationId } = await params;
    const { db, user } = await requireUser(request.headers);
    const { matter } = await requireMatterAccess(db, {
      userId: user.id,
      matterId,
      minAccess: "read",
      capability: "matters.view",
    });
    const communication = await getMatterCommunication(db, {
      userId: user.id,
      organizationId: matter.organizationId,
      matterId,
      communicationId,
    });
    const links = await listMatterCommunicationLinks(db, {
      userId: user.id,
      organizationId: matter.organizationId,
      matterId,
      communicationId,
    });
    return jsonOk({ communication, links });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const { matterId, communicationId } = await params;
    const { db, user } = await requireUser(request.headers);
    const { matter } = await requireMatterAccess(db, {
      userId: user.id,
      matterId,
      minAccess: "edit",
      capability: "matters.edit",
    });
    const body = patchSchema.parse(await request.json());
    const toDate = (value: string | null | undefined) =>
      value === undefined ? undefined : value === null ? null : new Date(value);
    const communication = await updateMatterCommunication(db, {
      userId: user.id,
      organizationId: matter.organizationId,
      matterId,
      communicationId,
      patch: {
        ...body,
        occurredAt: toDate(body.occurredAt),
        followUpDueAt: toDate(body.followUpDueAt),
      },
    });
    return jsonOk({ communication });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request, { params }: Params) {
  try {
    const { matterId, communicationId } = await params;
    const { db, user } = await requireUser(request.headers);
    const { matter } = await requireMatterAccess(db, {
      userId: user.id,
      matterId,
      minAccess: "edit",
      capability: "matters.edit",
    });
    const body = linkSchema.parse(await request.json());
    const link = await linkMatterCommunicationTarget(db, {
      userId: user.id,
      organizationId: matter.organizationId,
      matterId,
      communicationId,
      linkType: body.linkType,
      targetId: body.targetId,
      note: body.note ?? null,
    });
    return jsonOk({ link }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
