"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useActiveOrganization } from "@/components/use-active-organization";
import { WorkspaceNavLink, WorkspaceSidebar } from "./workspace-sidebar";

type CaseRow = { id: string; title: string; matterNumber: string; status: string };
type ChatRow = { id: string; title: string };

export function GlobalSidebar() {
  const pathname = usePathname();
  const { organizationId, organizations, selectOrganization, loading } = useActiveOrganization();
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [chats, setChats] = useState<ChatRow[]>([]);

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
        <div className="space-y-3">
          {organizations.length > 0 ? (
            <div>
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-ink/45">
                Firm
              </label>
              <select
                className="w-full rounded-md border border-line bg-white px-2 py-1.5 text-xs"
                value={organizationId}
                onChange={(e) => selectOrganization(e.target.value)}
              >
                {organizations.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <div className="space-y-1">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-ink/45">
              Other workspaces
            </p>
            <Link href="/portal" className="block text-xs font-semibold text-ink/70 hover:text-ink">
              Client view
            </Link>
            <Link href="/professor" className="block text-xs font-semibold text-ink/70 hover:text-ink">
              Professor
            </Link>
            <Link href="/guide" className="block text-xs font-semibold text-ink/70 hover:text-ink">
              Guide
            </Link>
          </div>
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
      <WorkspaceNavLink href="/app/chats" label="All chats" indent active={pathname === "/app/chats"} />

      <div className="mb-1 mt-4 flex items-center justify-between px-2.5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink/45">Cases</p>
        <Link href="/app/cases/new" className="text-xs font-semibold text-accent hover:underline">
          +
        </Link>
      </div>
      {loading ? <p className="px-2.5 text-xs text-ink/40">Loading…</p> : null}
      {cases.length === 0 && !loading ? (
        <p className="px-2.5 py-1 text-xs text-ink/40">No cases yet</p>
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
      <WorkspaceNavLink href="/app/cases" label="All cases" indent active={pathname === "/app/cases"} />

      <div className="mt-4 space-y-0.5 border-t border-line pt-3">
        <p className="mb-1 px-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink/45">
          Firm
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
          title="Hearings and deadlines"
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
