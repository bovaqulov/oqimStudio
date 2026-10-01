"use client";

import Link from "next/link";
import { Icon, type IconName } from "@/components/ui/Icon";
import { cn } from "@/lib/utils/cn";
import { NavPendingDot } from "./NavPendingDot";

export function NavLinkRow({
  href,
  label,
  icon,
  active,
}: {
  href: string;
  label: string;
  icon: IconName;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      // Unconditional, and it does two jobs. In the rail the label is
      // `display: none`, so this is what names the row — a hidden element is
      // skipped by the accessible-name algorithm and `title` is the fallback it
      // lands on. Expanded it is the tooltip a long name gets when it truncates.
      title={label}
      className={cn(
        // A touch tablet gets the same rows with room to hit them; a mouse
        // keeps the density it was drawn for.
        "oq-rail-row t-subhead flex items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors pointer-coarse:py-2.5",
        active ? "bg-accent-800 text-accent-ink" : "text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100",
      )}
    >
      <Icon name={icon} size={16} className="flex-none" />
      <span className="oq-rail-hide flex-1 truncate text-left">{label}</span>
      <NavPendingDot />
    </Link>
  );
}
