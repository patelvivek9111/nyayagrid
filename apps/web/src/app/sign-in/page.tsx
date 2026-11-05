import Link from "next/link";
import {
  InviteError,
  lookupLiveOrganizationInviteByToken,
  USER_FACING_AUTH,
  userFacingInviteMessage,
} from "@nyayagrid/auth";
import { AuthShell } from "@/components/ux/auth-shell";
import {
  clerkHostedSignInUrl,
  clerkHostedSignUpUrl,
  inviteAuthContinueHref,
  inviteTokenFromReturnTo,
  isClerkAccountPortalUrl,
  isClerkUiConfigured,
  safeAuthReturnTo,
} from "@/lib/auth-return";
import { resolveClerkInvitedSignupFromEnv } from "@/lib/clerk-invitations";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

function firstQuery(value: string | string[] | undefined): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return null;
}

function noticeForReason(reason: string | null): string | null {
  if (reason === "session" || reason === "expired") return USER_FACING_AUTH.sessionExpired;
  if (reason === "forbidden") return USER_FACING_AUTH.forbidden;
  return null;
}

/**
 * DevAuth has no hosted identity UI. Still render the Sign-in shell so session notices and
 * invitation links remain reachable (including after /sign-out), with a Continue CTA into /app.
 */
function DevAuthSignIn({ notice }: { notice: string | null }) {
  return (
    <AuthShell
      title="Sign in"
      description="Use the account your firm invited. After you sign in, you’ll return to your workspace."
      notice={notice}
    >
      <p>
        <Link
          href="/app"
          className="inline-flex min-h-11 items-center justify-center rounded-md bg-accent px-4 text-sm font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Continue to workspace
        </Link>
      </p>
      <p className="text-sm text-ink/60">
        Have an invitation?{" "}
        <Link className="font-semibold text-accent underline" href="/invites/accept">
          Accept invitation
        </Link>
      </p>
    </AuthShell>
  );
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const notice = noticeForReason(firstQuery(query.reason));

  if ((process.env.AUTH_PROVIDER ?? "dev") !== "clerk") {
    return <DevAuthSignIn notice={notice} />;
  }

  const returnTo = safeAuthReturnTo(firstQuery(query.returnTo));
  let pageNotice = notice;
  const hosted = clerkHostedSignInUrl();
  const configured = isClerkUiConfigured();
  const continueHref = configured && hosted ? inviteAuthContinueHref(returnTo, "signin") : null;
  let createAccountHref: string | null = null;
  const inviteToken = configured && hosted ? inviteTokenFromReturnTo(returnTo) : null;

  if (inviteToken && hosted) {
    try {
      const invite = await lookupLiveOrganizationInviteByToken(getDb(), inviteToken);
      const portal = clerkHostedSignUpUrl();
      const clerkState = await resolveClerkInvitedSignupFromEnv(
        invite.email,
        portal && isClerkAccountPortalUrl(portal, hosted) ? portal : undefined,
      );
      if (!clerkState.clerkUserExists) {
        createAccountHref = inviteAuthContinueHref(returnTo, "signup");
      }
    } catch (error) {
      if (error instanceof InviteError) {
        pageNotice = userFacingInviteMessage(error.code);
      }
    }
  }

  return (
    <AuthShell
      title="Sign in"
      description={
        inviteToken
          ? "Use the email your firm invited. If you do not have an account yet, create one with that same email."
          : "Use the account your firm invited. After you sign in, you’ll return to your workspace."
      }
      notice={pageNotice}
    >
      {continueHref ? (
        <p>
          <Link
            href={continueHref}
            className="inline-flex min-h-11 items-center justify-center rounded-md bg-accent px-4 text-sm font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Continue
          </Link>
        </p>
      ) : (
        <p
          className="rounded-md border border-line bg-white px-3 py-3 text-sm text-ink/80"
          role="alert"
        >
          {USER_FACING_AUTH.unavailable}
        </p>
      )}
      {createAccountHref ? (
        <p className="text-sm text-ink/80">
          New to NyayaGrid?{" "}
          <Link className="font-semibold text-accent underline" href={createAccountHref}>
            Create account
          </Link>{" "}
          with the invited email. Public registration is not available.
        </p>
      ) : null}
      <p className="text-sm text-ink/60">
        Have an invitation?{" "}
        <Link className="font-semibold text-accent underline" href="/invites/accept">
          Accept invitation
        </Link>
      </p>
    </AuthShell>
  );
}
