"use client";

import Link from "next/link";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
import { hasOpenDialog, Modal } from "@/components/ui/Modal";
import { usePhoneViewport } from "@/lib/hooks/usePhoneViewport";
import type { FlowSummary } from "../types";
import { DeleteFlowButton } from "./DeleteFlowButton";

/**
 * Shared by every row inside the menu, so a link and a submit button read
 * alike. Sized for a finger first — on a phone these rows are a sheet, where
 * 44px and 15px are the floor — and pulled back to menu density from `md:` up.
 */
export const FLOW_MENU_ITEM_CLASS =
  "flex min-h-[46px] w-full cursor-pointer items-center gap-2.5 rounded-[8px] px-3 text-left text-[17px] whitespace-nowrap text-neutral-200 transition-colors hover:bg-neutral-800 hover:text-white md:min-h-0 md:gap-2 md:px-2.5 md:py-[7px] md:text-[13px]";

/** The same row, for the one action that cannot be undone. */
export const FLOW_MENU_DANGER_CLASS =
  "flex min-h-[46px] w-full cursor-pointer items-center gap-2.5 rounded-[8px] px-3 text-left text-[17px] whitespace-nowrap text-danger-fg transition-colors hover:bg-danger-bg md:min-h-0 md:gap-2 md:px-2.5 md:py-[7px] md:text-[13px]";

/**
 * What you can do to a flow without opening it, behind one "⋯".
 *
 * A card used to carry five buttons in a row, so a list of four flows put
 * twenty of them on one screen and the two that matter — run it, edit it —
 * were indistinguishable from the three that rarely do. The three moved here;
 * none of them left, and "O'chirish" in particular is now somewhere a thumb
 * cannot reach by accident.
 *
 * It lives with the flow rather than with the bot because both lists of flows
 * hang it off [[FlowRow]] — the bot's module page and the home screen — and a
 * menu that existed on only one of them was the reason a flow could be renamed
 * from one screen and deleted from neither. `children` leads the menu and is
 * for actions the caller can offer and this cannot: "Sinash" needs the graph,
 * and a summary does not carry one.
 *
 * The main flow has no "O'chirish". It is the module's entry point, created
 * with the module and not by hand, so the backend refuses to drop it — an
 * offer that ends in an error is worse than no offer.
 */
export function FlowRowMenu({ flow, children }: { flow: FlowSummary; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const phone = usePhoneViewport();
  /*
   * Where the desktop menu is drawn, in viewport coordinates.
   *
   * It has to leave the document flow entirely. The rows this button sits in
   * live inside `.oq-group`, which is `overflow: hidden` — that is what clips
   * the row backgrounds to the group's rounded corners, and it clipped this
   * menu just as effectively: on a wide screen only the first two entries were
   * visible and "O'chirish" was cut off below the fold of a box nobody could
   * scroll. A flow could not be deleted at all, and nothing said why.
   *
   * A portal escapes the clip; anchoring to the trigger's own rect is what
   * keeps it under the button once it is out there.
   */
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || phone) return;
    const place = () => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return;
      setAnchor({ top: rect.bottom + 6, right: Math.max(8, window.innerWidth - rect.right) });
    };
    place();
    // Scrolling moves the row the menu is pinned to, and a menu left behind at
    // the old coordinates reads as a rendering fault.
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, phone]);

  useEffect(() => {
    // The sheet closes itself on Escape and on a backdrop press; only the
    // dropdown has to watch the page around it.
    if (!open || phone) return;
    function onPointerDown(event: PointerEvent) {
      // A dialog one of these rows opened is standing on top of the menu, and
      // every press inside it is outside the menu — so this handler closed the
      // menu, the menu unmounted the row, and the row took its dialog with it.
      // «Sinash» was the row that showed it: the chat opened and vanished in
      // the same frame, which reads as a button wired to nothing.
      if (hasOpenDialog()) return;
      const target = event.target as Node;
      // Both, because the menu is portaled to `document.body` and so is no
      // longer inside the trigger's subtree. Checking only the trigger closed
      // the menu on the pointer-down of a click aimed at one of its own rows,
      // and the click then landed on nothing — the same way the delete button
      // used to disappear out from under the confirmation.
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, phone]);

  /**
   * Closing on the next tick rather than in this handler: "O'chirish" fires an
   * async confirmation, and unmounting the button before the browser has run
   * the click it is about to dispatch would swallow the press entirely.
   */
  function closeAfterClick(event: ReactMouseEvent<HTMLDivElement>) {
    // A row that opens a dialog of its own keeps the menu mounted, because the
    // dialog *is* one of its children: closing the menu here would unmount the
    // thing the press just opened. It closes when the dialog does, on the next
    // press outside.
    if ((event.target as HTMLElement).closest("[data-keeps-menu-open]")) return;
    window.setTimeout(() => setOpen(false), 0);
  }

  const items = (
    <>
      {children}
      <Link href={`/flows/${flow.id}`} className={FLOW_MENU_ITEM_CLASS}>
        <Icon name="pen-nib" size={16} /> Tahrirlash
      </Link>
      {/* Filtered to this flow. The unfiltered page answers a question the
          reader did not ask — they pressed the button on one row. */}
      <Link href={`/analytics?flowId=${encodeURIComponent(flow.id)}`} className={FLOW_MENU_ITEM_CLASS}>
        <Icon name="chart-bar" size={16} /> Statistika
      </Link>
      {!flow.isMain && <DeleteFlowButton flow={flow} className={FLOW_MENU_DANGER_CLASS} />}
    </>
  );

  return (
    <div ref={rootRef} className="relative flex">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${flow.name} — boshqa amallar`}
        onClick={() => setOpen((value) => !value)}
        className="oq-press flex h-11 w-11 cursor-pointer items-center justify-center rounded-full bg-neutral-800 text-neutral-400 transition-colors hover:bg-neutral-700 hover:text-white md:h-[27px] md:w-[27px]"
      >
        <Icon name="dots-three" size={16} />
      </button>

      {open && phone && (
        <Modal open onClose={() => setOpen(false)} labelledBy={titleId} className="max-w-[440px]">
          <div className="flex flex-none items-center gap-2.5 border-b border-neutral-800 px-3.5 py-2.5">
            <span id={titleId} className="t-headline min-w-0 flex-1 truncate">
              {flow.name}
            </span>
            <IconButton icon="x" label="Yopish" size={32} onClick={() => setOpen(false)} />
          </div>
          <div role="menu" onClick={closeAfterClick} className="flex flex-col gap-1 overflow-y-auto p-2">
            {items}
          </div>
        </Modal>
      )}

      {open &&
        !phone &&
        anchor &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            onClick={closeAfterClick}
            style={{ top: anchor.top, right: anchor.right }}
            className="animate-rise fixed z-50 flex w-[188px] flex-col gap-0.5 rounded-[12px] border border-separator bg-overlay p-1 shadow-lg"
          >
            {items}
          </div>,
          document.body,
        )}
    </div>
  );
}
