import type { Metadata } from "next";
import { PageHeader, Panel, Badge } from "@nyayagrid/ui";

export const metadata: Metadata = {
  title: "AI Disclosure — NyayaGrid",
};

/**
 * Placeholder legal page. Explains, in plain language, how AI is actually used in the product
 * today (grounded Q&A, drafting assistance, extraction) so it stays accurate as features change.
 * The commitments below are structural placeholders pending attorney review, not final policy.
 */
export default function AiDisclosurePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-6 py-16">
      <PageHeader
        eyebrow="Legal"
        title="AI Disclosure"
        description="How NyayaGrid uses AI, what it can and cannot do, and why a human must review its output."
      />
      <Badge>Draft — pending attorney review</Badge>
      <Panel title="1. AI is an assistant, not counsel">
        <p className="text-sm text-ink/70">
          Placeholder. Nyaya (the Professional workspace assistant), Nyaya Professor and Nyaya Guide
          generate drafts, summaries and answers to help a person do legal work faster. None of them
          are a lawyer, none of them provide legal advice, and none of their output should be relied
          upon, filed or communicated to a client without review by a qualified human.
        </p>
      </Panel>
      <Panel title="2. Answers are grounded in your documents">
        <p className="text-sm text-ink/70">
          Placeholder. When Nyaya answers a question about a matter, it is instructed to answer only
          from the documents retrieved for that matter and to say so explicitly when the available
          documents do not contain enough information — rather than filling the gap from the
          model&apos;s general training data.
        </p>
      </Panel>
      <Panel title="3. Human review of agent actions">
        <p className="text-sm text-ink/70">
          Placeholder. Multi-step AI agent runs propose a plan and require explicit approval before
          taking actions that write to a matter, and every AI-generated artifact is labeled as such
          in the product.
        </p>
      </Panel>
      <Panel title="4. Model providers and data handling">
        <p className="text-sm text-ink/70">
          When <code>AI_PROVIDER=openai</code>, NyayaGrid sends retrieved excerpts to OpenAI chat
          completions with <code>store: false</code>. Usage accounting stores token counts and
          identifiers only — prompt and document text keys are stripped. Customer data is not used
          to train NyayaGrid or provider models unless a separate training-consent record is filed;
          this build still has no training pipeline even if consent is recorded.
        </p>
      </Panel>
      <Panel title="5. Usage accounting">
        <p className="text-sm text-ink/70">
          Placeholder. NyayaGrid records which AI capability was used, by whom, and roughly how many
          tokens it consumed, for billing and reliability purposes. It does not retain the prompt or
          response text in that accounting record.
        </p>
      </Panel>
      <Panel title="6. Reporting a problem">
        <p className="text-sm text-ink/70">
          Placeholder contact details for reporting an inaccurate or unexpected AI response.
        </p>
      </Panel>
    </main>
  );
}
