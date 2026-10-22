import Link from "next/link";
import { AuthShell } from "@/components/ux/auth-shell";

export const dynamic = "force-dynamic";

/**
 * Public Clerk hosted registration is not offered for the private design-partner preview.
 * Operators still must disable public sign-up in the Clerk dashboard; this page does not link it.
 *
 * DevAuth renders the same invitation-only shell (no redirect) so the public contract stays
 * visible without requiring Clerk credentials in local/CI E2E.
 */
export default function SignUpPage() {
  return (
    <AuthShell
      title="Invitation only"
      description="This private preview does not offer public registration. Use the invitation your firm sent, then sign in."
    >
      <p className="rounded-md border border-line bg-white px-3 py-3 text-sm text-ink/80">
        Ask your firm administrator or NyayaGrid operator for an invitation. Self-service signup is
        not available on this environment.
      </p>
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
