"use client";

import type { ReactNode } from "react";
import { MatterChromeProvider } from "@/components/use-matter-chrome";
import { CaseWorkspaceChrome } from "@/components/ux";

export function CaseLayoutClient({
  matterId,
  children,
}: {
  matterId: string;
  children: ReactNode;
}) {
  return (
    <MatterChromeProvider matterId={matterId}>
      <div className="mx-auto max-w-5xl">
        <CaseWorkspaceChrome matterId={matterId}>{children}</CaseWorkspaceChrome>
      </div>
    </MatterChromeProvider>
  );
}
