import { PROFESSOR_STUDY_AID_NOTICE } from "@/lib/professor-copy";

export function StudyAidNotice({ compact = false }: { compact?: boolean }) {
  return (
    <p
      className={
        compact
          ? "text-xs text-ink/60"
          : "rounded-lg border border-accent/30 bg-accent-soft/40 px-3 py-2 text-sm text-ink/80"
      }
      role="note"
    >
      {PROFESSOR_STUDY_AID_NOTICE}
    </p>
  );
}
