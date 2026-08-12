import type { Metadata } from "next";
import { PageHeader, Panel, Badge } from "@nyayagrid/ui";

export const metadata: Metadata = {
  title: "Terms of Service — NyayaGrid",
};

/**
 * Placeholder legal page. The prose below is a structural draft only — it names the sections a
 * real Terms of Service needs, not language that has been reviewed by counsel. Do not treat this
 * as binding, and do not remove the draft notice until an attorney has signed off on real text.
 */
export default function TermsPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-6 py-16">
      <PageHeader
        eyebrow="Legal"
        title="Terms of Service"
        description="Placeholder terms outlining the sections a production agreement will cover."
      />
      <Badge>Draft — pending attorney review</Badge>
      <Panel title="1. Acceptance of terms">
        <p className="text-sm text-ink/70">
          Placeholder. This section will describe who may use NyayaGrid, how these terms are
          accepted, and what happens when they change.
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
          go here after review by counsel qualified in the relevant jurisdiction(s).
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
