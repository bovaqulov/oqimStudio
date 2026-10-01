"use client";

import { Icon } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
import { cn } from "@/lib/utils/cn";
import { paletteWidth } from "../lib/layout";
import { dismissHint, useHintDismissed } from "../lib/onboarding";
import { getNodeDefinition, getPaletteNodeTypes } from "../node-registry";
import { useFlowEditorStore } from "../store/useFlowEditorStore";

const CONNECT_HINT = "connect-blocks";

export function NodePalette() {
  const isNarrow = useFlowEditorStore((s) => s.isNarrowViewport);
  const collapsed = useFlowEditorStore((s) => s.paletteCollapsed);
  const togglePalette = useFlowEditorStore((s) => s.togglePalette);
  const addNode = useFlowEditorStore((s) => s.addNode);
  const moduleKey = useFlowEditorStore((s) => s.moduleKey);
  // Which rows the plan will not run, and why. Subscribed to rather than read
  // through the store's getter, so a palette drawn before the plan arrived
  // re-draws when it does.
  const lockedBlocks = useFlowEditorStore((s) => s.planLimits.blocks);
  const edgeCount = useFlowEditorStore((s) => s.edges.length);
  const nodeTypes = getPaletteNodeTypes(moduleKey);
  const hintDismissed = useHintDismissed(CONNECT_HINT);
  // Folded either by choice or by a viewport with no room for the names. Both
  // keep every block one click away — the row loses its label, not its button.
  const rail = isNarrow || collapsed;
  // Onboarding, not chrome: the hint is for someone who has not wired anything
  // together yet, and it leaves for good once they have — or once they say so.
  const showHint = !rail && !hintDismissed && edgeCount === 0;

  return (
    /* Hugs its content at the top of the canvas — only a list taller than the
       viewport starts scrolling inside the panel. */
    <div
      data-node-palette
      className="absolute top-[14px] left-[14px] z-[9] flex max-h-[calc(100%-28px)] flex-col overflow-hidden rounded-[14px] bg-overlay/92 shadow-md backdrop-blur-lg"
      style={{ width: paletteWidth({ isNarrow, collapsed }) }}
    >
      {/* A viewport too narrow for the names is already a rail, so the toggle
          is offered only where it has something left to give back. */}
      {!isNarrow && (
        <div className={cn("flex items-center gap-1 px-1.5 pt-2", collapsed ? "justify-center" : "pl-3")}>
          {!collapsed && (
            <span className="flex-1 text-[9.5px] tracking-[.1em] text-neutral-700 uppercase">Bloklar</span>
          )}
          <IconButton
            icon={collapsed ? "arrow-right" : "arrow-left"}
            label={collapsed ? "Palitrani ochish" : "Palitrani yig'ish"}
            size={22}
            onClick={togglePalette}
          />
        </div>
      )}
      <div className="no-scrollbar flex flex-1 flex-col gap-1 overflow-y-auto px-2.5 pt-1.5 pb-3">
        {nodeTypes.map((type, index) => {
          const definition = getNodeDefinition(type);
          const shortcut = index + 1;
          /*
           * Why the plan will not run this one, or "" — and it stays in the
           * list either way. A row that disappears teaches an author nothing:
           * they go looking for «AI javob», do not find it, and conclude the
           * product cannot do it. A row that is here and says why names both
           * the reason and the screen that changes it, and `addNode` refuses
           * with the same sentence when the number key is pressed instead.
           */
          const lock = lockedBlocks[type] ?? "";
          return (
            <button
              key={type}
              type="button"
              // The number on the row is only a number until it says what it does.
              title={
                lock
                  ? `${definition.paletteLabel} — ${lock}`
                  : shortcut <= 9
                    ? `${definition.paletteLabel} qo'shish · klaviaturada ${shortcut} tugmasi`
                    : `${definition.paletteLabel} qo'shish`
              }
              aria-label={lock ? `${definition.paletteLabel} — ${lock}` : `${definition.paletteLabel} qo'shish`}
              // Pressed, not disabled. A disabled control answers nothing, and
              // the answer is the point: the click is what prints the reason.
              aria-disabled={lock ? true : undefined}
              onClick={() => addNode(type)}
              className={cn(
                "flex items-center rounded-md px-2 py-[7px] text-[12px] transition-colors",
                // The gap belongs to the row that has a label. It used to sit
                // in the always-on string with `gap-0` beside it on the rail
                // branch, which never applied — `cn` is clsx, so both classes
                // are emitted and the stylesheet picks, and it picks the wrong
                // one.
                rail ? "justify-center" : "gap-[9px]",
                lock ? "text-neutral-600 hover:bg-neutral-850" : "text-neutral-300 hover:bg-neutral-800",
              )}
            >
              <span
                className={cn(
                  "flex h-5 w-5 flex-none items-center justify-center rounded-md border",
                  lock
                    ? "border-neutral-800 bg-neutral-900 text-neutral-600"
                    : "border-neutral-700 bg-neutral-850 text-neutral-300",
                )}
              >
                <Icon name={definition.icon} size={12} />
              </span>
              {!rail && (
                <>
                  <span className="flex-1 text-left">{definition.paletteLabel}</span>
                  {/* The plan, where the shortcut would be: the key does not
                      add this block either, so the number would be a promise
                      of the same thing the row is refusing. */}
                  {lock ? (
                    <Icon name="credit-card" size={12} className="flex-none text-neutral-600" />
                  ) : (
                    shortcut <= 9 && (
                      <span
                        title={`${shortcut} tugmasi shu blokni qo'shadi`}
                        className="min-w-[15px] rounded border border-neutral-800 text-center text-[10px] text-neutral-600"
                      >
                        {shortcut}
                      </span>
                    )
                  )}
                </>
              )}
            </button>
          );
        })}
        <button
          type="button"
          title="Boshqa oqimga o'tish bloki"
          aria-label="Oqimlar bloki qo'shish"
          onClick={() => addNode("flowlink")}
          className={cn(
            "flex items-center rounded-md px-2 py-[7px] text-[12px] text-neutral-300 transition-colors hover:bg-neutral-800",
            // Same as the rows above: the gap is the labelled branch's.
            rail ? "justify-center" : "gap-[9px]",
          )}
        >
          <span
            className="flex h-5 w-5 flex-none items-center justify-center rounded-md"
            style={{ border: "1px solid #c48fc444", background: "#c48fc422", color: "#c48fc4" }}
          >
            <Icon name="arrow-elbow-down-right" size={12} />
          </span>
          {!rail && <span className="flex-1 truncate text-left">Oqimlar</span>}
        </button>
      </div>

      {showHint && (
        <div className="border-t border-neutral-900 bg-accent-950/60 p-[10px]">
          <div className="mb-1 flex items-center gap-1.5">
            <Icon name="hand-waving" size={12} className="flex-none text-accent-300" />
            <span className="flex-1 text-[11px] font-medium text-accent-200">Bloklarni ulash</span>
          </div>
          <p className="text-[10.5px] leading-relaxed text-neutral-400">
            Blokning o&apos;ng chekkasidagi nuqtani bosing, so&apos;ng keyingi blokning chap nuqtasini bosing —
            ular bog&apos;lanadi. 1–9 tugmalari blok qo&apos;shadi, ⌘F blok qidiradi.
          </p>
          <button
            type="button"
            onClick={() => dismissHint(CONNECT_HINT)}
            className="mt-1.5 cursor-pointer text-[10.5px] text-accent-300 hover:text-accent-200"
          >
            Tushunarli, yopish
          </button>
        </div>
      )}
    </div>
  );
}
