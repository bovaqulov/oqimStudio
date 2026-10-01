"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Icon, type IconName } from "@/components/ui/Icon";
import { cn } from "@/lib/utils/cn";
import { validateGraph, type GraphFinding, type GraphFindingKind } from "../lib/validate-graph";
import { getNodeDefinition } from "../node-registry";
import { useBotMainLanguage } from "./Inspector/fields/TextLanguage";
import { useFlowEditorStore } from "../store/useFlowEditorStore";

/** How many findings the panel lists before it stops being read and starts being scrolled past. */
const MAX_ROWS = 12;

const KIND_ICON: Record<GraphFindingKind, IconName> = {
  unreachable: "git-branch",
  emptyContent: "text-aa",
  danglingPort: "link",
  unsentRow: "keyboard",
  bareVariable: "info",
  forkedPort: "git-branch",
  openTrigger: "lightning",
  misspeltVariable: "sparkle",
  missingFunction: "code",
};

/** Room left between the popover and the left edge of the window when it has to move. */
const VIEWPORT_MARGIN = 8;

/**
 * Everything wrong with this flow, from the two places that can know it.
 *
 * `validateGraph` reads the graph, which the editor holds. A missing library
 * function cannot be read from the graph at all — it is a fact about this
 * flow's text *and* that bot's script library, and only the backend has both —
 * so it arrives on the answer to the save that caused it. Merged here so an
 * author has one place to look rather than two, and appended rather than
 * prepended because a block wired to nothing is the more urgent of the two.
 *
 * A hook rather than a value inside the panel, because the publish switch needs
 * the same count: it asks before putting a flow with open ends in front of
 * customers, and a second copy of this merge is a second answer to "is this
 * flow ready" that could disagree with the badge beside it.
 */
export function useGraphFindings(): GraphFinding[] {
  const nodes = useFlowEditorStore((s) => s.nodes);
  const edges = useFlowEditorStore((s) => s.edges);
  const expressionWarnings = useFlowEditorStore((s) => s.expressionWarnings);
  const main = useBotMainLanguage();

  return useMemo(() => {
    const graph = validateGraph(nodes, edges, main);
    const missing: GraphFinding[] = expressionWarnings.map((warning) => ({
      id: `${warning.nodeId}:missing:${warning.function}`,
      kind: "missingFunction",
      nodeId: warning.nodeId,
      summary: "",
      message: warning.message,
    }));
    return [...graph, ...missing];
  }, [nodes, edges, main, expressionWarnings]);
}

/**
 * What is wrong with the graph, next to the button that puts it live.
 *
 * Deliberately not a gate: autosave keeps writing and "Ishga tushirish" keeps
 * working, because a half-built flow is a normal thing to have on a canvas.
 * What it fixes is the silence — an orphaned block looks exactly like a wired
 * one, so the only way to find out it never runs is a customer not getting an
 * answer. Each row goes to the block it is about.
 */
