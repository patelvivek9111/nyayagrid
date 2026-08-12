import { ProfessionalShell } from "@/components/shell";
import { Panel } from "@nyayagrid/ui";

export default function SettingsPage() {
  return (
    <ProfessionalShell title="Settings">
      <Panel title="Members and roles">
        <p className="text-sm text-ink/70">
          NyayaGrid owns authorization. Organization memberships, roles, and capabilities are stored
          in PostgreSQL and enforced server-side. Identity providers authenticate only.
        </p>
      </Panel>
    </ProfessionalShell>
  );
}
