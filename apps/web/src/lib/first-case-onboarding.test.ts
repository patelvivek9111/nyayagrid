import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const webRoot = resolve(__dirname, "../..");

function src(relativeFromWeb: string): string {
  return readFileSync(resolve(webRoot, relativeFromWeb), "utf8");
}

describe("First Case onboarding", () => {
  const onboarding = src("src/app/app/onboarding/page.tsx");
  const appAsk = src("src/app/app/page.tsx");
  const newCase = src("src/app/app/cases/new/page.tsx");
  const cases = src("src/app/app/cases/page.tsx");
  const home = src("src/app/app/cases/[matterId]/page.tsx");
  const chats = src("src/app/app/cases/[matterId]/chats/page.tsx");
  const documents = src("src/app/app/cases/[matterId]/documents/page.tsx");
  const invite = src("src/app/invites/accept/page.tsx");
  const orgPost = src("src/app/api/v1/organizations/route.ts");

  it("B. successful firm creation continues to Case creation", () => {
    expect(onboarding).toContain('router.replace("/app/cases/new")');
    expect(onboarding).toContain("reloadOrganizations");
    expect(onboarding).toContain("selectOrganization");
    expect(onboarding).toContain("ORGANIZATION_SLUG_HTML_PATTERN");
    expect(onboarding).toContain("normalizeOrganizationSlugInput");
  });

  it("E. existing org skips the create-firm form", () => {
    expect(onboarding).toContain("continueHref");
    expect(onboarding).toContain("organizations.length > 0");
  });

  it("F. Case created enters the Case workspace", () => {
    expect(newCase).toContain("router.push(`/app/cases/${data.matter.id}`)");
  });

  it("G. first Case has an Upload Documents CTA", () => {
    expect(home).toContain("Upload documents");
    expect(home).toContain("Start by adding the documents for this Case");
  });

  it("H. first-use Ask CTA is Case-scoped", () => {
    expect(home).toContain("Ask about this Case");
    expect(home).toContain("`/app/cases/${matterId}/chats`");
    expect(chats).toContain("Ask Nyaya about this Case");
    expect(home).not.toContain('href="/app"');
  });

  it("I/J. refresh does not POST org or Case merely by opening the form", () => {
    expect(onboarding).toContain("onSubmit");
    expect(newCase).toContain("onSubmit");
    const onboardMount = onboarding.slice(
      onboarding.indexOf("useEffect(() => {"),
      onboarding.indexOf("async function onSubmit"),
    );
    expect(onboardMount).not.toContain('method: "POST"');
    const newCaseMount = newCase.slice(
      newCase.indexOf("useEffect(() => {"),
      newCase.indexOf("async function ensureClientId"),
    );
    expect(newCaseMount).not.toContain('method: "POST"');
  });

  it("K. unauthorized users do not see Case creation as the only path", () => {
    expect(newCase).toContain("You do not have permission to create a Case");
    expect(cases).toContain("canCreate");
    expect(cases).toContain("matters.create");
  });

  it("L. client guest follows portal routing", () => {
    expect(appAsk).toContain("genericAskRedirect");
    expect(cases).toContain("isClientGuestRole");
    expect(cases).toContain('router.replace("/portal")');
    expect(invite).toContain('href="/sign-in"');
  });

  it("M. onboarding does not alter Review semantics", () => {
    const reviewApi = src("src/app/api/v1/matters/[matterId]/intelligence/review/route.ts");
    expect(reviewApi).toContain("export async function GET");
    expect(reviewApi).not.toContain("export async function POST");
    expect(onboarding).not.toContain("reviewMatterMemory");
    expect(onboarding).not.toContain("getReviewQueueCounts");
  });

  it("N. Agents-off gating is unchanged", () => {
    const ask = src("src/app/api/v1/matters/[matterId]/ask/route.ts");
    expect(ask).toContain('isFeatureEnabled("agents")');
  });

  it("O. onboarding pages do not call AI endpoints", () => {
    expect(onboarding).not.toContain("/ask");
    expect(onboarding).not.toContain("intelligence/extract");
    expect(onboarding).not.toContain("proposeMatter");
    expect(newCase).not.toContain("/ask");
    expect(newCase).not.toContain("intelligence/extract");
  });

  it("P. no synthetic/demo data is written automatically", () => {
    expect(onboarding).not.toContain("sample Case");
    expect(onboarding).not.toContain("demo");
    expect(newCase).not.toContain("seed");
    expect(orgPost).not.toContain("insert(matters)");
  });

  it("zero-Case empty state tells the lawyer to create a Case", () => {
    expect(cases).toContain("No Cases yet");
    expect(cases).toContain("Create your first Case to add documents");
  });
});
