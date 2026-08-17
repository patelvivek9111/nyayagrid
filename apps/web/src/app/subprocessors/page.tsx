import type { Metadata } from "next";
import { PageHeader, Panel, Badge } from "@nyayagrid/ui";

export const metadata: Metadata = {
  title: "Subprocessors — NyayaGrid",
};

/**
 * Intended subprocessors for a future DPA. This is not a signed agreement and not a complete
 * production inventory until counsel and the live deployment (Clerk, AWS, scanner) exist.
 */
export default function SubprocessorsPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-6 py-16">
      <PageHeader
        eyebrow="Legal"
        title="Subprocessors"
        description="Providers that may process customer data when those integrations are enabled. This list is a draft for a future DPA — not counsel-signed."
      />
      <Badge>Draft — pending attorney review</Badge>
      <Panel title="Intended list">
        <ul className="list-disc space-y-2 pl-5 text-sm text-ink/80">
          <li>
            <span className="font-semibold">OpenAI</span> — model inference and embeddings when{" "}
            <code>AI_PROVIDER=openai</code>. Chat completions are sent with <code>store: false</code>.
            NyayaGrid does not use customer data to train models unless a separate consent row is
            recorded, and even then this build has no training pipeline.
          </li>
          <li>
            <span className="font-semibold">Clerk</span> — authentication when{" "}
            <code>AUTH_PROVIDER=clerk</code>. Identity only; NyayaGrid roles are not taken from IdP
            groups.
          </li>
          <li>
            <span className="font-semibold">Amazon Web Services (S3)</span> — object storage when{" "}
            <code>STORAGE_PROVIDER=s3</code>. Local/dev uses MinIO.
          </li>
          <li>
            <span className="font-semibold">ClamAV or equivalent malware scanner</span> — upload
            scanning when <code>MALWARE_SCANNER=clamav</code>.
          </li>
          <li>
            <span className="font-semibold">Inngest</span> — background jobs when Inngest Cloud is
            configured.
          </li>
          <li>
            <span className="font-semibold">PostgreSQL host</span> — primary datastore (local Docker
            today; managed Postgres is a P2 BLOCKER).
          </li>
        </ul>
      </Panel>
      <Panel title="DPA">
        <p className="text-sm text-ink/70">
          A Data Processing Agreement is not executed. Do not treat this page as contractual
          subprocessors notice until counsel signs a DPA that names the live providers.
        </p>
      </Panel>
    </main>
  );
}
