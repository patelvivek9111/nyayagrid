import type { Metadata } from "next";
import { PageHeader, Panel, Badge } from "@nyayagrid/ui";

export const metadata: Metadata = {
  title: "Privacy Policy — NyayaGrid",
};

/**
 * Placeholder legal page. Describes the data-lifecycle mechanisms that already exist in the
 * product (legal holds, deletion requests, data export) in plain language, but the legal
 * commitments below are structural placeholders, not attorney-reviewed policy language.
 */
export default function PrivacyPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-6 py-16">
      <PageHeader
        eyebrow="Legal"
        title="Privacy Policy"
        description="Placeholder policy describing what data NyayaGrid holds and how it can be exported or deleted."
      />
      <Badge>Draft — pending attorney review</Badge>
      <Panel title="1. What we collect">
        <p className="text-sm text-ink/70">
          Placeholder. Account and organization identifiers, matter/client records and documents you
          or your organization upload, conversation and AI-usage metadata (never document text or
          prompts — see AI Disclosure), and audit/activity logs.
        </p>
      </Panel>
      <Panel title="2. How we use it">
        <p className="text-sm text-ink/70">
          Placeholder. Data is used to provide the product (matter management, document
          intelligence, AI-assisted drafting/research), to secure accounts, and to meter usage
          against your organization&apos;s plan. It is never used to train third-party models
          without explicit, separate consent.
        </p>
      </Panel>
      <Panel title="3. Legal holds">
        <p className="text-sm text-ink/70">
          Placeholder. An organization admin may place a legal hold on a matter, a document, or the
          whole organization. While a hold is active, the data it covers cannot be deleted —
          including via a data deletion request — until the hold is released.
        </p>
      </Panel>
      <Panel title="4. Data export and deletion">
        <p className="text-sm text-ink/70">
          Placeholder. An organization admin can request an export of the organization&apos;s
          matters, clients and document metadata, or a user can request an export of their own Nyaya
          Professor / Nyaya Guide data. Deletion requests are reviewed, checked against any active
          legal hold, and — once approved — scheduled rather than executed immediately.
        </p>
      </Panel>
      <Panel title="5. Data retention">
        <p className="text-sm text-ink/70">
          Placeholder. Retention periods by data category will be documented here, subject to legal
          holds and applicable record-keeping rules for legal practices.
        </p>
      </Panel>
      <Panel title="6. Third parties and subprocessors">
        <p className="text-sm text-ink/70">
          Placeholder. This section will list infrastructure and AI-provider subprocessors and the
          safeguards applied to any data shared with them.
        </p>
      </Panel>
      <Panel title="7. Your rights">
        <p className="text-sm text-ink/70">
          Placeholder. Depending on jurisdiction, you may have rights to access, correct, export or
          delete your personal data, subject to the legal-hold exception described above.
        </p>
      </Panel>
      <Panel title="8. Contact">
        <p className="text-sm text-ink/70">Placeholder contact details for privacy requests.</p>
      </Panel>
    </main>
  );
}
