import { isFeatureEnabled } from "@nyayagrid/platform";
import { ProfessorChrome } from "@/components/ux/professor-chrome";

export default function ProfessorLayout({ children }: { children: React.ReactNode }) {
  if (!isFeatureEnabled("professor")) {
    return (
      <main className="mx-auto max-w-xl px-6 py-16">
        <h1 className="font-display text-3xl text-ink">Nyaya Professor is not enabled</h1>
        <p className="mt-3 text-sm text-ink/70">
          This deployment has Professor turned off (`FEATURE_PROFESSOR`). Professional controlled
          beta keeps student uploads off the same cluster as client matters.
        </p>
      </main>
    );
  }
  return <ProfessorChrome>{children}</ProfessorChrome>;
}
