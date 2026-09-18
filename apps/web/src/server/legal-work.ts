import {
  createLegalWorkEngine,
  restoreCapability,
  restoreLegalWorkVersion,
  roleFromAccess,
  snapshotIfNeeded,
  type LegalWorkObjectType,
  type LegalWorkRole,
} from "@nyayagrid/intelligence";
import { requireMatterAccess } from "@nyayagrid/permissions";
import type { Database } from "@nyayagrid/database";

export async function requireLegalWorkAccess(params: {
  db: Database;
  userId: string;
  matterId: string;
  objectType: LegalWorkObjectType;
  mode: "view" | "restore" | "bulk";
}): Promise<{
  organizationId: string;
  role: LegalWorkRole;
}> {
  const minAccess = params.mode === "view" ? "read" : params.mode === "bulk" ? "edit" : "edit";
  const capability =
    params.mode === "view" ? "matters.view" : restoreCapability(params.objectType);
  const { matter, access, membership } = await requireMatterAccess(params.db, {
    userId: params.userId,
    matterId: params.matterId,
    minAccess,
    capability,
  });
  return {
    organizationId: matter.organizationId,
    role: roleFromAccess({ access, capabilities: membership.capabilities }),
  };
}

export function workSessionId(request: Request): string | undefined {
  const header = request.headers.get("x-nyaya-work-session-id")?.trim();
  return header || undefined;
}

export {
  createLegalWorkEngine,
  restoreLegalWorkVersion,
  snapshotIfNeeded,
};
