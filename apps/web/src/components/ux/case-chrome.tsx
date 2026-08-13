"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@nyayagrid/ui";
import { useMatterChrome } from "@/components/use-matter-chrome";

/** Primary Case objects — always visible. */
const CASE_TABS = [
  { segment: "", label: "Home" },
  { segment: "chats", label: "Chats" },
  { segment: "documents", label: "Documents" },
  { segment: "timeline", label: "Timeline" },
  { segment: "evidence", label: "Evidence" },
  { segment: "people", label: "People" },
  { segment: "graph", label: "Graph" },
  { segment: "memory", label: "Memory" },
  { segment: "work", label: "Work" },
] as const;

/**
 * Work-surface subnav (IA choice for §6): Draft / Research / Analysis / Review live here
 * rather than crowding the primary Case tabs. Work remains the attorney command hub.
 */
const CASE_WORK_SURFACES = [
  { segment: "draft", label: "Draft" },
  { segment: "research", label: "Research" },
  { segment: "analysis", label: "Analysis" },
  { segment: "review", label: "Review" },
] as const;

function tabActive(pathname: string, base: string, segment: string) {
  const href = segment ? `${base}/${segment}` : base;
  if (segment === "") return pathname === base;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function CaseHeader({ subtitle }: { subtitle?: string | null }) {
  const { title, matter, loading } = useMatterChrome();
  return (
    <div className="mb-1">
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-accent">Case</p>
      <h1 className="font-display text-2xl text-ink md:text-3xl">{loading ? "Loading…" : title}</h1>
      {subtitle || matter?.status ? (
        <p className="mt-1 text-sm text-ink/60">
          {[subtitle, matter?.status].filter(Boolean).join(" · ")}
        </p>
      ) : null}
    </div>
  );
}

export function CaseTabs({ matterId }: { matterId: string }) {
  const pathname = usePathname();
  const base = `/app/cases/${matterId}`;

  return (
    <div>
      <nav
        className="mt-4 flex gap-1 overflow-x-auto border-b border-line pb-px"
        aria-label="Case sections"
      >
        {CASE_TABS.map((tab) => {
          const href = tab.segment ? `${base}/${tab.segment}` : base;
          const active = tabActive(pathname, base, tab.segment);
          return (
            <Link
              key={tab.label}
              href={href}
              className={cx(
                "whitespace-nowrap border-b-2 px-3 py-2 text-sm font-semibold transition",
                active
                  ? "border-accent text-accent"
                  : "border-transparent text-ink/60 hover:text-ink",
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
      <nav
        className="mt-1 flex gap-1 overflow-x-auto pb-px"
        aria-label="Case work surfaces"
      >
        {CASE_WORK_SURFACES.map((tab) => {
          const href = `${base}/${tab.segment}`;
          const active = tabActive(pathname, base, tab.segment);
          return (
            <Link
              key={tab.label}
              href={href}
              className={cx(
                "whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-semibold transition",
                active ? "bg-accent-soft text-accent" : "text-ink/55 hover:bg-black/[0.03] hover:text-ink",
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

export function CaseWorkspaceChrome({
  matterId,
  children,
  subtitle,
}: {
  matterId: string;
  children: React.ReactNode;
  subtitle?: string | null;
}) {
  const { error } = useMatterChrome();
  return (
    <div>
      <CaseHeader subtitle={subtitle} />
      <CaseTabs matterId={matterId} />
      {error ? <p className="mt-3 text-sm text-[var(--ng-danger)]">{error}</p> : null}
      <div className="mt-6">{children}</div>
    </div>
  );
}
