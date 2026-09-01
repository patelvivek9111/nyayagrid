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
 * Generic `/app` Ask is unsafe before a Case exists (Nyaya will not read files).
 * Returning users with Cases keep `/app`.
 */
export function genericAskRedirect(params: {
  organizationCount: number;
  caseCount: number;
  roleKey: string | null;
}): string | null {
  if (isClientGuestRole(params.roleKey)) return "/portal";
  if (params.organizationCount === 0) return "/app/onboarding";
  if (params.caseCount === 0) return "/app/cases";
  return null;
}

export function caseAskHref(matterId: string): string {
  return `/app/cases/${matterId}/chats`;
}

export function caseDocumentsHref(matterId: string): string {
  return `/app/cases/${matterId}/documents`;
}
