import {
  getMatterMotion,
  linkMatterMotionTarget,
  linkMotionDocument,
  listMatterMotionLinks,
  listMotionDocuments,
  updateMatterMotion,
} from "@nyayagrid/intelligence";
import { requireMatterAccess } from "@nyayagrid/permissions";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonOk } from "@/lib/http";

type Params = { params: Promise<{ matterId: string; motionId: string }> };

const patchSchema = z.object({
  motionType: z.string().optional(),
  title: z.string().optional(),
  summary: z.string().nullish(),
  status: z.string().optional(),
  filedAt: z.string().datetime().nullish(),
  servedAt: z.string().datetime().nullish(),
  oppositionDueAt: z.string().datetime().nullish(),
  oppositionFiledAt: z.string().datetime().nullish(),
  replyDueAt: z.string().datetime().nullish(),
  replyFiledAt: z.string().datetime().nullish(),
  hearingAt: z.string().datetime().nullish(),
  rulingAt: z.string().datetime().nullish(),
  disposition: z.string().nullish(),
  rulingSummary: z.string().nullish(),
  primaryDocumentId: z.string().uuid().nullish(),
  orderDocumentId: z.string().uuid().nullish(),
});

const linkSchema = z.object({
  linkType: z.string().min(1),
  targetId: z.string().uuid(),
  note: z.string().nullish(),
});

const documentLinkSchema = z.object({
  documentId: z.string().uuid(),
  role: z.string().min(1),
  sortOrder: z.number().int().optional(),
});

export async function GET(request: Request, { params }: Params) {
  try {
    const { matterId, motionId } = await params;
    const { db, user } = await requireUser(request.headers);
    const { matter } = await requireMatterAccess(db, {
      userId: user.id,
      matterId,
      minAccess: "read",
      capability: "matters.view",
    });
    const motion = await getMatterMotion(db, {
      userId: user.id,
      organizationId: matter.organizationId,
      matterId,
      motionId,
    });
    const [documents, links] = await Promise.all([
      listMotionDocuments(db, {
        userId: user.id,
        organizationId: matter.organizationId,
        matterId,
        motionId,
      }),
      listMatterMotionLinks(db, {
        userId: user.id,
        organizationId: matter.organizationId,
        matterId,
        motionId,
      }),
    ]);
    return jsonOk({ motion, documents, links });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const { matterId, motionId } = await params;
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
    const motion = await updateMatterMotion(db, {
      userId: user.id,
      organizationId: matter.organizationId,
      matterId,
      motionId,
      patch: {
        ...body,
        filedAt: toDate(body.filedAt),
        servedAt: toDate(body.servedAt),
        oppositionDueAt: toDate(body.oppositionDueAt),
        oppositionFiledAt: toDate(body.oppositionFiledAt),
        replyDueAt: toDate(body.replyDueAt),
        replyFiledAt: toDate(body.replyFiledAt),
        hearingAt: toDate(body.hearingAt),
        rulingAt: toDate(body.rulingAt),
      },
    });
    return jsonOk({ motion });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request, { params }: Params) {
  try {
    const { matterId, motionId } = await params;
    const { db, user } = await requireUser(request.headers);
    const { matter } = await requireMatterAccess(db, {
      userId: user.id,
      matterId,
      minAccess: "edit",
      capability: "matters.edit",
    });
    const url = new URL(request.url);
    const action = url.searchParams.get("action");
    if (action === "link-document") {
      const body = documentLinkSchema.parse(await request.json());
      const link = await linkMotionDocument(db, {
        userId: user.id,
        organizationId: matter.organizationId,
        matterId,
        motionId,
        documentId: body.documentId,
        role: body.role,
        sortOrder: body.sortOrder,
      });
      return jsonOk({ link }, { status: 201 });
    }
    const body = linkSchema.parse(await request.json());
    const link = await linkMatterMotionTarget(db, {
      userId: user.id,
      organizationId: matter.organizationId,
      matterId,
      motionId,
      linkType: body.linkType,
      targetId: body.targetId,
      note: body.note ?? null,
    });
    return jsonOk({ link }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
