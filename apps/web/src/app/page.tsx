import Link from "next/link";
import { PageHeader, Panel, Badge } from "@nyayagrid/ui";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-8 px-6 py-16">
      <PageHeader
        eyebrow="NyayaGrid"
        title="Legal intelligence and legal work in one system."
        description="NyayaGrid serves law firms, solo lawyers, and prosecution offices — with source-grounded answers and matter-centered workflows."
      />
      <div className="flex flex-wrap gap-3">
        <Badge>Professional</Badge>
        <Badge>Nyaya Prosecution</Badge>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Panel title="Professional Workspace">
          <p className="mb-4 text-sm text-ink/70">
            Matters, documents, Ask Nyaya, research, and drafting for law firms and solo lawyers.
          </p>
          <Link className="text-sm font-semibold text-accent underline" href="/app">
            Enter workspace
          </Link>
        </Panel>
        <Panel title="Nyaya Prosecution">
          <p className="mb-4 text-sm text-ink/70">
            Criminal case work for district attorney and prosecution offices — charges, evidence,
            discovery, disclosure review, and more.
          </p>
          <Link className="text-sm font-semibold text-accent underline" href="/app/prosecution">
            Open Nyaya Prosecution
          </Link>
        </Panel>
      </div>
    </main>
  );
}
