"use client";

import { useEffect, useRef } from "react";
import { Icon } from "@/components/ui/Icon";
import type { IconName } from "@/components/ui/icon-names";
import { cn } from "@/lib/utils/cn";
import { getNodeDefinition, isFixedNodeType } from "../node-registry";
import { useFlowEditorStore } from "../store/useFlowEditorStore";

/** Where it was opened, and on what. */
export interface ContextTarget {
  x: number;
  y: number;
  /** The block under the pointer, or null for the canvas itself. */
  nodeId: string | null;
  /** The connection under the pointer, when the pointer was on one. */
  edgeId: string | null;
}

interface Row {
  key: string;
  label: string;
  icon: IconName;
  /** Right-aligned, and only where a keyboard reaches the same action. */
  shortcut?: string;
  danger?: boolean;
  disabled?: string;
  run: () => void;
}

/**
 * What a right-click on the canvas offers.
 *
 * Until now it offered Chrome's: «Back», «Reload», «Save As…», «Inspect» — a
 * menu about the *page*, on top of an editor where the reader was pointing at a
 * block. Every one of those entries is either useless here or actively wrong,
 * and the two that are not (copy, paste) do nothing a canvas understands.
 *
 * The entries are the ones the canvas already has, gathered where the pointer
 * already is. Nothing new is invented: every row here is a keyboard shortcut, a
 * hover control on a card, or a button on the dock — which is why each one
 * prints its shortcut. A context menu is where somebody *finds out* the
 * shortcut exists.
 *
 * What it is offered on decides what it says. A block gets the four things you
 * do to a block; a connection gets the one thing you do to a connection; the
 * canvas itself gets the view. Showing all of it everywhere, greyed out, would
 * be a longer menu that answers more slowly.
 */
export function FlowContextMenu({ target, onClose }: { target: ContextTarget; onClose: () => void }) {
  const nodes = useFlowEditorStore((s) => s.nodes);
  const readOnly = useFlowEditorStore((s) => s.readOnly);
  const expandNode = useFlowEditorStore((s) => s.expandNode);
  const openTestChat = useFlowEditorStore((s) => s.openTestChat);
  const duplicateSelected = useFlowEditorStore((s) => s.duplicateSelected);
  const deleteSelected = useFlowEditorStore((s) => s.deleteSelected);
  const deleteEdge = useFlowEditorStore((s) => s.deleteEdge);
  const selectAll = useFlowEditorStore((s) => s.selectAll);
  const autoLayout = useFlowEditorStore((s) => s.autoLayout);
  const fitView = useFlowEditorStore((s) => s.fitView);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Anywhere else closes it, and so does Escape — the two ways every menu in
    // this product is dismissed, so this one is not a third thing to learn.
    const away = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", away);
    window.addEventListener("keydown", key);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("mousedown", away);
      window.removeEventListener("keydown", key);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  const node = target.nodeId ? nodes.find((item) => item.id === target.nodeId) : undefined;

  const rows: Row[] = [];
  if (node) {
    const definition = getNodeDefinition(node.type);
    const fixed = isFixedNodeType(node.type);
    rows.push(
      { key: "edit", label: "Tahrirlash", icon: "pen-nib", shortcut: "Enter", run: () => expandNode(node.id) },
      { key: "test", label: "Shu blokdan sinash", icon: "play", run: () => openTestChat(node.id) },
      {
        key: "copy",
        label: "Nusxalash",
        icon: "copy",
        shortcut: "⌘D",
        // Said, not hidden: an author who reaches for it on the entry block is
        // asking a reasonable question and deserves the answer.
        disabled: fixed ? `«${definition.kindLabel}» oqimda bitta bo'ladi` : undefined,
        run: duplicateSelected,
      },
      {
        key: "delete",
        label: "O'chirish",
        icon: "trash",
        shortcut: "Delete",
        danger: true,
        disabled: fixed ? "Oqimning kirish nuqtasi o'chirilmaydi" : undefined,
        run: deleteSelected,
      },
    );
  } else if (target.edgeId) {
    rows.push({
      key: "unlink",
      label: "Bog'lanishni o'chirish",
      icon: "trash",
      danger: true,
      run: () => deleteEdge(target.edgeId as string),
    });
  } else {
    rows.push(
      { key: "all", label: "Hammasini tanlash", icon: "corners-out", shortcut: "⌘A", run: selectAll },
      { key: "tidy", label: "Tartiblash", icon: "flow-arrow", run: autoLayout },
      {
        key: "center",
        label: "Markazga",
        icon: "crosshair",
        shortcut: "0",
        run: () => {
          const canvas = document.querySelector<HTMLElement>("[data-flow-canvas]");
          if (canvas) fitView(canvas.getBoundingClientRect());
        },
      },
    );
  }

  // A reader with no write access still gets the menu — the view entries are
  // theirs — but nothing that would change the flow is offered at all.
  const shown = readOnly ? rows.filter((row) => row.key === "all" || row.key === "center") : rows;
  if (shown.length === 0) return null;

  return (
    <div
      ref={ref}
      role="menu"
      /*
       * The press is stopped here, and that is what makes «O'chirish» work.
       *
       * This menu renders inside the canvas element, whose own `onMouseDown`
       * begins with `select(null, false)` — clearing the selection is how
       * clicking the background deselects. A press on a menu row bubbled into
       * it, so by the time the row's `onClick` ran there was nothing selected:
       * `deleteSelected` returned early and `duplicateSelected` found no
       * source. The menu closed and the block stayed, which reads exactly like
       * a row wired to nothing — and Delete on the keyboard worked, because
       * pressing a key does not travel through the canvas.
       *
       * `beginPanDrag` was the other passenger: every press on a row started a
       * pan of the canvas underneath it.
       */
      onMouseDown={(event) => event.stopPropagation()}
      className="animate-rise fixed z-50 min-w-[210px] overflow-hidden rounded-[10px] border border-separator bg-overlay py-1 shadow-lg"
      // Clamped to the viewport: a right-click near the bottom edge would
      // otherwise open a menu whose last row is off-screen, which is exactly
      // where «O'chirish» sits.
      style={{
        left: Math.min(target.x, (typeof window === "undefined" ? 0 : window.innerWidth) - 230),
        top: Math.min(target.y, (typeof window === "undefined" ? 0 : window.innerHeight) - shown.length * 34 - 20),
      }}
    >
      {shown.map((row) => (
        <button
          key={row.key}
          type="button"
          role="menuitem"
          disabled={!!row.disabled}
          title={row.disabled}
          onClick={() => {
            if (row.disabled) return;
            row.run();
            onClose();
          }}
          className={cn(
            "flex w-full cursor-pointer items-center gap-2.5 px-3 py-[7px] text-left text-[12.5px] transition-colors",
            row.disabled
              ? "cursor-not-allowed text-neutral-600"
              : row.danger
                ? "text-danger-fg hover:bg-danger-bg"
                : "text-neutral-200 hover:bg-neutral-800",
          )}
        >
          <Icon name={row.icon} size={13} className="flex-none" />
          <span className="min-w-0 flex-1 truncate">{row.label}</span>
          {row.shortcut && !row.disabled && (
            <span className="flex-none text-[10.5px] text-neutral-600 tabular-nums">{row.shortcut}</span>
          )}
        </button>
      ))}
    </div>
  );
}
