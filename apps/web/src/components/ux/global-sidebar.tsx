"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { cx } from "@nyayagrid/ui";
import { useActiveOrganization } from "@/components/use-active-organization";

type CaseRow = { id: string; title: string; matterNumber: string; status: string };
type ChatRow = { id: string; title: string };

function NavLink({
  href,
  label,
  active,
  indent,
}: {
  href: string;
  label: string;
  active?: boolean;
  indent?: boolean;
}) {
  return (
    <Link
      href={href}
      className={cx(
        "block truncate rounded-md px-2.5 py-1.5 text-sm transition",
        indent && "pl-4 text-[13px]",
        active
          ? "bg-accent-soft/70 font-semibold text-accent"
          : "text-ink/75 hover:bg-black/[0.03] hover:text-ink",
      )}
    >
      {label}
    </Link>
  );
}

export function GlobalSidebar() {
  const pathname = usePathname();
  const { organizationId, organizations, selectOrganization, loading } = useActiveOrganization();
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [chats, setChats] = useState<ChatRow[]>([]);
  const [mobileOpen, setMobileOpen] = useState(false);

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

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const sidebar = (
    <aside className="flex h-full w-[260px] shrink-0 flex-col border-r border-line bg-white/90">
      <div className="border-b border-line px-4 py-4">
        <Link href="/app" className="font-display text-xl text-ink">
          NyayaGrid
        </Link>
        <p className="mt-0.5 text-[10px] uppercase tracking-[0.16em] text-accent">Professional</p>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-3">
        <NavLink href="/app" label="New Chat" active={pathname === "/app"} />

        <p className="mb-1 mt-4 px-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink/45">
          Chats
        </p>
        {chats.length === 0 ? (
          <p className="px-2.5 py-1 text-xs text-ink/40">No recent chats</p>
        ) : (
          chats.map((c) => (
            <NavLink
              key={c.id}
              href={`/app/chats/${c.id}`}
              label={c.title}
              indent
              active={pathname === `/app/chats/${c.id}`}
            />
          ))
        )}
        <NavLink href="/app/chats" label="All chats" indent active={pathname === "/app/chats"} />

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
            <NavLink
              key={c.id}
              href={`/app/cases/${c.id}`}
              label={c.title}
              indent
              active={pathname.startsWith(`/app/cases/${c.id}`)}
            />
          ))
        )}
        <NavLink href="/app/cases" label="All cases" indent active={pathname === "/app/cases"} />

        <div className="mt-4 space-y-0.5 border-t border-line pt-3">
          <NavLink href="/app/clients" label="Clients" active={pathname.startsWith("/app/clients")} />
          <NavLink
            href="/app/calendar"
            label="Calendar"
            active={pathname.startsWith("/app/calendar")}
          />
          <NavLink href="/app/time" label="Time" active={pathname.startsWith("/app/time")} />
          <NavLink href="/app/billing" label="Billing" active={pathname.startsWith("/app/billing")} />
          <NavLink href="/app/inbox" label="Inbox" active={pathname.startsWith("/app/inbox")} />
          <NavLink
            href="/app/compliance"
            label="Compliance"
            active={pathname.startsWith("/app/compliance")}
          />
          <NavLink href="/portal" label="Client portal" />
          <NavLink
            href="/app/research"
            label="Research"
            active={pathname.startsWith("/app/research")}
          />
          <NavLink href="/professor" label="Professor" />
          <NavLink href="/guide" label="Guide" />
          <NavLink
            href="/app/settings"
            label="Settings"
            active={pathname.startsWith("/app/settings")}
          />
        </div>
      </div>

      {organizations.length > 0 ? (
        <div className="border-t border-line px-3 py-3">
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-ink/45">
            Organization
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
    </aside>
  );

  return (
    <>
      <button
        type="button"
        className="fixed left-3 top-3 z-40 rounded-md border border-line bg-white px-2.5 py-1.5 text-xs font-semibold shadow-sm lg:hidden"
        onClick={() => setMobileOpen((v) => !v)}
        aria-expanded={mobileOpen}
        aria-controls="ng-global-sidebar"
      >
        Menu
      </button>
      <div
        id="ng-global-sidebar"
        className={cx(
          "fixed inset-y-0 left-0 z-30 lg:static lg:block",
          mobileOpen ? "block" : "hidden lg:block",
        )}
      >
        {sidebar}
      </div>
      {mobileOpen ? (
        <button
          type="button"
          className="fixed inset-0 z-20 bg-ink/20 lg:hidden"
          aria-label="Close menu"
          onClick={() => setMobileOpen(false)}
        />
      ) : null}
    </>
  );
}
