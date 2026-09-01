import Link from "next/link";
import { USER_FACING_AUTH } from "@nyayagrid/auth/user-facing";
import { AuthShell } from "@/components/ux/auth-shell";
import { clerkHostedSignUpUrl, isClerkPublishableConfigured } from "@/lib/auth-return";

export default function SignUpPage() {
  const hosted = clerkHostedSignUpUrl();
  const available = Boolean(hosted && isClerkPublishableConfigured());

  return (
    <AuthShell
      title="Create an account"
      description="NyayaGrid is invitation-only for professional workspaces. Sign in if you already have an account, or accept an invitation from your firm."
    >
      {available && hosted ? (
        <p>
          <Link
            href={hosted}
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
        Already invited?{" "}
        <Link className="font-semibold text-accent underline" href="/sign-in">
          Sign in
        </Link>
        {" · "}
        <Link className="font-semibold text-accent underline" href="/invites/accept">
          Accept invitation
        </Link>
      </p>
    </AuthShell>
  );
}
