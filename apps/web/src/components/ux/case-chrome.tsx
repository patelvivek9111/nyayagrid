"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { MouseEvent, ReactNode } from "react";
import { cx } from "@nyayagrid/ui";
import { useMatterChrome } from "@/components/use-matter-chrome";

/** Primary Case objects — always visible. `hint` is the plain-language line under the tabs. */
const CASE_TABS = [
  { segment: "", label: "Home", hint: "Overview of this case" },
  { segment: "chats", label: "Chats", hint: "Ask Nyaya about the files in this case" },
  { segment: "documents", label: "Documents", hint: "Original files you uploaded" },
  { segment: "timeline", label: "Timeline", hint: "What happened, in order" },
  { segment: "evidence", label: "Evidence", hint: "Proof tied to a source" },
  { segment: "people", label: "People", hint: "Who is involved" },
  { segment: "graph", label: "Graph", hint: "How people, files, and events connect" },
  { segment: "memory", label: "Memory", hint: "Facts and notes Nyaya should remember" },
  { segment: "work", label: "Work", hint: "Tasks, drafts, and things waiting on you" },
] as const;

/**
 * Work-surface subnav (IA choice for §6): Draft / Research / Analysis / Review live here
 * rather than crowding the primary Case tabs. Work remains the attorney command hub.
 */
const CASE_WORK_SURFACES = [
  { segment: "draft", label: "Draft", hint: "Write a document" },
  { segment: "research", label: "Research", hint: "Look up legal sources" },
  { segment: "analysis", label: "Analysis", hint: "Review a contract or deposition" },
  { segment: "review", label: "Review", hint: "Check what Nyaya found in the files" },
] as const;

function tabActive(pathname: string, base: string, segment: string) {
  const href = segment ? `${base}/${segment}` : base;
  if (segment === "") return pathname === base;
  return pathname === href || pathname.startsWith(`${href}/`);
}

function CaseNavLink({
  href,
  active,
  className,
  title,
  children,
}: {
  href: string;
  active: boolean;
  className: string;
  title?: string;
  children: ReactNode;
}) {
  const router = useRouter();

  function onClick(event: MouseEvent<HTMLAnchorElement>) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
      return;
    }
    event.preventDefault();
    router.push(href);
  }

  return (
    <Link
      href={href}
      prefetch={false}
      aria-current={active ? "page" : undefined}
      title={title}
      className={className}
      onClick={onClick}
    >
      {children}
    </Link>
  );
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
  const segment = pathname.slice(base.length).replace(/^\//, "").split("/")[0] ?? "";
  const activeTab =
    CASE_TABS.find((tab) => tab.segment === segment) ??
    CASE_WORK_SURFACES.find((tab) => tab.segment === segment);
  const extraHints: Record<string, string> = {
    nyaya: "Ask Nyaya about this case, or start a longer task",
    tasks: "To-dos and deadlines for this case",
  };
  const activeHint = activeTab?.hint ?? extraHints[segment] ?? CASE_TABS[0].hint;

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
            <CaseNavLink
              key={tab.label}
              href={href}
              active={active}
              title={tab.hint}
              className={cx(
                "whitespace-nowrap border-b-2 px-3 py-2 text-sm font-semibold transition",
                active
                  ? "border-accent text-accent"
                  : "border-transparent text-ink/60 hover:text-ink",
              )}
            >
              {tab.label}
            </CaseNavLink>
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
            <CaseNavLink
              key={tab.label}
              href={href}
              active={active}
              title={tab.hint}
              className={cx(
                "whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-semibold transition",
                active ? "bg-accent-soft text-accent" : "text-ink/55 hover:bg-black/[0.03] hover:text-ink",
              )}
            >
              {tab.label}
            </CaseNavLink>
          );
        })}
      </nav>
      <p className="mt-2 text-sm text-ink/55">{activeHint}</p>
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
