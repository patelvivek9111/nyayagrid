"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import {
  WorkspaceChrome,
  WorkspaceNavLink,
  WorkspaceSidebar,
  navPathActive,
} from "./workspace-sidebar";

type ConversationRow = { id: string; title: string | null };
type CaseRow = { id: string; title: string };

const topNav = [
  { href: "/professor", label: "Home", exact: true },
  { href: "/professor/ask", label: "Nyaya Professor", exact: true },
] as const;

const toolNav = [
  { href: "/professor/compare", label: "Compare", exact: true },
  { href: "/professor/briefs", label: "Case Briefs", exact: true },
  { href: "/professor/notes", label: "Notes", exact: true },
  { href: "/professor/saved", label: "Saved Conversations", exact: true },
  { href: "/professor/settings", label: "Settings", exact: true },
] as const;

export function ProfessorSidebar() {
  const pathname = usePathname();
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [cases, setCases] = useState<CaseRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [conversationsRes, casesRes] = await Promise.all([
          fetch("/api/v1/professor/conversations"),
          fetch("/api/v1/professor/cases"),
        ]);
        const conversationsData = await conversationsRes.json();
        const casesData = await casesRes.json();
        if (cancelled) return;
        if (conversationsRes.ok) {
          setConversations((conversationsData.conversations ?? []).slice(0, 8));
        }
        if (casesRes.ok) {
          setCases((casesData.cases ?? []).slice(0, 12));
        }
      } catch {
        // Sidebar lists are best-effort; pages surface hard errors.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  return (
    <WorkspaceSidebar
      brandHref="/professor"
      brandTitle="Nyaya Professor"
      brandEyebrow="Student"
      menuId="ng-professor-sidebar"
      footer={
        <div className="space-y-1">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-ink/45">
            Workspaces
          </p>
          <Link href="/app" className="block text-xs font-semibold text-ink/70 hover:text-ink">
            Professional
          </Link>
          <Link href="/guide" className="block text-xs font-semibold text-ink/70 hover:text-ink">
            Guide
          </Link>
        </div>
      }
    >
      {topNav.map((item) => (
        <WorkspaceNavLink
          key={item.href}
          href={item.href}
          label={item.label}
          active={navPathActive(pathname, item.href, item.exact)}
        />
      ))}

      <p className="mb-1 mt-4 px-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink/45">
        Conversations
      </p>
      {conversations.length === 0 ? (
        <p className="px-2.5 py-1 text-xs text-ink/40">No recent conversations</p>
      ) : (
        conversations.map((conversation) => (
          <WorkspaceNavLink
            key={conversation.id}
            href={`/professor/ask?conversationId=${conversation.id}`}
            label={conversation.title || "Untitled"}
            indent
          />
        ))
      )}
      <WorkspaceNavLink
        href="/professor/saved"
        label="All saved"
        indent
        active={pathname === "/professor/saved"}
      />

      <div className="mb-1 mt-4 flex items-center justify-between px-2.5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink/45">Cases</p>
        <Link href="/professor/cases" className="text-xs font-semibold text-accent hover:underline">
          +
        </Link>
      </div>
      {cases.length === 0 ? (
        <p className="px-2.5 py-1 text-xs text-ink/40">No cases yet</p>
      ) : (
        cases.map((studentCase) => (
          <WorkspaceNavLink
            key={studentCase.id}
            href={`/professor/cases/${studentCase.id}`}
            label={studentCase.title}
            indent
            active={pathname === `/professor/cases/${studentCase.id}`}
          />
        ))
      )}
      <WorkspaceNavLink
        href="/professor/cases"
        label="All cases"
        indent
        active={pathname === "/professor/cases"}
      />

      <div className="mt-4 space-y-0.5 border-t border-line pt-3">
        {toolNav.map((item) => (
          <WorkspaceNavLink
            key={item.href}
            href={item.href}
            label={item.label}
            active={navPathActive(pathname, item.href, item.exact)}
          />
        ))}
      </div>
    </WorkspaceSidebar>
  );
}

export function ProfessorChrome({ children }: { children: ReactNode }) {
  return <WorkspaceChrome sidebar={<ProfessorSidebar />}>{children}</WorkspaceChrome>;
}
