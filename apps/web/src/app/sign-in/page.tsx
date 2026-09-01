import { headers } from "next/headers";
import Link from "next/link";
import { USER_FACING_AUTH } from "@nyayagrid/auth/user-facing";
import { AuthShell } from "@/components/ux/auth-shell";
import {
  clerkContinueHref,
  clerkHostedSignInUrl,
  isClerkUiConfigured,
  safeAuthReturnTo,
} from "@/lib/auth-return";

function firstQuery(
  value: string | string[] | undefined,
): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return null;
}

function appOriginFromHeaders(headerList: Headers): string {
  const proto = headerList.get("x-forwarded-proto") ?? "http";
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host");
  if (host) return `${proto}://${host}`;
  return process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "") ?? "http://127.0.0.1:3000";
}

function noticeForReason(reason: string | null): string | null {
  if (reason === "session" || reason === "expired") return USER_FACING_AUTH.sessionExpired;
  if (reason === "forbidden") return USER_FACING_AUTH.forbidden;
  return null;
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const returnTo = safeAuthReturnTo(firstQuery(query.returnTo));
  const notice = noticeForReason(firstQuery(query.reason));
  const hosted = clerkHostedSignInUrl();
  const configured = isClerkUiConfigured();
  const headerList = await headers();
  const continueHref =
    configured && hosted ? clerkContinueHref(hosted, returnTo, appOriginFromHeaders(headerList)) : null;

  return (
    <AuthShell
      title="Sign in"
      description="Use the account your firm invited. After you sign in, you’ll return to your workspace."
      notice={notice}
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
        <p className="rounded-md border border-line bg-white px-3 py-3 text-sm text-ink/80" role="alert">
          {USER_FACING_AUTH.unavailable}
        </p>
      )}
      <p className="text-sm text-ink/60">
        Have an invitation?{" "}
        <Link className="font-semibold text-accent underline" href="/invites/accept">
          Accept invitation
        </Link>
      </p>
    </AuthShell>
  );
}
