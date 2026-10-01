"use client";

import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/utils/cn";
import { NavPendingDot } from "./NavPendingDot";
import { isNavItemActive, isSectionActive, type NavSection } from "./nav-config";

export function NavGroupRow({
  section,
  open,
  onToggle,
  pathname,
}: {
  section: NavSection;
  open: boolean;
  onToggle: () => void;
  pathname: string;
}) {
  const groupActive = isSectionActive(pathname, section);

  return (
    <div className="flex flex-col gap-0.5">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        // Names the row once the rail has taken its label away; see NavLinkRow.
        title={section.label}
        className={cn(
          "oq-rail-row t-subhead flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-neutral-800 pointer-coarse:py-2.5",
          groupActive || open ? "text-neutral-200" : "text-neutral-400",
        )}
      >
        <Icon name={section.icon} size={16} className="flex-none" />
        <span className="oq-rail-hide flex-1 truncate text-left">{section.label}</span>
        <Icon
          name="caret-right"
          size={11}
          className={cn("oq-rail-hide text-neutral-700 transition-transform", open && "rotate-90")}
        />
      </button>
      {open && (
        // Not narrowed for the rail, dropped: a 56px column of dots is a list
        // of projects nobody can tell apart. The row above brings the sidebar
        // back instead — see SidebarNav.
        <div className="oq-rail-hide ml-4 flex flex-col gap-0.5 border-l border-neutral-900 pl-2">
          {section.items.map((item) => {
            const active = isNavItemActive(pathname, item);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                // A project name is the one label here the workspace writes
                // rather than the product, so it is also the one that runs out
                // of column and truncates.
                title={item.label}
                className={cn(
                  "t-subhead flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors pointer-coarse:py-2.5",
                  active
                    ? "bg-accent-800 text-accent-ink"
                    : item.accent
                      ? "text-accent-400 hover:bg-neutral-800 hover:text-accent-300"
                      : "text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100",
                )}
              >
                {/* A destination of its own gets its icon; a name inside a list
                    (a project) gets the dot that used to stand for all of them. */}
                {item.icon ? (
                  <Icon name={item.icon} size={15} className="flex-none" />
                ) : (
                  <span
                    className={cn(
                      "h-1 w-1 flex-none rounded-full",
                      active ? "bg-white" : item.accent ? "bg-accent-400" : "bg-neutral-700",
                    )}
                  />
                )}
                <span className="flex-1 truncate text-left">{item.label}</span>
                <NavPendingDot />
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
