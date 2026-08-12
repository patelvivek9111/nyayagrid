import type { ButtonHTMLAttributes, PropsWithChildren, ReactNode } from "react";

export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export function Button({
  children,
  variant = "primary",
  className,
  ...props
}: PropsWithChildren<
  ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: "primary" | "secondary" | "ghost";
  }
>) {
  return (
    <button className={cx("ng-button", `ng-button-${variant}`, className)} {...props}>
      {children}
    </button>
  );
}

export function Panel({
  title,
  children,
  className,
}: PropsWithChildren<{ title?: string; className?: string }>) {
  return (
    <section className={cx("ng-panel", className)}>
      {title ? <h2 className="ng-panel-title">{title}</h2> : null}
      {children}
    </section>
  );
}

export function Badge({ children }: { children: ReactNode }) {
  return <span className="ng-badge">{children}</span>;
}

export function PageHeader({
  eyebrow,
  title,
  description,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
}) {
  return (
    <header className="ng-page-header">
      {eyebrow ? <p className="ng-eyebrow">{eyebrow}</p> : null}
      <h1>{title}</h1>
      {description ? <p className="ng-page-description">{description}</p> : null}
    </header>
  );
}