export function GraphWarnings() {
  const nodes = useFlowEditorStore((s) => s.nodes);
  const focusNode = useFlowEditorStore((s) => s.focusNode);
  const expandNode = useFlowEditorStore((s) => s.expandNode);
  const findings = useGraphFindings();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  /*
   * How far the panel has to move right to stay on the screen.
   *
   * It hangs off the button's right edge and is a fixed 320px wide, so where
   * its left edge lands is decided by how much sits to the right of the button
   * — which shrinks as the toolbar drops controls on the way down. Below about
   * 900px the panel started 21px off the left edge of the window and the first
   * character of every line was cut off, with nothing to scroll and no way to
   * get at it. Measured rather than guessed at a breakpoint: the button's
   * position depends on which controls the bar is showing, not on a width.
   */
  //: How far the panel had to move to stay on screen, written straight onto
  //: the element rather than held in state.
  //:
  //: A `transform` is what the browser is being told, and telling it is what an
  //: effect is for. Through `useState` this became a loop with itself — the
  //: measurement depends on the shift already applied, so `shift` had to be in
  //: the dependency list, so setting it re-ran the effect that set it, and the
  //: only thing stopping a second pass was subtracting the value back out. It
  //: also meant a render per resize frame on a panel nobody is looking at while
  //: they drag a window edge.
  const shifted = useRef(0);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    window.addEventListener("mousedown", onPointerDown);
    return () => window.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  // Before the paint, so the panel never appears clipped and then jumps. The
  // measurement is of the *unshifted* box — `shift` is subtracted back out —
  // or a panel already moved once would keep moving on the next resize.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!open || !panel) {
      shifted.current = 0;
      return;
    }
    function place() {
      if (!panel) return;
      // The *unshifted* left edge: the transform already applied is subtracted
      // back out, or a panel moved once would keep moving on every resize.
      const left = panel.getBoundingClientRect().left - shifted.current;
      const next = Math.max(0, VIEWPORT_MARGIN - left);
      shifted.current = next;
      panel.style.transform = next ? `translateX(${next}px)` : "";
    }
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open, findings.length]);

  // A clean graph says nothing at all — a badge reading "0" is one more thing
  // to check before publishing, and there is nothing behind it.
  if (findings.length === 0) return null;

  /*
   * "Qatorni bossangiz, o'sha blokka o'tiladi" — in both views, by two
   * different means.
   *
   * There is no `[data-flow-canvas]` in Simple mode, so a row click that only
   * knew how to centre a canvas closed the panel and did nothing else at all —
   * no selection, no scroll — on the view most of these readers are in. Pro
   * selects the block and brings the view to it; Simple opens the block's card
   * and scrolls to that. Which is also why the sentence above the list names
   * the destination and not the verb: only one of the two is a selection.
   */
  function go(nodeId: string) {
    const canvas = document.querySelector<HTMLDivElement>("[data-flow-canvas]");
    if (canvas) {
      const rect = canvas.getBoundingClientRect();
      focusNode(nodeId, { width: rect.width, height: rect.height });
    } else {
      expandNode(nodeId);
      const card = document.querySelector<HTMLElement>(`[data-step-id="${CSS.escape(nodeId)}"]`);
      card?.scrollIntoView({
        block: "center",
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      });
    }
    setOpen(false);
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        title="Oqimdagi muammolarni ko'rish — saqlashga to'sqinlik qilmaydi"
        className={cn(
          // `h-7` and fully round to sit on the flow bar's one shape — see
          // `FlowTopBar.BAR_CONTROL`. The phone keeps its own bigger target.
          "flex h-7 cursor-pointer items-center gap-1.5 rounded-full px-3 text-[12px] whitespace-nowrap transition-colors max-md:h-auto max-md:rounded-md max-md:px-3 max-md:py-2 max-md:text-[13px]",
          open ? "bg-warning-fg/25 text-warning-fg" : "bg-warning-bg text-warning-fg hover:bg-warning-fg/20",
        )}
      >
        <Icon name="warning" size={12} />
        {/* The number is the part that can be read at a glance; the word is
            what the chip gives up first when the bar runs out of width. */}
        {findings.length}
        <span className="hidden max-md:inline xl:inline">ta ogohlantirish</span>
      </button>

      {open && (
        <div
          ref={panelRef}
          className="animate-rise absolute top-full right-0 z-40 mt-1.5 w-[320px] overflow-hidden rounded-[10px] border border-separator bg-overlay shadow-lg max-md:w-[calc(100vw-28px)]"
        >
          <div className="border-b border-neutral-800 px-3 py-2 text-[10.5px] leading-relaxed text-neutral-500 max-md:text-[12px]">
            {/* "tanlanadi" was true of Pro and of nothing else. Simple mode has
                no canvas to select on — it opens the block instead — so the
                sentence names the destination rather than the verb. */}
            Oqim baribir saqlanadi — bu ro&apos;yxat nima ishlamasligini aytadi. Qatorni bossangiz,
            o&apos;sha blokka o&apos;tiladi.
          </div>
          <div className="max-h-[300px] overflow-y-auto">
            {findings.slice(0, MAX_ROWS).map((finding) => {
              const node = nodes.find((item) => item.id === finding.nodeId);
              const definition = node ? getNodeDefinition(node.type) : null;
              return (
                <button
                  key={finding.id}
                  type="button"
                  onClick={() => go(finding.nodeId)}
                  className="flex w-full cursor-pointer items-start gap-2 px-2.5 py-2 text-left hover:bg-neutral-800 max-md:min-h-[52px] max-md:px-3 max-md:py-3"
                >
                  <span
                    className="mt-[1px] flex h-5 w-5 flex-none items-center justify-center rounded-md border border-neutral-700 bg-neutral-850"
                    style={{ color: definition?.color }}
                  >
                    <Icon name={definition?.icon ?? KIND_ICON[finding.kind]} size={11} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1 text-[12px] text-neutral-100 max-md:text-[15px]">
                      <Icon name={KIND_ICON[finding.kind]} size={10} className="flex-none text-warning-fg" />
                      <span className="truncate">{node?.title || definition?.kindLabel || finding.nodeId}</span>
                    </span>
                    <span className="block text-[10.5px] leading-relaxed text-neutral-400 max-md:text-[13px]">{finding.message}</span>
                    {finding.summary && (
                      <span className="block truncate text-[10px] text-neutral-600 max-md:text-[12px]">{finding.summary}</span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
          {findings.length > MAX_ROWS && (
            <div className="border-t border-neutral-800 px-3 py-2 text-[10.5px] text-neutral-600">
              va yana {findings.length - MAX_ROWS} ta
            </div>
          )}
        </div>
      )}
    </div>
  );
}
