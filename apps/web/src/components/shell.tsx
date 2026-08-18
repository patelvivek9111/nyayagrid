"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useMatterChrome } from "@/components/use-matter-chrome";

export function ProfessionalShell({ children, title }: { children: ReactNode; title?: string }) {
  /** Content-only shell — global nav lives in GlobalSidebar via /app layout. */
  return (
    <div className="mx-auto max-w-5xl">
      {title ? <h1 className="mb-6 font-display text-3xl text-ink">{title}</h1> : null}
      {children}
    </div>
  );
}

export function MatterShell({
  matterId,
  title,
  children,
}: {
  matterId: string;
  title: string;
  children: ReactNode;
}) {
  const tabs = [
    { href: `/app/cases/${matterId}`, label: "Home" },
    { href: `/app/cases/${matterId}/chats`, label: "Chats" },
    { href: `/app/cases/${matterId}/documents`, label: "Documents" },
    { href: `/app/cases/${matterId}/timeline`, label: "Timeline" },
    { href: `/app/cases/${matterId}/evidence`, label: "Evidence" },
    { href: `/app/cases/${matterId}/people`, label: "People" },
    { href: `/app/cases/${matterId}/graph`, label: "Graph" },
    { href: `/app/cases/${matterId}/memory`, label: "Memory" },
    { href: `/app/cases/${matterId}/work`, label: "Work" },
  ];
  return (
    <div>
      <div className="mb-6">
        <p className="text-xs uppercase tracking-[0.16em] text-accent">Case</p>
        <h1 className="font-display text-3xl text-ink">{title}</h1>
        <nav className="mt-4 flex flex-wrap gap-3">
          {tabs.map((tab) => (
            <Link
              key={tab.href}
              href={tab.href}
              className="rounded-md border border-line bg-white px-3 py-1.5 text-sm font-semibold hover:bg-accent-soft/50"
            >
              {tab.label}
            </Link>
          ))}
        </nav>
      </div>
      {children}
    </div>
  );
}

/** Matter chrome that stays mounted across matter tab navigations. */
export function MatterChromeShell({
  matterId,
  children,
}: {
  matterId: string;
  children: ReactNode;
}) {
  const { title, error } = useMatterChrome();
  return (
    <MatterShell matterId={matterId} title={title}>
      {error ? <p className="mb-4 text-sm text-[var(--ng-danger)]">{error}</p> : null}
      {children}
    </MatterShell>
  );
}

