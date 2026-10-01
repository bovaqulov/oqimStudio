"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { logoutAction } from "@/features/auth/actions";
import { clearSession } from "@/features/auth/session-client";
import { switchWorkspaceAction } from "@/features/workspace/actions";
import type { Workspace } from "@/features/workspace/types";
import { useT } from "@/lib/i18n/LocaleProvider";
import { initialsOf } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";
import { useNavStore } from "./nav-store";

export interface WorkspaceSummaryProps {
  /** `undefined` only while a session is still resolving — the summary renders a placeholder rather than throwing. */
  workspace?: Workspace;
  /** Every workspace the signed-in user belongs to — what the switcher lists. */
  memberships?: Workspace[];
  memberCount?: number;
  planName?: string;
  roleLabel?: string;
}

/**
 * Who you are working as, and the control that changes it. The tenant is never
 * assumed anywhere in the app — this is the one place it is chosen, and the
 * choice is stored server-side by `switchWorkspaceAction`.
 */
export function WorkspaceSummary({
  workspace,
  memberships = [],
  memberCount = 0,
  planName,
  roleLabel,
}: WorkspaceSummaryProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const closeDrawer = useNavStore((state) => state.closeDrawer);
  const t = useT();

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // A session that has not resolved yet is a real state, not a bug: the row
  // keeps its shape so the sidebar does not jump when the name arrives.
  if (!workspace) {
    return (
      <div className="oq-rail-row m-2.5 flex items-center gap-2 rounded-md bg-neutral-800 p-[11px]">
        <span className="h-6 w-6 flex-none animate-pulse rounded-full bg-neutral-700" />
        <span className="oq-rail-hide flex min-w-0 flex-1 flex-col gap-1">
          <span className="h-2.5 w-24 animate-pulse rounded-full bg-neutral-700" />
          <span className="h-2 w-16 animate-pulse rounded-full bg-neutral-850" />
        </span>
      </div>
    );
  }

  return (
    <div ref={rootRef} className="relative m-2.5">
      {/* In the rail the initials are the whole card: they are already the
          workspace's short name, and the switcher they open is a menu that
          gives its own width back (`oq-rail-pop`). The gear is dropped rather
          than stacked — /settings is a nav row away. */}
      <div className="oq-rail-row flex items-center gap-2 rounded-md bg-neutral-800 p-[11px]">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          title={t.chrome.workspace.switch}
          className="oq-rail-row flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
        >
          <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-accent-700 text-[11px] font-semibold text-white">
            {initialsOf(workspace.name)}
          </span>
          <span className="oq-rail-hide min-w-0 flex-1">
            <span className="block truncate text-[13.5px] font-medium">{workspace.name}</span>
            <span className="block truncate text-[11.5px] text-neutral-600">
              {[planName, t.chrome.workspace.members(memberCount), roleLabel].filter(Boolean).join(" · ")}
            </span>
          </span>
          <Icon
            name={open ? "caret-up" : "caret-down"}
            size={11}
            className="oq-rail-hide flex-none text-neutral-500"
          />
        </button>
        <Link
          href="/settings"
          title={t.chrome.workspace.settings}
          className="oq-rail-hide flex h-6 w-6 flex-none items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-700 hover:text-neutral-100"
        >
          <Icon name="gear" size={12} />
        </Link>
      </div>

      {open && (
        <div className="oq-rail-pop animate-rise absolute bottom-full left-0 z-40 mb-1.5 w-full overflow-hidden rounded-[10px] border border-separator bg-overlay shadow-lg">
          <div className="px-3 pt-2.5 pb-1 text-[9.5px] tracking-[.1em] text-neutral-600 uppercase">
            {t.chrome.workspace.list}
          </div>
          {memberships.map((item) => (
            <form key={item.id} action={switchWorkspaceAction}>
              <input type="hidden" name="workspaceId" value={item.id} />
              <button
                type="submit"
                // Closes both, because switching tenants *is* leaving. The
                // drawer only closes itself for anchors — see `SidebarShell` —
                // and this is a form, so on a tablet the panel and its dimmed
                // backdrop stayed over the workspace the reader had just
                // switched to, with nothing to press but the scrim.
                onClick={() => {
                  setOpen(false);
                  closeDrawer();
                }}
                className={cn(
                  "flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-[12px] hover:bg-neutral-800",
                  item.id === workspace.id ? "text-accent-200" : "text-neutral-300",
                )}
              >
                <span className="flex h-5 w-5 flex-none items-center justify-center rounded-full bg-neutral-800 text-[9.5px] text-neutral-300">
                  {initialsOf(item.name)}
                </span>
                <span className="min-w-0 flex-1 truncate">{item.name}</span>
                {item.id === workspace.id && <Icon name="check" size={11} className="flex-none" />}
              </button>
            </form>
          ))}
          {/* Directly under the list it belongs to: the switcher is where a
              reader finds out they only have one, which is the moment they
              want a second. */}
          <Link
            href="/onboarding/workspace?add=1"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 border-t border-neutral-800 px-3 py-2 text-[12px] text-accent-400 hover:bg-neutral-800"
          >
            <Icon name="plus" size={12} /> {t.chrome.workspace.add}
          </Link>
          <Link
            href="/settings/team"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 border-t border-neutral-800 px-3 py-2 text-[12px] text-neutral-400 hover:bg-neutral-800"
          >
            <Icon name="users-three" size={12} /> {t.chrome.workspace.manageTeam}
          </Link>
          <button
            type="button"
            onClick={async () => {
              // Two halves, both needed: the action revokes the token and drops
              // the httpOnly cookie holding it (JavaScript cannot), and
              // `clearSession` drops the readable ones the route guard reads.
              setOpen(false);
              await logoutAction();
              clearSession();
              router.replace("/login?reason=logout");
            }}
            className="flex w-full cursor-pointer items-center gap-2 border-t border-neutral-800 px-3 py-2 text-left text-[12px] text-neutral-400 hover:bg-neutral-800 hover:text-danger-fg"
          >
            <Icon name="arrow-left" size={12} /> {t.chrome.workspace.signOut}
          </button>
        </div>
      )}
    </div>
  );
}
