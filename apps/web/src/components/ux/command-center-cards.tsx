"use client";

import Link from "next/link";
import { Button, cx } from "@nyayagrid/ui";
import {
  STALE_ACTION_USER_MESSAGE,
  actionCardTitle,
  cancelPhraseForPendingAction,
  confirmPhraseForActionType,
  isSafeMatterNavigationRoute,
} from "@/lib/command-center-ux";

export type CommandCenterActionUx = {
  pendingActionId: string;
  actionType: string;
  actionClass: string;
  actionStatus: string;
  workflowStatus?: string;
  confirmationRequired: boolean;
  summary?: string;
  targetLabel?: string;
  sourceCount?: number;
  failureReason?: string | null;
  draftRoute?: string | null;
};

export type AmbiguityChoice = {
  label: string;
  entityType: string;
};

export function AmbiguityChooser({
  prompt,
  choices,
  onChoose,
  disabled,
}: {
  prompt: string;
  choices: AmbiguityChoice[];
  onChoose: (label: string) => void;
  disabled?: boolean;
}) {
  if (!choices.length) return null;
  return (
    <div
      className="mt-3 rounded-lg border border-line bg-black/[0.02] px-3 py-2.5"
      role="group"
      aria-label="Clarify which item you mean"
    >
      <p className="text-xs font-semibold text-ink/80">{prompt || "Which one do you mean?"}</p>
      <ul className="mt-2 space-y-1.5">
        {choices.map((choice) => (
          <li key={`${choice.entityType}:${choice.label}`}>
            <button
              type="button"
              disabled={disabled}
              className={cx(
                "w-full rounded-md border border-line bg-white px-3 py-2 text-left text-sm",
                "hover:border-accent/40 hover:bg-accent-soft/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                "disabled:cursor-not-allowed disabled:opacity-50",
              )}
              onClick={() => onChoose(choice.label)}
              aria-label={`Choose ${choice.label}`}
            >
              <span className="font-medium text-ink">{choice.label}</span>
              <span className="ml-2 text-[11px] uppercase tracking-wide text-ink/45">
                {choice.entityType.replace(/_/g, " ")}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function NavigationActionLink({
  matterId,
  label,
  route,
  kind,
}: {
  matterId: string;
  label: string;
  route: string;
  kind?: string;
}) {
  if (!isSafeMatterNavigationRoute(route, matterId)) {
    return (
      <p className="mt-2 text-xs text-ink/60" role="status">
        That workspace link is unavailable or no longer valid.
      </p>
    );
  }
  return (
    <div className="mt-3">
      <Link
        href={route}
        className={cx(
          "inline-flex items-center rounded-md border border-accent/30 bg-accent-soft/50 px-3 py-1.5",
          "text-sm font-semibold text-accent hover:bg-accent-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        )}
        aria-label={`Open ${label}`}
      >
        Open {label}
        {kind ? <span className="sr-only"> ({kind.replace(/_/g, " ")})</span> : null}
      </Link>
    </div>
  );
}

export function ActionConfirmationCard({
  matterId,
  action,
  disabled,
  onConfirm,
  onCancel,
}: {
  matterId: string;
  action: CommandCenterActionUx;
  disabled?: boolean;
  onConfirm: (phrase: string) => void;
  onCancel: (phrase: string) => void;
}) {
  const stale = action.actionStatus === "ACTION_CONFIRMATION_STALE";
  const awaiting =
    action.confirmationRequired &&
    (action.actionStatus === "AWAITING_CONFIRMATION" || action.actionStatus === "PREVIEW");
  const completed = action.actionStatus === "COMPLETED";
  const title = actionCardTitle(action.actionType, action.actionStatus);
  const confirmPhrase = confirmPhraseForActionType(action.actionType);
  const draftHref =
    action.draftRoute && isSafeMatterNavigationRoute(action.draftRoute, matterId)
      ? action.draftRoute
      : `/app/cases/${matterId}/draft`;

  return (
    <div
      className={cx(
        "mt-3 rounded-lg border px-3 py-2.5",
        stale ? "border-amber-700/30 bg-amber-50/70" : "border-line bg-black/[0.02]",
      )}
      role="region"
      aria-label={title}
    >
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink/55">{title}</p>
        {action.workflowStatus ? (
          <span className="rounded border border-line bg-white px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink/50">
            {action.workflowStatus.replace(/_/g, " ")}
          </span>
        ) : null}
      </div>
      {stale ? (
        <p className="mt-1.5 text-sm text-ink/80">{STALE_ACTION_USER_MESSAGE}</p>
      ) : null}
      {action.summary ? <p className="mt-1.5 text-sm text-ink/80">{action.summary}</p> : null}
      {action.targetLabel ? (
        <p className="mt-1 text-xs text-ink/60">
          Target: <span className="font-medium text-ink/80">{action.targetLabel}</span>
        </p>
      ) : null}
      {typeof action.sourceCount === "number" && action.sourceCount > 0 ? (
        <p className="mt-1 text-xs text-ink/60">
          Linked sources: {action.sourceCount}
        </p>
      ) : null}
      {action.failureReason ? (
        <p className="mt-1 text-xs text-[var(--ng-danger)]">{action.failureReason}</p>
      ) : null}
      {completed ? (
        <p className="mt-2 text-xs font-medium text-ink/70">Saved — open the specialized editor to continue.</p>
      ) : null}
      <div className="mt-2.5 flex flex-wrap gap-2">
        {awaiting ? (
          <>
            <Button
              type="button"
              disabled={disabled}
              onClick={() => onConfirm(confirmPhrase)}
              aria-label={`Confirm ${title}`}
            >
              Confirm
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={disabled}
              onClick={() => onCancel(cancelPhraseForPendingAction())}
              aria-label={`Cancel ${title}`}
            >
              Cancel
            </Button>
          </>
        ) : null}
        {stale ? (
          <Button
            type="button"
            variant="secondary"
            disabled={disabled}
            onClick={() => onConfirm("review the current preview")}
            aria-label="Review current preview"
          >
            Review current preview
          </Button>
        ) : null}
        {action.actionType.startsWith("DRAFT") || completed ? (
          <Link
            href={draftHref}
            className="inline-flex items-center rounded-md px-2 py-1 text-xs font-semibold text-accent underline"
          >
            Open Draft
          </Link>
        ) : null}
      </div>
      {awaiting ? (
        <p className="mt-2 text-[11px] text-ink/50">
          You can also type &ldquo;{confirmPhrase}&rdquo; in chat. Confirmation rechecks permissions.
        </p>
      ) : null}
    </div>
  );
}

export function CancelledTurnBanner() {
  return (
    <p
      className="mb-2 rounded border border-line bg-black/[0.03] px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-ink/55"
      role="status"
    >
      Cancelled — not used as authoritative context
    </p>
  );
}
