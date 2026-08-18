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

/** Keep in sync with GUIDE_BASE_DISCLAIMER in @nyayagrid/ai — inlined so the chrome stays client-safe. */
const GUIDE_BASE_DISCLAIMER =
  "Nyaya Guide provides legal information, not legal advice. It does not create an attorney-client relationship or attorney-client privilege. It is not a substitute for a licensed lawyer.";

type ConversationRow = { id: string; title: string };

const publicNav = [
  { href: "/guide", label: "Nyaya Guide", exact: true },
  { href: "/guide/explain", label: "Explain a Document", exact: true },
  { href: "/guide/situation", label: "Build My Timeline", exact: true },
  { href: "/guide/prepare", label: "Prepare for a Lawyer", exact: true },
  { href: "/guide/files", label: "My Files", exact: true },
  { href: "/guide/saved", label: "Saved Conversations", exact: true },
  { href: "/guide/safety", label: "Safety and Privacy", exact: true },
] as const;

export function GuideSidebar() {
  const pathname = usePathname();
  const [conversations, setConversations] = useState<ConversationRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/v1/guide/conversations");
        const data = await res.json();
        if (cancelled) return;
        if (res.ok) setConversations((data.conversations ?? []).slice(0, 8));
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
      brandHref="/guide"
      brandTitle="Nyaya Guide"
      brandEyebrow="Legal information"
      menuId="ng-guide-sidebar"
      footer={
        <div className="space-y-1">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-ink/45">
            Workspaces
          </p>
          <Link href="/app" className="block text-xs font-semibold text-ink/70 hover:text-ink">
            Professional
          </Link>
          <Link href="/professor" className="block text-xs font-semibold text-ink/70 hover:text-ink">
            Professor
          </Link>
        </div>
      }
    >
      <WorkspaceNavLink href="/guide" label="Nyaya Guide" active={pathname === "/guide"} />

      <p className="mb-1 mt-4 px-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink/45">
        Conversations
      </p>
      {conversations.length === 0 ? (
        <p className="px-2.5 py-1 text-xs text-ink/40">No recent conversations</p>
      ) : (
        conversations.map((conversation) => (
          <WorkspaceNavLink
            key={conversation.id}
            href={`/guide?c=${conversation.id}`}
            label={conversation.title || "Untitled"}
            indent
          />
        ))
      )}
      <WorkspaceNavLink
        href="/guide/saved"
        label="All saved"
        indent
        active={pathname === "/guide/saved"}
      />

      <div className="mt-4 space-y-0.5 border-t border-line pt-3">
        {publicNav.slice(1).map((item) => (
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

export function GuideChrome({ children }: { children: ReactNode }) {
  return (
    <WorkspaceChrome
      sidebar={<GuideSidebar />}
      banner={
        <p className="mb-6 rounded-md border border-line bg-accent-soft/30 px-3 py-2 text-xs text-ink/70">
          {GUIDE_BASE_DISCLAIMER} Laws vary by jurisdiction and facts. For eviction, arrest,
          deportation, domestic violence, child custody emergencies, or an imminent court date,
          contact a qualified lawyer or emergency service directly.
        </p>
      }
    >
      {children}
    </WorkspaceChrome>
  );
}
