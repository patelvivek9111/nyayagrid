import { getFeatureFlags } from "@nyayagrid/platform";
import { jsonOk } from "@/lib/http";

/** Public deployment flags for UI hiding. Not an authorization decision. */
export async function GET() {
  return jsonOk({ flags: getFeatureFlags() });
}
