import type { ReactNode } from "react";

export function AuthShell({
  title,
  description,
  children,
  notice,
}: {
  title: string;
  description: string;
  children: ReactNode;
  notice?: string | null;
}) {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-8 px-6 py-12 sm:max-w-lg">
      <header>
        <p className="font-display text-2xl text-ink">NyayaGrid</p>
        <p className="mt-1 text-sm text-ink/60">Legal intelligence for your practice.</p>
        <h1 className="mt-8 font-display text-3xl text-ink">{title}</h1>
        <p className="mt-2 text-sm leading-6 text-ink/70">{description}</p>
      </header>
      {notice ? (
        <p className="rounded-md border border-line bg-white px-3 py-2 text-sm text-ink/80" role="status" aria-live="polite">
          {notice}
        </p>
      ) : null}
      {children}
    </main>
  );
}
