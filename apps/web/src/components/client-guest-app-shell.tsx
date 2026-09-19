"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useActiveOrganization } from "@/components/use-active-organization";
import { useOrgCapability } from "@/components/use-org-capability";
import { GlobalSidebar } from "@/components/ux";
import { isClientGuestRole } from "@/lib/first-run";

/**
 * Client guests are portal-only. Keep them out of the professional chrome so a
 * /app link never flashes firm navigation before redirecting to /portal.
 */
export function ClientGuestAppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { organizationId, loading: orgLoading } = useActiveOrganization();
  const viewCap = useOrgCapability(organizationId, "matters.view");

  const roleReady = !orgLoading && (!organizationId || !viewCap.loading);
  const isGuest = isClientGuestRole(viewCap.roleKey);

  useEffect(() => {
    if (!roleReady) return;
    if (isGuest) router.replace("/portal");
  }, [roleReady, isGuest, router]);

  if (!roleReady) {
    return (
      <div className="flex min-h-screen items-center justify-center px-6">
        <p className="text-sm text-ink/60">Loading workspace…</p>
      </div>
    );
  }

  if (isGuest) {
    return (
      <div className="flex min-h-screen items-center justify-center px-6">
        <p className="text-sm text-ink/60">Opening your client portal…</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen">
      <GlobalSidebar />
      <main className="min-w-0 flex-1 px-4 pb-10 pt-14 lg:px-8 lg:pt-8">{children}</main>
    </div>
  );
}
