function clerkCookieNamesToClear(cookieHeader: string | null): string[] {
  if (!cookieHeader) return [];
  const names = new Set<string>();
  for (const part of cookieHeader.split(";")) {
    const name = part.trim().split("=")[0];
    if (!name) continue;
    if (
      name === "__session" ||
      name.startsWith("__session_") ||
      name === "__client_uat" ||
      name.startsWith("__client_uat_") ||
      name.startsWith("__clerk")
    ) {
      names.add(name);
    }
  }
  return [...names];
}

function cookieDeleteDomainAttrs(host: string): string[] {
  if (!host || host === "localhost") return [""];
  const attrs: string[] = [];
  const labels = host.split(".").filter(Boolean);
  if (labels.length >= 3) {
    // Clerk client cookies on staging are scoped to the registrable domain
    // (e.g. Domain=.nyayagrid.com), not only the staging host.
    attrs.push(`; Domain=.${labels.slice(-2).join(".")}`);
  }
  attrs.push(`; Domain=.${host}`, `; Domain=${host}`, "");
  return [...new Set(attrs)];
}

/**
 * Clerk satellite cookies may be host-only or Domain-scoped, Lax or None, HttpOnly or not.
 * Max-Age=0 only deletes a cookie when the other attributes match, so sign-out emits the
 * combinations Clerk actually uses. Values are never copied.
 */
export function clerkCookieExpireSetCookieHeaders(
  cookieHeader: string | null,
  host: string,
): string[] {
  const names = clerkCookieNamesToClear(cookieHeader);
  const domainAttrs = cookieDeleteDomainAttrs(host);
  const headers: string[] = [];
  for (const name of names) {
    for (const domainAttr of domainAttrs) {
      headers.push(`${name}=; Path=/; Max-Age=0${domainAttr}`);
      headers.push(`${name}=; Path=/; Max-Age=0; Secure; SameSite=Lax${domainAttr}`);
      headers.push(`${name}=; Path=/; Max-Age=0; Secure; SameSite=Lax; HttpOnly${domainAttr}`);
      headers.push(`${name}=; Path=/; Max-Age=0; Secure; SameSite=None; HttpOnly${domainAttr}`);
    }
  }
  return headers;
}
