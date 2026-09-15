import { jsonOk } from "@/lib/http";
import { refreshClerkBrowserSession, sessionKeepAliveResponse } from "@/lib/clerk-session";

/**
 * Rotate a short-lived Clerk session JWT. Does not log cookies or tokens.
 * DevAuth is a no-op success so local development does not call Clerk.
 */
export async function GET(request: Request) {
  if ((process.env.AUTH_PROVIDER ?? "dev") !== "clerk") {
    return jsonOk({ ok: true, provider: "dev" });
  }
  const refresh = await refreshClerkBrowserSession(request.headers);
  return sessionKeepAliveResponse(refresh);
}
