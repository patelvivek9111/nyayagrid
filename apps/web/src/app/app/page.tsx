import { ProfessionalShell } from "@/components/shell";
import { Panel, Badge } from "@nyayagrid/ui";
import Link from "next/link";

export default function ProfessionalHomePage() {
  return (
    <ProfessionalShell title="Professional home">
      <div className="mb-4 flex flex-wrap gap-2">
        <Badge>Phase 2</Badge>
        <Badge>Matter workflow</Badge>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <Panel title="Clients">
          <p className="mb-3 text-sm text-ink/70">
            Create and manage clients for your organization.
          </p>
          <Link href="/app/clients" className="text-sm font-semibold text-accent underline">
            Open clients
          </Link>
        </Panel>
        <Panel title="Matters">
          <p className="mb-3 text-sm text-ink/70">
            Open a matter to upload documents, ask Nyaya, and manage tasks.
          </p>
          <Link href="/app/matters" className="text-sm font-semibold text-accent underline">
            Open matters
          </Link>
        </Panel>
        <Panel title="Organization">
          <p className="mb-3 text-sm text-ink/70">Create a firm or solo organization.</p>
          <Link href="/app/onboarding" className="text-sm font-semibold text-accent underline">
            Onboarding
          </Link>
        </Panel>
      </div>
    </ProfessionalShell>
  );
}
