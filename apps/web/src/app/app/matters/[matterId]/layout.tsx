/** Nested /app/matters/:id/* pages were removed. next.config catch-all sends them to /app/cases. */
export default function LegacyMatterLayout({ children }: { children: React.ReactNode }) {
  return children;
}
