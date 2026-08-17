import { Badge } from "@nyayagrid/ui";

export type ProfessorSourceRef = {
  provenance: "UPLOADED_CASE" | "LEGAL_AUTHORITY" | "PROFESSOR_EXPLANATION";
  caseId?: string;
  chunkId?: string;
  authorityId?: string;
  page?: number | null;
  opinionPart?: string | null;
  quote?: string | null;
  note?: string;
};

export function sourceProvenanceLabel(source: ProfessorSourceRef): string {
  if (source.provenance === "UPLOADED_CASE") return "Your uploaded case";
  if (source.provenance === "LEGAL_AUTHORITY") return "Legal authority";
  return "Professor's explanation";
}

export function ProfessorSources({
  sources,
  onOpenChunk,
}: {
  sources: ProfessorSourceRef[];
  onOpenChunk?: (chunkId: string) => void;
}) {
  if (sources.length === 0) return null;
  return (
    <div className="mt-2 space-y-1 border-t border-line/60 pt-2">
      {sources.map((source, index) => {
        const clickable = Boolean(onOpenChunk && source.chunkId);
        return (
          <div key={`${source.chunkId ?? source.authorityId ?? source.note ?? index}`}>
            {clickable ? (
              <button
                type="button"
                className="text-left text-xs text-ink/70 hover:text-accent"
                onClick={() => source.chunkId && onOpenChunk?.(source.chunkId)}
              >
                <SourceInner source={source} />
              </button>
            ) : (
              <div className="text-xs text-ink/60">
                <SourceInner source={source} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function SourceInner({ source }: { source: ProfessorSourceRef }) {
  return (
    <>
      <Badge>{sourceProvenanceLabel(source)}</Badge>
      {source.opinionPart ? (
        <span className="ml-2 rounded-full bg-accent-soft px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-accent">
          {source.opinionPart}
        </span>
      ) : null}
      {source.quote ? <span className="ml-2 italic">&ldquo;{source.quote}&rdquo;</span> : null}
      {source.page ? <span className="ml-2">p.{source.page}</span> : null}
      {source.note ? <span className="ml-2">{source.note}</span> : null}
    </>
  );
}
