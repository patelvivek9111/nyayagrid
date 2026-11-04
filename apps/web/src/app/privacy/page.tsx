import type { Metadata } from "next";
import { PageHeader, Panel, Badge } from "@nyayagrid/ui";
import { CURRENT_PRIVACY_VERSION, LEGAL_DOCUMENT_STATUS } from "@nyayagrid/platform";

export const metadata: Metadata = {
  title: "Privacy Policy — NyayaGrid",
};

/**
 * Draft Privacy Policy describing implemented data practices.
 * Not attorney-reviewed. Do not invent certifications.
 */
export default function PrivacyPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-6 py-16">
      <PageHeader
        eyebrow="Legal"
        title="Privacy Policy"
        description="Draft policy describing what NyayaGrid collects and how export, deletion, and holds work in the product today."
      />
      <Badge>Draft — pending attorney review · version {CURRENT_PRIVACY_VERSION}</Badge>
      <p className="text-xs text-ink/55">Status: {LEGAL_DOCUMENT_STATUS.privacy}</p>

      <Panel title="1. What we collect">
        <p className="text-sm text-ink/70">
          Account identifiers (email, auth subject), organization and membership records, matter and
          criminal-case metadata, documents and evidence you upload, tasks/deadlines/notes,
          conversation and AI-usage metadata (token counts and identifiers — not prompt or document
          text in usage accounting), and audit/activity logs. Malware scan outcomes and document
          processing states are stored to enforce security gates.
        </p>
      </Panel>

      <Panel title="2. How we use it">
        <p className="text-sm text-ink/70">
          Data is used to operate NyayaGrid (matter/case management, document intelligence, research
          and drafting assistance), to authenticate users, to enforce permissions and malware/OCR
          processing, and to meter plan usage. It is not used to train NyayaGrid or third-party
          models without explicit, separately recorded consent.
        </p>
      </Panel>

      <Panel title="3. Legal holds">
        <p className="text-sm text-ink/70">
          An organization admin may place a legal hold on a matter, document, or organization. While
          a hold is active, covered data cannot be deleted — including via a data-deletion request —
          until the hold is released. This matches the product’s hold enforcement paths.
        </p>
      </Panel>

      <Panel title="4. Export and deletion">
        <p className="text-sm text-ink/70">
          Organization admins can request exports of organization-scoped records (matters, clients,
          prosecution cases, document metadata). Users may request export of account-scoped data
          where the product exposes that workflow. Deletion requests are reviewed against active
          holds and scheduled rather than executed immediately.
        </p>
      </Panel>

      <Panel title="5. Retention">
        <p className="text-sm text-ink/70">
          Retention follows your organization’s configuration and any active legal holds, subject to
          applicable record-keeping rules for legal practices and prosecution offices. Exact
          category-by-category periods will be finalized with counsel; this draft does not invent
          statutory retention certifications.
        </p>
      </Panel>

      <Panel title="6. Third parties and subprocessors">
        <p className="text-sm text-ink/70">
          Processors used when configured include: Clerk (authentication, optional MFA), model
          providers such as OpenAI for inference (chat store disabled where implemented), AWS S3 or
          equivalent object storage, ClamAV or equivalent malware scanning, Inngest for background
          jobs, email/SMTP when enabled, and the PostgreSQL host. See{" "}
          <a className="font-semibold text-accent underline" href="/subprocessors">
            Subprocessors
          </a>
          . Legal research corpus hosting (when separately enabled) uses a dedicated corpus database
          connection and is not a substitute for the product database.
        </p>
      </Panel>

      <Panel title="7. Security practices (verified in product)">
        <p className="text-sm text-ink/70">
          Transport encryption is expected at the TLS terminator. Application controls include
          tenant-scoped storage keys, role/capability checks, malware scanning gates before document
          availability, and audit events for sensitive actions. NyayaGrid does not claim SOC 2,
          CJIS, or HIPAA certification on this page.
        </p>
      </Panel>

      <Panel title="8. Your rights">
        <p className="text-sm text-ink/70">
          Depending on jurisdiction, you may have rights to access, correct, export, or delete
          personal data, subject to legal holds and legitimate retention needs of the organization
          that owns the matter or case.
        </p>
      </Panel>

      <Panel title="9. Contact">
        <p className="text-sm text-ink/70">
          Privacy requests: use your design-partner support channel or the privacy contact on your
          order / DPA when one exists. Do not email privileged documents to an unverified address.
        </p>
      </Panel>
    </main>
  );
}
