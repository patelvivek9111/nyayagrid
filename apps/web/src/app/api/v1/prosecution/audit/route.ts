import { z } from "zod";
import { listProsecutionOfficeAuditEvents } from "@nyayagrid/intelligence";
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
    const pageRaw = url.searchParams.get("page");
    const pageSizeRaw = url.searchParams.get("pageSize");
    const result = await listProsecutionOfficeAuditEvents(db, {
      userId: user.id,
      organizationId,
      page: pageRaw ? Number(pageRaw) : undefined,
      pageSize: pageSizeRaw ? Number(pageSizeRaw) : undefined,
      action: url.searchParams.get("action"),
      targetType: url.searchParams.get("targetType"),
      targetId: url.searchParams.get("targetId"),
    });
    return jsonOk(result);
  } catch (error) {
    return handleRouteError(error);
  }
}
