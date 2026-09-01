"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { MouseEvent, ReactNode } from "react";
import { Button, cx } from "@nyayagrid/ui";
import { useMatterChrome } from "@/components/use-matter-chrome";
import { compactJurisdictionHeaderLine, isJurisdictionUnset } from "@/lib/case-jurisdiction";
import { humanizeKey } from "@/lib/plain-labels";

/** Primary Case objects — always visible. `hint` is the plain-language line under the tabs. */
export const CASE_TABS = [
  { segment: "", label: "Home", hint: "Overview of this case" },
  { segment: "chats", label: "Chats", hint: "Ask Nyaya about the files in this case" },
  { segment: "documents", label: "Documents", hint: "Original files you uploaded" },
  {
    segment: "review",
    label: "Review",
    hint: "Suggested intelligence waiting for a human decision",
  },
  { segment: "timeline", label: "Timeline", hint: "What happened, in order" },
  { segment: "evidence", label: "Evidence", hint: "Proof tied to a source" },
  { segment: "people", label: "People", hint: "Who is involved" },
  { segment: "graph", label: "Graph", hint: "How people, files, and events connect" },
  { segment: "memory", label: "Memory", hint: "Facts and notes Nyaya should remember" },
  { segment: "work", label: "Work", hint: "Tasks, drafts, and things waiting on you" },
] as const;

/**
 * Work-surface subnav. Draft / Research / Analysis stay here.
 * Review is a primary Case tab so suggested intelligence is hard to miss.
 */
export const CASE_WORK_SURFACES = [
  { segment: "draft", label: "Draft", hint: "Write a document" },
  { segment: "research", label: "Research", hint: "Look up legal sources" },
  { segment: "analysis", label: "Analysis", hint: "Review a contract or deposition" },
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
  const { title, matter, loading, clientDisplayName, jurisdictionContext, openCaseDetails } =
    useMatterChrome();
  const jurisdictionLine = compactJurisdictionHeaderLine(jurisdictionContext);
  const jurisdictionMissing = isJurisdictionUnset(jurisdictionContext);

  return (
    <div className="mb-1">
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-accent">Case</p>
      <h1 className="font-display text-2xl text-ink md:text-3xl" suppressHydrationWarning>
        {loading ? "Loading…" : title}
      </h1>
      {clientDisplayName ? (
        <p className="mt-1 text-sm text-ink/70">
          {clientDisplayName}
          <span className="ml-1.5 text-xs uppercase tracking-wide text-ink/45">Client</span>
        </p>
      ) : null}
      {!loading ? (
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink/60">
          <span className="min-w-0 truncate">{jurisdictionLine}</span>
          {jurisdictionMissing ? (
            <button
              type="button"
              className="shrink-0 font-semibold text-accent underline"
              onClick={openCaseDetails}
            >
              Add jurisdiction
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button type="button" variant="secondary" onClick={openCaseDetails}>
          Case details
        </Button>
        {subtitle || matter?.status ? (
          <p className="text-sm text-ink/55">
            {[subtitle, matter?.status ? humanizeKey(matter.status) : null]
              .filter(Boolean)
              .join(" · ")}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function CaseTabs({ matterId }: { matterId: string }) {
  const pathname = usePathname();
  const { reviewPendingCount } = useMatterChrome();
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
              {tab.segment === "review" && reviewPendingCount > 0 ? (
                <span
                  className="ml-1.5 inline-flex min-w-5 items-center justify-center rounded-full bg-amber-100 px-1.5 text-[10px] font-bold text-amber-900"
                  aria-label={`${reviewPendingCount} items waiting for review`}
                >
                  {reviewPendingCount}
                </span>
              ) : null}
            </CaseNavLink>
          );
        })}
      </nav>
      <nav
        className="mt-1 flex flex-wrap items-center gap-1 overflow-x-auto pb-px"
        aria-label="Case work surfaces"
      >
        <span className="px-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink/40">
          Work
        </span>
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
                active
                  ? "bg-accent-soft text-accent"
                  : "text-ink/55 hover:bg-black/[0.03] hover:text-ink",
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
