"use client";

import type { RefObject } from "react";
import { IconButton } from "@/components/ui/IconButton";
import { useToastStore } from "@/components/ui/toast-store";
import { cn } from "@/lib/utils/cn";
import { useFlowEditorStore } from "../store/useFlowEditorStore";

export function ZoomToolbar({ canvasRef }: { canvasRef: RefObject<HTMLDivElement | null> }) {
  const zoom = useFlowEditorStore((s) => s.zoom);
  const pastLength = useFlowEditorStore((s) => s.past.length);
  const futureLength = useFlowEditorStore((s) => s.future.length);
  const undo = useFlowEditorStore((s) => s.undo);
  const redo = useFlowEditorStore((s) => s.redo);
  const zoomBy = useFlowEditorStore((s) => s.zoomBy);
  const fitView = useFlowEditorStore((s) => s.fitView);
  const autoLayout = useFlowEditorStore((s) => s.autoLayout);
  const nodeCount = useFlowEditorStore((s) => s.nodes.length);
  /*
   * A toast lands bottom-centre, and so does this bar: `bottom-[22px]` against
   * `bottom-[18px]`, both `left-1/2 -translate-x-1/2`, and the toast is `fixed`
   * at `z-[70]`. Measured on the running stand, "Bekor qilindi" covered
   * 131×30px of the middle of this strip — the zoom reading and "Markazga" —
   * and «1 blok o'chirildi · Bekor qilish», which is longer and the one worth
   * reaching, buried undo and redo with it.
   *
   * The bar moves rather than the toast: a toast is a message with a deadline
   * and belongs where every other screen puts it, and this strip is the thing
   * with somewhere to go. It comes back down when the toast leaves.
   */
  const toasting = useToastStore((s) => s.toast !== null);

  function fit() {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (rect) fitView({ width: rect.width, height: rect.height });
  }

  /** Tidying moves every card at once, so the view follows it rather than losing the graph. */
  function tidy() {
    autoLayout();
    fit();
  }

  return (
    <div
      className={cn(
        "absolute left-1/2 z-[8] flex -translate-x-1/2 items-center gap-0.5 rounded-full bg-overlay/92 p-[5px] shadow-md backdrop-blur-lg",
        "transition-[bottom] duration-200 motion-reduce:transition-none",
        toasting ? "bottom-[70px]" : "bottom-[18px]",
      )}
    >
      <IconButton icon="arrow-counter-clockwise" label="Bekor qilish" size={30} disabled={pastLength === 0} onClick={undo} />
      <IconButton icon="arrow-clockwise" label="Qaytarish" size={30} disabled={futureLength === 0} onClick={redo} />
      <span className="mx-[5px] h-[18px] w-px bg-neutral-800" />
      <IconButton icon="minus" label="Kichraytirish" size={30} onClick={() => zoomBy(-0.1)} />
      <span className="min-w-[44px] text-center text-[11.5px] text-neutral-400 tabular-nums">
        {Math.round(zoom * 100)}%
      </span>
      <IconButton icon="plus" label="Kattalashtirish" size={30} onClick={() => zoomBy(0.1)} />
      <span className="mx-[5px] h-[18px] w-px bg-neutral-800" />
      <button
        type="button"
        onClick={fit}
        className="h-[30px] cursor-pointer rounded-full border-none bg-transparent px-3 text-[11.5px] text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
      >
        Markazga
      </button>
      <button
        type="button"
        onClick={tidy}
        disabled={nodeCount < 2}
        title="Bloklarni ustunlarga tartiblash"
        className="h-[30px] cursor-pointer rounded-full border-none bg-transparent px-3 text-[11.5px] text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100 disabled:cursor-default disabled:text-neutral-700 disabled:hover:bg-transparent"
      >
        Tartiblash
      </button>
    </div>
  );
}
