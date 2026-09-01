import { requireUser } from "@/lib/auth";
import { handleRouteError, jsonError, jsonOk } from "@/lib/http";
import {
  isCertificationSubsystem,
  listValidatedRoutingOptions,
  type CertificationSubsystem,
} from "@nyayagrid/ai";

export async function GET(request: Request): Promise<Response> {
  try {
    await requireUser(request.headers);
    const url = new URL(request.url);
    const subsystem = url.searchParams.get("subsystem") ?? "ask";
    if (!isCertificationSubsystem(subsystem)) {
      return jsonError("VALIDATION_ERROR", "Unknown subsystem", 400);
    }
    return jsonOk(listValidatedRoutingOptions({ subsystem: subsystem as CertificationSubsystem }));
  } catch (error) {
    return handleRouteError(error);
  }
}
