import { PageHeader, Panel } from "@nyayagrid/ui";

export default function GuideSafetyPage() {
  return (
    <>
      <PageHeader
        eyebrow="Nyaya Guide"
        title="Safety and Privacy"
        description="Nyaya Guide is a public legal-information tool. It is not a law firm and it is not your lawyer."
      />
      <div className="space-y-4">
        <Panel title="No attorney-client relationship">
          <p className="text-sm text-ink/70">
            Using Nyaya Guide does not create an attorney-client relationship or attorney-client
            privilege. Answers are legal information, not advice. A licensed attorney remains
            responsible for advice given to a client.
          </p>
        </Panel>
        <Panel title="High-stakes situations">
          <p className="text-sm text-ink/70">
            If you are facing eviction, arrest or detention, deportation, domestic violence, a child
            custody emergency, or an imminent court deadline, contact a qualified lawyer or the
            appropriate emergency service promptly. Guide cannot assess urgency for your facts.
          </p>
        </Panel>
        <Panel title="Dates and deadlines">
          <p className="text-sm text-ink/70">
            Guide only reports dates and amounts that are written in a document you uploaded. It
            never calculates a filing deadline from a start date.
          </p>
        </Panel>
        <Panel title="Your files">
          <p className="text-sm text-ink/70">
            Guide documents and conversations are scoped to your user account. They are not Case
            files, student case files, or a professional matter. Do not upload someone else’s
            confidential files without permission.
          </p>
        </Panel>
      </div>
    </>
  );
}
