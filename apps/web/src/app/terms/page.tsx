import type { Metadata } from "next";
import { PageHeader, Panel, Badge } from "@nyayagrid/ui";
import { CURRENT_TERMS_VERSION, LEGAL_DOCUMENT_STATUS } from "@nyayagrid/platform";

export const metadata: Metadata = {
  title: "Terms of Service — NyayaGrid",
};

/**
 * Draft Terms reflecting implemented product behavior.
 * Not a binding agreement until independent attorney review and sign-off.
 */
export default function TermsPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-6 py-16">
      <PageHeader
        eyebrow="Legal"
        title="Terms of Service"
        description="Draft terms describing how NyayaGrid is offered today. Counsel has not approved a final agreement."
      />
      <Badge>Draft — pending attorney review · version {CURRENT_TERMS_VERSION}</Badge>
      <p className="text-xs text-ink/55">Status: {LEGAL_DOCUMENT_STATUS.terms}</p>

      <Panel title="Private design-partner preview">
        <p className="text-sm text-ink/70">
          NyayaGrid is offered as a private, invite-only design-partner preview at NyayaGrid.com. It
          is not general availability. Features may change. Multi-step autonomous agents that send,
          file, sign, or submit work without a human are off. NyayaGrid does not provide autonomous
          legal representation.
        </p>
      </Panel>

      <Panel title="1. Acceptance">
        <p className="text-sm text-ink/70">
          Accessing a NyayaGrid organization account after sign-in constitutes acknowledgment of
          this draft. Where the product records acceptance, it stores the document version string (
          {CURRENT_TERMS_VERSION}) and an audit event. Versioned acceptance is an operational
          control, not counsel approval of these terms.
        </p>
      </Panel>

      <Panel title="2. Workspaces and service limitations">
        <p className="text-sm text-ink/70">
          Nyaya Professional supports law firms and solo lawyers (matters, documents, research,
          drafting, tasks). Nyaya Prosecution supports district attorney / prosecution offices
          (criminal cases, evidence, discovery tracking). Removed product surfaces — student /
          public / professor / guide workspaces — are out of scope. Corporate legal department,
          insurance, and general enterprise workspaces are not offered unless separately contracted.
        </p>
        <p className="mt-3 text-sm text-ink/70">
          Nyaya Prosecution does not issue guilt verdicts or probability-of-guilt scores, and does
          not autonomously charge, plead, disclose Brady/Giglio material, or file. Consequential
          prosecution decisions remain human-controlled. NyayaGrid does not claim CJIS or government
          certification unless separately and explicitly achieved.
        </p>
      </Panel>

      <Panel title="3. AI-generated research and drafting">
        <p className="text-sm text-ink/70">
          Nyaya (the conversational AI inside NyayaGrid) produces draft work product. Outputs may
          omit authorities, misread sources, or reflect incomplete corpus coverage. Research is not
          a Westlaw or Lexis equivalent. Every legal answer based on retrieved sources must be
          checked against those sources before reliance, filing, or client communication. Human
          attorney (or authorized prosecutor) review is required before sending, filing, signing, or
          publishing. See also the{" "}
          <a className="font-semibold text-accent underline" href="/ai-disclosure">
            AI Disclosure
          </a>
          .
        </p>
      </Panel>

      <Panel title="4. Client data and confidentiality">
        <p className="text-sm text-ink/70">
          Matter and case data are tenant-scoped. Access is enforced by organization membership,
          roles/capabilities, and matter or criminal-case permissions. You remain responsible for
          configuring access and for compliance with applicable rules of professional conduct.
          Customer data is not used to train NyayaGrid or third-party models without explicit,
          separately recorded consent.
        </p>
      </Panel>

      <Panel title="5. Uploads and security controls">
        <p className="text-sm text-ink/70">
          Uploads are subject to size and type limits, archive rejection, PDF integrity checks, and
          malware scanning when configured. Documents that fail malware scanning are not made
          available to research, drafting, or evidence workflows. Scanning availability is
          fail-closed outside development/test. See the Privacy Policy and Subprocessors list for
          processors involved.
        </p>
      </Panel>

      <Panel title="6. Fees and billing">
        <p className="text-sm text-ink/70">
          Subscription and usage metering follow the plan configured for your organization. Client
          or case file access is not withheld solely for non-payment of AI usage overages; billing
          disputes are handled through organization administration and support channels described in
          your order form (when present).
        </p>
      </Panel>

      <Panel title="7. Disclaimers">
        <p className="text-sm text-ink/70">
          To the maximum extent permitted by law, NyayaGrid is provided “as is” during this preview.
          NyayaGrid does not guarantee legal outcomes, citation completeness, OCR accuracy, or
          uninterrupted availability. Limitation-of-liability language will be finalized by counsel.
          This page is not legal advice about your use of the product.
        </p>
      </Panel>

      <Panel title="8. Contact">
        <p className="text-sm text-ink/70">
          Security and product concerns: use the in-product support channel for your design-partner
          engagement, or the contact address listed on your order / MSA when one exists. Do not send
          privileged matter contents to a public inbox unless your engagement expressly allows it.
        </p>
      </Panel>
    </main>
  );
}
