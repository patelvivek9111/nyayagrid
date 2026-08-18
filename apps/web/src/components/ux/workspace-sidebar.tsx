"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { cx } from "@nyayagrid/ui";

export function WorkspaceNavLink({
  href,
  label,
  active,
  indent,
  title,
}: {
  href: string;
  label: string;
  active?: boolean;
  indent?: boolean;
  title?: string;
}) {
  return (
    <Link
      href={href}
      title={title}
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

export function navPathActive(pathname: string, href: string, exact = false): boolean {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function WorkspaceSidebar({
  brandHref,
  brandTitle,
  brandEyebrow,
  children,
  footer,
  menuId = "ng-workspace-sidebar",
}: {
  brandHref: string;
  brandTitle: string;
  brandEyebrow: string;
  children: ReactNode;
  footer?: ReactNode;
  menuId?: string;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const sidebar = (
    <aside className="flex h-full w-[260px] shrink-0 flex-col border-r border-line bg-white/90">
      <div className="border-b border-line px-4 py-4">
        <Link href={brandHref} className="font-display text-xl text-ink">
          {brandTitle}
        </Link>
        <p className="mt-0.5 text-[10px] uppercase tracking-[0.16em] text-accent">{brandEyebrow}</p>
      </div>
      <div className="flex-1 overflow-y-auto px-2 py-3">{children}</div>
      {footer ? <div className="border-t border-line px-3 py-3">{footer}</div> : null}
    </aside>
  );

  return (
    <>
      <button
        type="button"
        className="fixed left-3 top-3 z-40 rounded-md border border-line bg-white px-2.5 py-1.5 text-xs font-semibold shadow-sm lg:hidden"
        onClick={() => setMobileOpen((v) => !v)}
        aria-expanded={mobileOpen}
        aria-controls={menuId}
      >
        Menu
      </button>
      <div
        id={menuId}
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

export function WorkspaceChrome({
  sidebar,
  children,
  banner,
}: {
  sidebar: ReactNode;
  children: ReactNode;
  banner?: ReactNode;
}) {
  return (
    <div className="flex min-h-screen">
      {sidebar}
      <main className="min-w-0 flex-1 px-4 pb-10 pt-14 lg:px-8 lg:pt-8">
        <div className="mx-auto max-w-5xl">
          {banner}
          {children}
        </div>
      </main>
    </div>
  );
}
