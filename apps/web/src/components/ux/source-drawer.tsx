"use client";

import type { ReactNode } from "react";
import { useParams } from "next/navigation";
import { Button, cx } from "@nyayagrid/ui";
import { openMatterDocument } from "@/lib/document-open";

export type SourceDrawerItem = {
  id: string;
  title: string;
  classLabel: string;
  subtitle?: string;
  quote?: string;
  href?: string;
  /** When true, show that the quote passed verbatim verification */
  quoteVerified?: boolean;
  chunkId?: string;
  documentId?: string;
};

export function SourceDrawer({
  open,
  onClose,
  title = "Sources",
  items,
  activeId,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  items?: SourceDrawerItem[];
  activeId?: string;
  children?: ReactNode;
}) {
  const params = useParams<{ matterId?: string }>();
  const matterId = params.matterId;

  async function openOriginal(documentId: string, disposition: "inline" | "attachment") {
    if (!matterId) return;
    try {
      await openMatterDocument({ matterId, documentId, disposition });
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Could not open the original file");
    }
  }

  if (!open) return null;

  return (
    <>
      <button
        type="button"
        className="fixed inset-0 z-40 bg-ink/20 md:hidden"
        aria-label="Close sources"
        onClick={onClose}
      />
      <aside
        className={cx(
          "fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-line bg-white shadow-lg",
          "md:static md:z-0 md:max-w-sm md:shadow-none",
        )}
        aria-label={title}
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="font-display text-lg text-ink">{title}</h2>
          <Button type="button" variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {children}
          {items?.map((item, i) => (
            <article
              key={item.id}
              className={cx(
                "mb-3 rounded-lg border border-line p-3 text-sm",
                activeId === item.id && "border-accent bg-accent-soft/30",
              )}
            >
              <p className="text-[10px] font-semibold uppercase tracking-wide text-ink/45">
                Source {i + 1} · {item.classLabel}
              </p>
              <h3 className="mt-1 font-semibold text-ink">{item.title}</h3>
              {item.subtitle ? <p className="mt-0.5 text-xs text-ink/55">{item.subtitle}</p> : null}
              {item.quote ? (
                <blockquote className="mt-2 border-l-2 border-line pl-3 text-ink/75">
                  {item.quote}
                </blockquote>
              ) : null}
              {item.quoteVerified ? (
                <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-accent">
                  Verbatim in cited chunk
                </p>
              ) : null}
              {item.documentId && matterId ? (
                <div className="mt-2 flex flex-wrap gap-3">
                  <button
                    type="button"
                    className="text-xs font-semibold text-accent underline"
                    onClick={() => {
                      void openOriginal(item.documentId!, "inline");
                    }}
                  >
                    Open original
                  </button>
                  <button
                    type="button"
                    className="text-xs font-semibold text-accent underline"
                    onClick={() => {
                      void openOriginal(item.documentId!, "attachment");
                    }}
                  >
                    Download
                  </button>
                </div>
              ) : item.href ? (
                <a
                  href={item.href}
                  className="mt-2 inline-block text-xs font-semibold text-accent underline"
                >
                  Open document
                </a>
              ) : null}
            </article>
          ))}
          {!children && (!items || items.length === 0) ? (
            <p className="text-sm text-ink/55">No sources for this item.</p>
          ) : null}
        </div>
      </aside>
    </>
  );
}

export function IntelligenceStatus({
  verified,
  suggested,
  conflicting,
}: {
  verified: number;
  suggested: number;
  conflicting?: number;
}) {
  return (
    <div className="rounded-lg border border-line bg-white px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-accent">
        Case Intelligence
      </p>
      <ul className="mt-2 space-y-1 text-sm text-ink/80">
        <li>✓ {verified} Verified</li>
        <li>◇ {suggested} Suggestions to review</li>
        {typeof conflicting === "number" && conflicting > 0 ? (
          <li>⚠ {conflicting} Conflicting evidence items</li>
        ) : null}
      </ul>
    </div>
  );
}

export function ReviewSuggestionCard({
  title,
  detail,
  counts,
  href,
}: {
  title: string;
  detail?: string;
  counts?: string[];
  href: string;
}) {
  return (
    <a
      href={href}
      className="block rounded-lg border border-amber-700/20 bg-amber-50/60 px-4 py-3 transition hover:border-amber-700/40"
    >
      <p className="font-semibold text-ink">{title}</p>
      {detail ? <p className="mt-1 text-sm text-ink/70">{detail}</p> : null}
      {counts && counts.length > 0 ? (
        <ul className="mt-2 list-inside list-disc text-xs text-ink/60">
          {counts.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      ) : null}
      <p className="mt-2 text-xs font-semibold text-accent">Review suggestions →</p>
    </a>
  );
}

export function WorkRunCard({
  title,
  status,
  progress,
  href,
}: {
  title: string;
  status: string;
  progress?: string;
  href: string;
}) {
  return (
    <a
      href={href}
      className="block rounded-lg border border-line bg-white px-4 py-3 transition hover:border-accent/40"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="font-semibold text-ink">{title}</p>
        <span className="text-[11px] font-semibold uppercase tracking-wide text-ink/50">
          {status}
        </span>
      </div>
      {progress ? <p className="mt-1 text-sm text-ink/60">{progress}</p> : null}
    </a>
  );
}
