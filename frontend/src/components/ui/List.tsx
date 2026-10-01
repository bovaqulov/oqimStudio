import Link from "next/link";
import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon";
import { cn } from "@/lib/utils/cn";

/**
 * The iOS inset grouped list — the shape every settings-like screen in this app
 * is now built from.
 *
 * It replaces a pattern the audit caught twice: a column of full-width filled
 * buttons (five "Ulash" buttons on the payments screen, each claiming to be
 * *the* action), and a form of labels stacked over inputs with a paragraph of
 * explanation under each. A grouped list says the same things in a third of the
 * height — label on the left, current value on the right, chevron if there is
 * somewhere to go — and it says them the way the client the app lives inside
 * says them.
 *
 * The row is the target. Nothing inside it is a button competing with it.
 */
export function ListGroup({
  title,
  footer,
  /** Rows carry a leading icon, so the hairline starts past it. */
  inset,
  className,
  children,
}: {
  /** Sentence case, secondary, 13px — not an uppercase tracking-out label. */
  title?: string;
  /** The one place a sentence of explanation is still allowed, and only when it changes what the reader does. */
  footer?: ReactNode;
  inset?: "icon";
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn("flex flex-col", className)}>
      {title && <h2 className="t-footnote t-secondary m-0 px-4 pb-2">{title}</h2>}
      <div className="oq-group" data-inset={inset}>
        {children}
      </div>
      {footer && <p className="t-footnote t-tertiary m-0 px-4 pt-2 leading-[18px]">{footer}</p>}
    </section>
  );
}

interface RowContent {
  /** The one label. There is no second line of description — see `ListGroup`'s footer. */
  label: string;
  /** What it is set to now, read right-aligned. */
  value?: ReactNode;
  icon?: IconName;
  /** Tints the icon's rounded square, the way Telegram and iOS Settings do. */
  iconTone?: "accent" | "success" | "warning" | "danger" | "neutral";
  /** Red label. For "Botni uzish" and its kind — never a filled red button. */
  destructive?: boolean;
  /** Sits at the end instead of a chevron: a switch, a badge, a spinner. */
  trailing?: ReactNode;
  disabled?: boolean;
}

const TONE_CLASS: Record<NonNullable<RowContent["iconTone"]>, string> = {
  accent: "bg-accent-700 text-white",
  success: "bg-success-fg text-white",
  warning: "bg-warning-fg text-white",
  danger: "bg-danger-fg text-white",
  neutral: "bg-neutral-800 text-neutral-400",
};

function RowInner({ label, value, icon, iconTone = "neutral", destructive, trailing, chevron }: RowContent & { chevron: boolean }) {
  return (
    <>
      {icon && (
        <span className={cn("flex h-[29px] w-[29px] flex-none items-center justify-center rounded-[8px]", TONE_CLASS[iconTone])}>
          <Icon name={icon} size={17} />
        </span>
      )}
      <span className={cn("t-body min-w-0 flex-1 truncate", destructive ? "text-danger-fg" : "text-text")}>{label}</span>
      {value !== undefined && value !== null && value !== "" && (
        <span className="t-body t-secondary min-w-0 max-w-[52%] truncate text-right">{value}</span>
      )}
      {trailing}
      {chevron && <Icon name="caret-right" size={15} className="flex-none text-neutral-600" />}
    </>
  );
}

/** A row that goes somewhere. */
export function ListLink({ href, ...content }: RowContent & { href: string }) {
  return (
    <Link href={href} className="oq-row">
      <RowInner {...content} chevron />
    </Link>
  );
}

/** A row that does something in place. */
export function ListButton({ onClick, chevron = false, ...content }: RowContent & { onClick: () => void; chevron?: boolean }) {
  return (
    <button
      type="button"
      disabled={content.disabled}
      onClick={onClick}
      className="oq-row cursor-pointer disabled:cursor-default disabled:opacity-40"
    >
      <RowInner {...content} chevron={chevron} />
    </button>
  );
}

/** A row that only states something — a value with nowhere to go. */
export function ListRow({ children, className, ...content }: Partial<RowContent> & { children?: ReactNode; className?: string }) {
  if (children) return <div className={cn("oq-row", className)}>{children}</div>;
  return (
    <div className={cn("oq-row", className)}>
      <RowInner {...(content as RowContent)} chevron={false} />
    </div>
  );
}
