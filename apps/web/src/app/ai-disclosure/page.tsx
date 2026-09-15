import type { Metadata } from "next";
import { PageHeader, Panel, Badge } from "@nyayagrid/ui";

export const metadata: Metadata = {
  title: "AI Disclosure — NyayaGrid",
};

/**
 * Operational disclosure for professional users. Counsel has not signed a final Terms of Service.
 * Keep this page accurate to product behavior; do not claim certifications NyayaGrid does not have.
 */
export default function AiDisclosurePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-6 py-16">
      <PageHeader
        eyebrow="Legal"
        title="AI Disclosure"
        description="How NyayaGrid uses AI, what it can and cannot do, and why a human must review its output."
      />
      <Badge>Private preview — pending attorney-reviewed terms</Badge>
      <Panel title="1. NyayaGrid assists legal professionals">
        <p className="text-sm text-ink/70">
          NyayaGrid is an attorney-assistance workspace. Nyaya drafts, summarizes, and answers from
          retrieved sources to help lawyers, staff, and other qualified users move a matter forward.
          It is not autonomous counsel, not a filing system, and not a substitute for professional
          judgment. Output remains draft work product until a qualified person reviews it.
        </p>
      </Panel>
      <Panel title="2. Review sources before you rely on a conclusion">
        <p className="text-sm text-ink/70">
          Important conclusions should be checked against the cited source, not accepted because the
          prose sounds professional. Case Ask is instructed to stay inside retrieved matter files
          and to label answers as grounded, partial, or insufficient. When evidence is missing or
          conflicted, Nyaya should abstain or present both accounts. Do not treat silence in the
          file — or a miss in research — as proof that a fact or authority does not exist.
        </p>
      </Panel>
      <Panel title="3. Research coverage">
        <p className="text-sm text-ink/70">
          Nyaya Research searches the legal authorities imported into this workspace. Coverage is
          not exhaustive and is not a Westlaw or Lexis equivalent. Current treatment is not
          independently verified. Use Research as a starting point against this corpus, then verify
          controlling authority in the sources you would ordinarily use.
        </p>
      </Panel>
      <Panel title="4. Agents">
        <p className="text-sm text-ink/70">
          Multi-step AI agents are off for this private preview. Nyaya does not send, file, sign, or
          submit work without a human.
        </p>
      </Panel>
      <Panel title="5. Model providers and data handling">
        <p className="text-sm text-ink/70">
          Retrieved excerpts may be sent to configured model providers for the requested task.
          Usage accounting stores token counts and identifiers — not prompt or document text.
          Customer data is not used to train NyayaGrid models unless a separate training-consent
          record is filed. This preview is not marketed as CJIS-ready or prosecutor-certified.
        </p>
      </Panel>
      <Panel title="6. Reporting a problem">
        <p className="text-sm text-ink/70">
          Tell your NyayaGrid contact immediately if you see fabricated authority or exhibits,
          material unsupported facts, or any sign that one case or organization&apos;s material
          appeared in another. Use the design-partner session form for other product feedback.
        </p>
      </Panel>
    </main>
  );
}
