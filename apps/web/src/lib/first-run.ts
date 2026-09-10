/**
 * First-run navigation helpers. Derived from org/case/role — no onboarding table.
 * Does not create Cases, clients, or sample documents.
 */

export function slugFromFirmName(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "firm";
}

/** Safe for HTML `pattern` under Chrome unicodeSets (`v` flag). Hyphen must be escaped. */
export const ORGANIZATION_SLUG_HTML_PATTERN = "[a-z0-9\\-]+";

/** Lowercase URL slug while typing; drop characters the API will reject. */
export function normalizeOrganizationSlugInput(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 64);
}

export function isClientGuestRole(roleKey: string | null | undefined): boolean {
  return roleKey === "client_guest";
}

export function shouldSkipFirmCreation(organizationCount: number): boolean {
  return organizationCount > 0;
}

/** After the workspace is known, where should this user go next? */
export function continueHref(params: {
  organizationCount: number;
  caseCount: number;
  canCreateMatter: boolean;
  roleKey: string | null;
}): string {
  if (isClientGuestRole(params.roleKey)) return "/portal";
  if (params.organizationCount === 0) return "/app/onboarding";
  if (params.caseCount === 0) {
    return params.canCreateMatter ? "/app/cases/new" : "/app/cases";
  }
  return "/app/cases";
}

/**
 * `/app` is general Ask. A Case is optional context, not a prerequisite.
 * Only bounce users who cannot use the professional Ask surface.
 */
export function genericAskRedirect(params: {
  organizationCount: number;
  roleKey: string | null;
}): string | null {
  if (isClientGuestRole(params.roleKey)) return "/portal";
  if (params.organizationCount === 0) return "/app/onboarding";
  return null;
}

export function caseAskHref(matterId: string): string {
  return `/app/cases/${matterId}/chats`;
}

export function caseDocumentsHref(matterId: string): string {
  return `/app/cases/${matterId}/documents`;
}
