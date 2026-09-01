"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { cx } from "@nyayagrid/ui";
import { useActiveOrganization } from "@/components/use-active-organization";
import { useFeatureFlags } from "@/components/use-feature-flags";
import { IntelligenceDialog } from "@/components/ux/case-intelligence";
import { shouldShowWorkspaceSwitcher } from "@/lib/workspace-ux";
import { SignOutControl } from "@/components/sign-out-control";
import { WorkspaceNavLink, WorkspaceSidebar } from "./workspace-sidebar";

type CaseRow = { id: string; title: string; matterNumber: string; status: string };
type ChatRow = { id: string; title: string };

export function GlobalSidebar() {
  const pathname = usePathname();
  const { organizationId, organizations, selectOrganization, loading } = useActiveOrganization();
  const { flags } = useFeatureFlags();
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [chats, setChats] = useState<ChatRow[]>([]);
  const [switchOpen, setSwitchOpen] = useState(false);

  const activeOrg = organizations.find((o) => o.id === organizationId) ?? null;
  const showWorkspaceSwitcher = shouldShowWorkspaceSwitcher(organizations.length);

  useEffect(() => {
    if (!organizationId) {
      setCases([]);
      setChats([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [mattersRes, sessionsRes] = await Promise.all([
          fetch(`/api/v1/matters?organizationId=${organizationId}`),
          fetch(`/api/v1/research/sessions?organizationId=${organizationId}`),
        ]);
        const mattersData = await mattersRes.json();
        const sessionsData = await sessionsRes.json();
        if (cancelled) return;
        if (mattersRes.ok) {
          setCases(
            (mattersData.matters ?? [])
              .slice(0, 12)
              .map((m: CaseRow & { clientDisplayName?: string }) => ({
                id: m.id,
                title: m.title,
                matterNumber: m.matterNumber,
                status: m.status,
              })),
          );
        }
        if (sessionsRes.ok) {
          const general = (sessionsData.sessions ?? []).filter(
            (s: { matterId?: string | null }) => !s.matterId,
          );
          setChats(
            general.slice(0, 8).map((s: { id: string; title: string }) => ({
              id: s.id,
              title: s.title || "Untitled chat",
            })),
          );
        }
      } catch {
        // Sidebar lists are best-effort; pages surface hard errors.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  return (
    <WorkspaceSidebar
      brandHref="/app"
      brandTitle="NyayaGrid"
      brandEyebrow="Professional"
      menuId="ng-global-sidebar"
      footer={
        <div className="space-y-2.5">
          {showWorkspaceSwitcher && activeOrg ? (
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left transition hover:bg-black/[0.03] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              aria-label="Switch workspace"
              aria-haspopup="dialog"
              aria-expanded={switchOpen}
              title={activeOrg.name}
              onClick={() => setSwitchOpen(true)}
            >
              <span className="min-w-0 flex-1">
                <span className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-ink/45">
                  Workspace
                </span>
                <span className="mt-0.5 block truncate text-[13px] font-medium text-ink">
                  {activeOrg.name}
                </span>
              </span>
              <svg
                viewBox="0 0 16 16"
                className="h-3.5 w-3.5 shrink-0 text-ink/35"
                aria-hidden="true"
              >
                <path
                  d="M4 6l4 4 4-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          ) : !loading && organizations.length === 0 ? (
            <Link
              href="/app/onboarding"
              className="block px-1 text-xs font-semibold text-accent underline"
            >
              Set up your workspace
            </Link>
          ) : null}
          <div
            className={cx(showWorkspaceSwitcher && activeOrg ? "border-t border-line pt-2.5" : "")}
          >
            <p className="px-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink/45">
              Other workspaces
            </p>
            <div className="mt-1 flex flex-col">
              <Link
                href="/portal"
                className="rounded-md px-1 py-0.5 text-xs text-ink/60 hover:bg-black/[0.03] hover:text-ink"
              >
                Client view
              </Link>
              {flags.professor ? (
                <Link
                  href="/professor"
                  className="rounded-md px-1 py-0.5 text-xs text-ink/60 hover:bg-black/[0.03] hover:text-ink"
                >
                  Professor
                </Link>
              ) : null}
              {flags.guide ? (
                <Link
                  href="/guide"
                  className="rounded-md px-1 py-0.5 text-xs text-ink/60 hover:bg-black/[0.03] hover:text-ink"
                >
                  Guide
                </Link>
              ) : null}
              <SignOutControl className="mt-1 rounded-md px-1 py-0.5 text-left text-xs font-semibold text-ink/70 hover:bg-black/[0.03] hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" />
            </div>
          </div>
          <IntelligenceDialog
            open={switchOpen}
            title="Switch workspace"
            description="Cases, clients, calendar, and billing stay inside the workspace you select."
            onClose={() => setSwitchOpen(false)}
          >
            <ul className="space-y-0.5">
              {organizations.map((org) => {
                const selected = org.id === organizationId;
                return (
                  <li key={org.id}>
                    <button
                      type="button"
                      className={cx(
                        "flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm",
                        selected
                          ? "bg-accent-soft/70 font-medium text-ink"
                          : "text-ink/80 hover:bg-black/[0.03] hover:text-ink",
                      )}
                      aria-pressed={selected}
                      autoFocus={selected}
                      onClick={() => {
                        selectOrganization(org.id);
                        setSwitchOpen(false);
                      }}
                    >
                      <span className="truncate">{org.name}</span>
                      {selected ? (
                        <span className="ml-3 shrink-0 text-xs text-ink/55">Current</span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </IntelligenceDialog>
        </div>
      }
    >
      <WorkspaceNavLink
        href="/app"
        label="Ask Nyaya"
        title="Start a new question"
        active={pathname === "/app"}
      />

      <p className="mb-1 mt-4 px-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink/45">
        Chats
      </p>
      {chats.length === 0 ? (
        <p className="px-2.5 py-1 text-xs text-ink/40">No recent chats</p>
      ) : (
        chats.map((c) => (
          <WorkspaceNavLink
            key={c.id}
            href={`/app/chats/${c.id}`}
            label={c.title}
            indent
            active={pathname === `/app/chats/${c.id}`}
          />
        ))
      )}
      <WorkspaceNavLink
        href="/app/chats"
        label="All chats"
        indent
        active={pathname === "/app/chats"}
      />

      <div className="mb-1 mt-4 flex items-center justify-between px-2.5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink/45">Cases</p>
        <Link href="/app/cases/new" className="text-xs font-semibold text-accent hover:underline">
          +
        </Link>
      </div>
      {loading ? <p className="px-2.5 text-xs text-ink/40">Loading…</p> : null}
      {cases.length === 0 && !loading ? (
        <Link
          href="/app/cases/new"
          className="block px-2.5 py-1 text-xs font-semibold text-accent hover:underline"
        >
          Create your first Case
        </Link>
      ) : (
        cases.map((c) => (
          <WorkspaceNavLink
            key={c.id}
            href={`/app/cases/${c.id}`}
            label={c.title}
            indent
            active={pathname.startsWith(`/app/cases/${c.id}`)}
          />
        ))
      )}
      <WorkspaceNavLink
        href="/app/cases"
        label="All cases"
        indent
        active={pathname === "/app/cases"}
      />

      <div className="mt-4 space-y-0.5 border-t border-line pt-3">
        <p
          className="mb-1 px-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink/45"
          title="Practice operations"
        >
          Practice
        </p>
        <WorkspaceNavLink
          href="/app/clients"
          label="Clients"
          title="People and companies you represent"
          active={pathname.startsWith("/app/clients")}
        />
        <WorkspaceNavLink
          href="/app/calendar"
          label="Calendar"
          title="Upcoming deadlines and tasks"
          active={pathname.startsWith("/app/calendar")}
        />
        <WorkspaceNavLink
          href="/app/time"
          label="Time"
          title="Hours to bill"
          active={pathname.startsWith("/app/time")}
        />
        <WorkspaceNavLink
          href="/app/billing"
          label="Billing"
          title="Invoices and amounts"
          active={pathname.startsWith("/app/billing")}
        />
      </div>

      <div className="mt-4 space-y-0.5 border-t border-line pt-3">
        <p className="mb-1 px-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink/45">
          More
        </p>
        <WorkspaceNavLink
          href="/app/inbox"
          label="Inbox"
          title="Incoming mail to file on a case"
          active={pathname.startsWith("/app/inbox")}
        />
        <WorkspaceNavLink
          href="/app/research"
          label="Research"
          title="Search legal sources"
          active={pathname.startsWith("/app/research")}
        />
        <WorkspaceNavLink
          href="/app/compliance"
          label="Holds & privacy"
          title="Legal holds, exports, and training consent"
          active={pathname.startsWith("/app/compliance")}
        />
        <WorkspaceNavLink
          href="/app/settings"
          label="Settings"
          title="Team, invites, and notifications"
          active={pathname.startsWith("/app/settings")}
        />
      </div>
    </WorkspaceSidebar>
  );
}
