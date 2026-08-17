import { CaseLayoutClient } from "./case-layout-client";

export default async function CaseLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ matterId: string }>;
}) {
  const { matterId } = await params;
  return <CaseLayoutClient matterId={matterId}>{children}</CaseLayoutClient>;
}
