import Link from "next/link";
import type { ReactNode } from "react";

/** Keep in sync with GUIDE_BASE_DISCLAIMER in @nyayagrid/ai — inlined so the shell stays client-safe. */
const GUIDE_BASE_DISCLAIMER =
  "Nyaya Guide provides legal information and document explanations. It does not replace advice from a licensed attorney.";

const professionalNav = [
  { href: "/app", label: "Home" },
  { href: "/app/clients", label: "Clients" },
  { href: "/app/matters", label: "Matters" },
  { href: "/app/research", label: "Research" },
  { href: "/app/onboarding", label: "Onboarding" },
  { href: "/app/settings", label: "Settings" },
];

export function ProfessionalShell({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-white/70 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4">
          <div>
            <Link href="/" className="font-display text-xl text-ink">
              NyayaGrid
            </Link>
            <p className="text-xs uppercase tracking-[0.16em] text-accent">Professional</p>
          </div>
          <nav className="flex flex-wrap gap-4 text-sm font-semibold text-ink/80">
            {professionalNav.map((item) => (
              <Link key={item.href} href={item.href} className="hover:text-accent">
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">
        {title ? <h1 className="mb-6 font-display text-3xl text-ink">{title}</h1> : null}
        {children}
      </main>
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
    { href: `/app/matters/${matterId}`, label: "Overview" },
    { href: `/app/matters/${matterId}/documents`, label: "Documents" },
    { href: `/app/matters/${matterId}/nyaya`, label: "Nyaya" },
    { href: `/app/matters/${matterId}/timeline`, label: "Timeline" },
    { href: `/app/matters/${matterId}/graph`, label: "Graph" },
    { href: `/app/matters/${matterId}/memory`, label: "Memory" },
    { href: `/app/matters/${matterId}/research`, label: "Research" },
    { href: `/app/matters/${matterId}/draft`, label: "Draft" },
    { href: `/app/matters/${matterId}/analysis`, label: "Analysis" },
    { href: `/app/matters/${matterId}/review`, label: "Review" },
    { href: `/app/matters/${matterId}/tasks`, label: "Tasks" },
  ];
  return (
    <ProfessionalShell>
      <div className="mb-6">
        <p className="text-xs uppercase tracking-[0.16em] text-accent">Matter</p>
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
    </ProfessionalShell>
  );
}

const studentNav = [
  { href: "/professor", label: "Home" },
  { href: "/professor/ask", label: "Ask Professor" },
  { href: "/professor/cases", label: "Cases" },
  { href: "/professor/saved", label: "Saved" },
];

/**
 * Nyaya Professor's shell keeps an educational, campus-study feel — warm rounded nav pills, a
 * softly-tinted header, and only a small, understated link out to the Professional product. It
 * deliberately does not borrow the dense "Matter" chrome used by ProfessionalShell/MatterShell.
 */
export function StudentShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-accent-soft/30 to-transparent">
      <header className="border-b border-line bg-white/70 backdrop-blur">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-6 py-4">
          <div>
            <Link href="/professor" className="font-display text-xl text-ink">
              Nyaya Professor
            </Link>
            <p className="text-xs uppercase tracking-[0.16em] text-accent">
              Study aid, not a course
            </p>
          </div>
          <nav className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink/80">
            {studentNav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-full px-3 py-1.5 transition hover:bg-accent-soft/60 hover:text-accent"
              >
                {item.label}
              </Link>
            ))}
            <Link href="/app" className="ml-2 text-xs font-normal text-ink/40 hover:text-ink/70">
              Professional →
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  );
}

const publicNav = [
  { href: "/guide", label: "Ask Guide" },
  { href: "/guide/explain", label: "Explain Document" },
  { href: "/guide/situation", label: "Organize Situation" },
  { href: "/guide/prepare", label: "Prepare for Lawyer" },
];

/**
 * Nyaya Guide's shell stays calm and low-friction for a public, possibly stressed visitor. The
 * legal-information disclaimer appears once here (not repeated per message/answer), and the
 * Professional link is a quiet aside rather than a competing call to action.
 */
export function PublicShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-white/70 backdrop-blur">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-6 py-4">
          <div>
            <Link href="/guide" className="font-display text-xl text-ink">
              Nyaya Guide
            </Link>
            <p className="text-xs uppercase tracking-[0.16em] text-accent">Legal information</p>
          </div>
          <nav className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink/80">
            {publicNav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-full px-3 py-1.5 transition hover:bg-accent-soft/60 hover:text-accent"
              >
                {item.label}
              </Link>
            ))}
            <Link href="/app" className="ml-2 text-xs font-normal text-ink/40 hover:text-ink/70">
              Professional →
            </Link>
          </nav>
        </div>
      </header>
      <div className="mx-auto max-w-5xl px-6 pt-4">
        <p className="rounded-md border border-line bg-accent-soft/30 px-3 py-2 text-xs text-ink/70">
          {GUIDE_BASE_DISCLAIMER} Laws vary by jurisdiction and situation — for anything urgent,
          contact a qualified lawyer or emergency service directly.
        </p>
      </div>
      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  );
}
