"use client";

import { Icon } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
import type { EdgeTransition } from "@/features/flows";
import { getNodeDefinition } from "../../node-registry";
import {
  MAX_DELETE_DELAY,
  TRANSITION_HINTS,
  TRANSITION_LABELS,
  TRANSITION_LADDER,
  resolveTransition,
  unavailableReason,
} from "../../lib/transitions";
import { useFlowEditorStore } from "../../store/useFlowEditorStore";
import { FieldHint } from "./fields/FieldHint";
import { TransitionChoice } from "./fields/TransitionChoice";
import { FieldLabel } from "./fields/FieldLabel";

/**
 * The panel behind a selected connection.
 *
 * Until now selecting a line could only delete it, because a connection had
 * nothing to say: it named two blocks and an exit and that was the whole of it.
 * It says one thing now — what happens to the message already on screen when
 * the block at the far end is delivered — and that belongs to the line rather
 * than to either block, because "keep the menu and send under it" and "replace
 * the menu in place" are two different things to say about the same pair.
 *
 * Impossible options are shown rather than hidden, each with the reason it
 * cannot be picked. Hiding them leaves an author changing the graph at random
 * to find out where «Tahrirlash» went; saying "the reply keyboard" turns a
 * mystery into a decision they can make.
 */
export function EdgeInspector() {
  const edges = useFlowEditorStore((s) => s.edges);
  const nodes = useFlowEditorStore((s) => s.nodes);
  const selectedEdgeId = useFlowEditorStore((s) => s.selectedEdgeId);
  const isNarrow = useFlowEditorStore((s) => s.isNarrowViewport);
  const setEdgeTransition = useFlowEditorStore((s) => s.setEdgeTransition);
  const setEdgeDeleteDelay = useFlowEditorStore((s) => s.setEdgeDeleteDelay);
  const deleteEdge = useFlowEditorStore((s) => s.deleteEdge);
  const selectEdge = useFlowEditorStore((s) => s.selectEdge);
  const readOnly = useFlowEditorStore((s) => s.readOnly);

  const edge = edges.find((e) => e.id === selectedEdgeId);
  const from = nodes.find((n) => n.id === edge?.from) ?? null;
  const to = nodes.find((n) => n.id === edge?.to);
  if (!edge || !to) return null;

  // What this line does today, whether or not anybody set it. There is no
  // "inherit" row: an author reading this panel wants to know what happens, and
  // a row that only says "ask somewhere else" made them go and look. The
  // resolved answer is simply shown as the chosen one, and picking it again
  // pins it — same behaviour, now written down.
  const active = resolveTransition(edge, to, from);

  return (
    <div
      className="animate-rise absolute top-[14px] right-[14px] bottom-[14px] z-[9] flex flex-col overflow-hidden rounded-[14px] bg-overlay/92 shadow-md backdrop-blur-lg"
      style={{ width: isNarrow ? 272 : 296 }}
    >
      <div className="flex flex-none items-center gap-[9px] border-b border-neutral-800 px-3.5 py-3">
        <span className="flex h-[26px] w-[26px] flex-none items-center justify-center rounded-md border border-neutral-700 bg-neutral-850 text-neutral-400">
          <Icon name="arrow-right" size={13} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12.5px] font-medium max-md:text-[15px]">Bog&apos;lanish</div>
          <div className="truncate text-[10.5px] text-neutral-600 max-md:text-[12px]">
            {from ? getNodeDefinition(from.type).kindLabel : "?"} → {getNodeDefinition(to.type).kindLabel}
          </div>
        </div>
        {isNarrow && (
          <IconButton icon="x" label="Yopish" size={26} tooltip tooltipAlign="end" onClick={() => selectEdge(null)} />
        )}
        {!readOnly && (
          <IconButton
            icon="trash"
            label="O'chirish"
            size={26}
            tone="danger"
            tooltip
            tooltipAlign="end"
            onClick={() => deleteEdge(edge.id)}
          />
        )}
      </div>

      <div key={edge.id} className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-x-hidden overflow-y-auto p-3.5">
        <div className="flex flex-col gap-1.5">
          <FieldLabel>Avvalgi xabar bilan nima bo&apos;ladi</FieldLabel>

          <div className="flex flex-col gap-1">
            {TRANSITION_LADDER.map((transition) => {
              const reason = unavailableReason(transition, from, to);
              return (
                <TransitionChoice
                  key={transition}
                  label={TRANSITION_LABELS[transition]}
                  // A row that is chosen *and* impossible says why rather than
                  // what: the author picked it before the blocks changed under
                  // it, and the reason is the thing they need.
                  hint={reason ?? TRANSITION_HINTS[transition]}
                  transition={transition}
                  selected={active === transition}
                  disabled={readOnly || reason !== null}
                  onSelect={() => setEdgeTransition(edge.id, transition)}
                />
              );
            })}
          </div>

          {/* Only under the row it belongs to. A delay is not a fifth choice —
              it is how the one above behaves — and a number sitting in the
              panel while «Qoldirish» is picked would read as a setting that
              does nothing, which is exactly what it would be. */}
          {active === "delete" && (
            <label className="mt-1 flex items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-900/40 px-2.5 py-2">
              <span className="flex-1 text-[11px] leading-snug text-neutral-400 max-md:text-[13px]">
                Necha soniyadan keyin o&apos;chirilsin
              </span>
              <input
                type="number"
                min={0}
                max={MAX_DELETE_DELAY}
                step={1}
                disabled={readOnly}
                value={edge.deleteAfterSeconds ?? 0}
                onChange={(event) => setEdgeDeleteDelay(edge.id, Number(event.target.value))}
                className="w-16 rounded-md border border-neutral-700 bg-neutral-850 px-2 py-1 text-right text-[12px] tabular-nums outline-none focus:border-accent-600 disabled:opacity-50"
              />
            </label>
          )}
          {active === "delete" && (
            <FieldHint>
              {edge.deleteAfterSeconds
                ? "Yangi xabar avval yuboriladi, eskisi ortidan o'chiriladi — o'qib ulgurish uchun."
                : "Eski xabar yangisi kelishidan oldin o'chadi, ya'ni mijoz ikkalasini birga ko'rmaydi."}{" "}
              Telegram 48 soatdan eski xabarni o&apos;chirtirmaydi; bunday holatda tugmalari olib tashlanadi.
            </FieldHint>
          )}
        </div>

        {/* Only while the line is still following the block. Once it has been
            set, the highlighted row says everything and this would be a line of
            chrome repeating it. */}
        {edge.transition === undefined && (
          <FieldHint>
            Hozircha «{getNodeDefinition(to.type).kindLabel}» blokining o&apos;zi hal qilyapti. Bu yerdan tanlasangiz
            faqat shu chiziq o&apos;zgaradi; hamma kiruvchi chiziqni birdaniga o&apos;zgartirish blokning ichida.
          </FieldHint>
        )}
      </div>
    </div>
  );
}
