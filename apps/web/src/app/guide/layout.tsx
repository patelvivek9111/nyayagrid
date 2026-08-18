import { isFeatureEnabled } from "@nyayagrid/platform";
import { GuideChrome } from "@/components/ux/guide-chrome";

export default function GuideLayout({ children }: { children: React.ReactNode }) {
  if (!isFeatureEnabled("guide")) {
    return (
      <main className="mx-auto max-w-xl px-6 py-16">
        <h1 className="font-display text-3xl text-ink">Nyaya Guide is not enabled</h1>
        <p className="mt-3 text-sm text-ink/70">
          This deployment has Guide turned off (`FEATURE_GUIDE`) until production trust and legal
          review of public-workspace copy are complete.
        </p>
      </main>
    );
  }
  return <GuideChrome>{children}</GuideChrome>;
}
