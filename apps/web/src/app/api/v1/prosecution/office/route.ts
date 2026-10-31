import { z } from "zod";
import {
  closeCriminalCase,
  getProsecutionOfficeOverview,
  recordSupervisorCaseReview,
  searchProsecutionOffice,
} from "@nyayagrid/intelligence";
import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonError, jsonOk } from "@/lib/http";

export async function GET(request: Request) {
  try {
    const { db, user } = await requireUser(request.headers);
    const url = new URL(request.url);
    const organizationId = url.searchParams.get("organizationId");
    if (!organizationId || !z.string().uuid().safeParse(organizationId).success) {
      return jsonError("VALIDATION_ERROR", "organizationId required", 400);
    }
    const mode = url.searchParams.get("mode") ?? "overview";
    if (mode === "search") {
      const query = url.searchParams.get("q") ?? "";
      const results = await searchProsecutionOffice(db, {
        userId: user.id,
        organizationId,
        query,
        limit: Number(url.searchParams.get("limit") ?? 25),
      });
      return jsonOk(results);
    }
    const overview = await getProsecutionOfficeOverview(db, {
      userId: user.id,
      organizationId,
      page: Number(url.searchParams.get("page") ?? 1),
      pageSize: Number(url.searchParams.get("pageSize") ?? 25),
      query: url.searchParams.get("q") ?? undefined,
      status: url.searchParams.get("status") ?? undefined,
      priority: url.searchParams.get("priority") ?? undefined,
      prosecutorId: url.searchParams.get("prosecutorId") ?? undefined,
      unassignedOnly: url.searchParams.get("unassignedOnly") === "1",
    });
    return jsonOk({ overview });
  } catch (error) {
    return handleRouteError(error);
  }
}

const postSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("close_case"),
    organizationId: z.string().uuid(),
    caseId: z.string().uuid(),
    confirm: z.literal(true),
    closedDate: z.string().trim().max(40).nullable().optional(),
    closureReason: z.string().trim().max(4000).nullable().optional(),
  }),
  z.object({
    action: z.literal("supervisor_review"),
    organizationId: z.string().uuid(),
    caseId: z.string().uuid(),
    note: z.string().trim().max(8000).nullable().optional(),
    followUpRequested: z.boolean().optional(),
    followUpTaskTitle: z.string().trim().max(500).nullable().optional(),
  }),
]);

export async function POST(request: Request) {
  try {
    const { db, user } = await requireUser(request.headers);
    const body = postSchema.parse(await request.json());
    if (body.action === "close_case") {
      const closed = await closeCriminalCase(db, {
        userId: user.id,
        organizationId: body.organizationId,
        caseId: body.caseId,
        confirm: body.confirm,
        closedDate: body.closedDate,
        closureReason: body.closureReason,
      });
      return jsonOk({ case: closed });
    }
    const review = await recordSupervisorCaseReview(db, {
      userId: user.id,
      organizationId: body.organizationId,
      caseId: body.caseId,
      note: body.note,
      followUpRequested: body.followUpRequested,
      followUpTaskTitle: body.followUpTaskTitle,
    });
    return jsonOk({ review }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
