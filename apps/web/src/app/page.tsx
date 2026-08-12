import Link from "next/link";
import { PageHeader, Panel, Badge } from "@nyayagrid/ui";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-8 px-6 py-16">
      <PageHeader
        eyebrow="NyayaGrid"
        title="Legal intelligence and legal work in one system."
        description="Phase 1 foundation: authentication, organizations, authorization, storage, audit, and workspace shells."
      />
      <div className="flex flex-wrap gap-3">
        <Badge>Professional</Badge>
        <Badge>Student shell</Badge>
        <Badge>Public shell</Badge>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <Panel title="Professional Workspace">
          <p className="mb-4 text-sm text-ink/70">
            Firm and solo lawyer tenancy on one Organization model.
          </p>
          <Link className="text-sm font-semibold text-accent underline" href="/app">
            Enter /app
          </Link>
        </Panel>
        <Panel title="Nyaya Professor">
          <p className="mb-4 text-sm text-ink/70">
            Student shell only in Phase 1. No Professor features yet.
          </p>
          <Link className="text-sm font-semibold text-accent underline" href="/professor">
            Open shell
          </Link>
        </Panel>
        <Panel title="Nyaya Guide">
          <p className="mb-4 text-sm text-ink/70">
            Public shell only in Phase 1. No Guide features yet.
          </p>
          <Link className="text-sm font-semibold text-accent underline" href="/guide">
            Open shell
          </Link>
        </Panel>
      </div>
    </main>
  );
}
