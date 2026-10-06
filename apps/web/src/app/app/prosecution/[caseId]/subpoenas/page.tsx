"use client";

import { useParams } from "next/navigation";
import { ProfessionalShell } from "@/components/shell";
import { ProsecutionSection } from "@/components/prosecution/case-section";

export default function ProsecutionSubpoenasPage() {
  const params = useParams<{ caseId: string }>();
  return (
    <ProfessionalShell>
      <ProsecutionSection caseId={params.caseId} section="subpoenas" />
    </ProfessionalShell>
  );
}
