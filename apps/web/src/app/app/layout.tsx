"use client";

import { ActiveOrganizationProvider } from "@/components/use-active-organization";
import { ClerkSessionKeepAlive } from "@/components/clerk-session-keep-alive";
import { ClientGuestAppShell } from "@/components/client-guest-app-shell";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <ActiveOrganizationProvider>
      <ClerkSessionKeepAlive />
      <ClientGuestAppShell>{children}</ClientGuestAppShell>
    </ActiveOrganizationProvider>
  );
}
