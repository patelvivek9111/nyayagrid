"use client";

import { use } from "react";
import { MatterChromeProvider } from "@/components/use-matter-chrome";
import { CaseWorkspaceChrome } from "@/components/ux";

export default function CaseLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ matterId: string }>;
}) {
  const { matterId } = use(params);
  return (
    <MatterChromeProvider matterId={matterId}>
      <div className="mx-auto max-w-5xl">
        <CaseWorkspaceChrome matterId={matterId}>{children}</CaseWorkspaceChrome>
      </div>
    </MatterChromeProvider>
  );
}
