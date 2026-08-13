"use client";

import { ActiveOrganizationProvider } from "@/components/use-active-organization";
import { GlobalSidebar } from "@/components/ux";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <ActiveOrganizationProvider>
      <div className="flex min-h-screen">
        <GlobalSidebar />
        <main className="min-w-0 flex-1 px-4 pb-10 pt-14 lg:px-8 lg:pt-8">{children}</main>
      </div>
    </ActiveOrganizationProvider>
  );
}
