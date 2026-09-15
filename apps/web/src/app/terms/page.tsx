import type { Metadata } from "next";
import { PageHeader, Panel, Badge } from "@nyayagrid/ui";

export const metadata: Metadata = {
  title: "Terms of Service — NyayaGrid",
};

/**
 * Placeholder legal page. Counsel has not approved a Terms of Service. The preview notice is
 * operational product status, not a lawyer-reviewed contract. Do not treat this page as binding.
 */
export default function TermsPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-6 py-16">
      <PageHeader
        eyebrow="Legal"
        title="Terms of Service"
        description="Draft only. Counsel has not approved these terms. The preview notice below describes how this private environment is offered today."
      />
      <Badge>Draft — pending attorney review · not a binding agreement</Badge>
      <Panel title="Private design-partner preview">
        <p className="text-sm text-ink/70">
          NyayaGrid is offered here as a private, invite-only design-partner preview. It is not a
          public launch and not general availability. The service may change during this preview.
          Multi-step AI agents are off. NyayaGrid does not provide autonomous legal representation
          and does not send, file, sign, or submit work without a human.
        </p>
        <p className="mt-3 text-sm text-ink/70">
          Outputs require professional review. Research coverage is not exhaustive and is not a
          Westlaw or Lexis equivalent. You are responsible for checking cited sources before relying
          on, filing, or sending any result. Handling of confidential information follows the
          product controls described in the{" "}
          <a className="font-semibold text-accent underline" href="/ai-disclosure">
            AI Disclosure
          </a>{" "}
          and Privacy pages — not a counsel-approved confidentiality agreement on this page.
        </p>
      </Panel>
      <Panel title="1. Acceptance of terms">
        <p className="text-sm text-ink/70">
          Placeholder. This section will describe who may use NyayaGrid, how these terms are
          accepted, and what happens when they change. It is not in force until counsel signs off.
        </p>
      </Panel>
      <Panel title="2. Description of service">
        <p className="text-sm text-ink/70">
          Placeholder. NyayaGrid provides matter management, document intelligence and AI-assisted
          drafting/research tools for the Professional workspace, and separate Nyaya Professor
          (student) and Nyaya Guide (public) workspaces. None of these tools provide legal advice on
          their own; a licensed attorney remains responsible for advice given to a client.
        </p>
      </Panel>
      <Panel title="3. Client data and confidentiality">
        <p className="text-sm text-ink/70">
          Placeholder. This section will describe how matter and client data is stored, who may
          access it, retention and deletion (see legal holds and data deletion requests), and
          confidentiality obligations consistent with applicable rules of professional conduct.
        </p>
      </Panel>
      <Panel title="4. AI-generated content">
        <p className="text-sm text-ink/70">
          Placeholder — see also the{" "}
          <a className="font-semibold text-accent underline" href="/ai-disclosure">
            AI Disclosure
          </a>{" "}
          page. AI output must be reviewed before it is relied upon or filed.
        </p>
      </Panel>
      <Panel title="5. Fees, plans and billing">
        <p className="text-sm text-ink/70">
          Placeholder. This section will describe subscription plans, billing cycles, and what
          happens to access when a subscription lapses (client data access is never withheld for
          non-payment; see the Privacy Policy).
        </p>
      </Panel>
      <Panel title="6. Limitation of liability">
        <p className="text-sm text-ink/70">
          Placeholder. Standard limitation-of-liability and disclaimer-of-warranties language will
          go here after review by counsel qualified in the relevant jurisdiction(s). This page does
          not currently state a limitation of liability.
        </p>
      </Panel>
      <Panel title="7. Governing law and disputes">
        <p className="text-sm text-ink/70">
          Placeholder. Governing law, venue and dispute-resolution terms to be finalized by counsel.
        </p>
      </Panel>
      <Panel title="8. Contact">
        <p className="text-sm text-ink/70">Placeholder contact details for legal notices.</p>
      </Panel>
    </main>
  );
}
