import Link from "next/link";
import { PageHeader, Panel, Badge } from "@nyayagrid/ui";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-8 px-6 py-16">
      <PageHeader
        eyebrow="NyayaGrid"
        title="Legal intelligence and legal work in one system."
        description="NyayaGrid serves law firms, solo lawyers, law students, and the public — with source-grounded answers and matter-centered workflows."
      />
      <div className="flex flex-wrap gap-3">
        <Badge>Professional</Badge>
        <Badge>Nyaya Professor</Badge>
        <Badge>Nyaya Guide</Badge>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <Panel title="Professional Workspace">
          <p className="mb-4 text-sm text-ink/70">
            Matters, documents, Ask Nyaya, research, drafting, and prosecution case work for firms and solo lawyers.
          </p>
          <Link className="text-sm font-semibold text-accent underline" href="/app">
            Enter workspace
          </Link>
        </Panel>
        <Panel title="Nyaya Professor">
          <p className="mb-4 text-sm text-ink/70">
            Case upload, briefing, comparison, and citation-backed study answers for law students.
          </p>
          <Link className="text-sm font-semibold text-accent underline" href="/professor">
            Open Nyaya Professor
          </Link>
        </Panel>
        <Panel title="Nyaya Guide">
          <p className="mb-4 text-sm text-ink/70">
            Plain-language legal information, document explanation, and consultation prep for the public.
          </p>
          <Link className="text-sm font-semibold text-accent underline" href="/guide">
            Open Nyaya Guide
          </Link>
        </Panel>
      </div>
    </main>
  );
}
