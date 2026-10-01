"use client";

import { Icon } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
import { getNodeDefinition, isFixedNodeType } from "../../node-registry";
import { useFlowEditorStore } from "../../store/useFlowEditorStore";
import { NodeFields } from "./NodeFields";
import type { FlowLinkOption } from "./fields/FlowLinkField";

export function Inspector({ siblingFlows }: { siblingFlows: FlowLinkOption[] }) {
  const nodes = useFlowEditorStore((s) => s.nodes);
  const primarySelectedId = useFlowEditorStore((s) => s.primarySelectedId);
  const isNarrow = useFlowEditorStore((s) => s.isNarrowViewport);
  const duplicateSelected = useFlowEditorStore((s) => s.duplicateSelected);
  const deleteSelected = useFlowEditorStore((s) => s.deleteSelected);
  const select = useFlowEditorStore((s) => s.select);
  const expandNode = useFlowEditorStore((s) => s.expandNode);

  const node = nodes.find((n) => n.id === primarySelectedId);

  // No selection, no dock: an empty panel only takes canvas away — the palette
  // on the left already says how to add a block.
  if (!node) return null;

  const kindLabel = getNodeDefinition(node.type).kindLabel;
  const title = node.title?.trim() || kindLabel;

  return (
    <div
      className="animate-rise absolute top-[14px] right-[14px] bottom-[14px] z-[9] flex flex-col overflow-hidden rounded-[14px] bg-overlay/92 shadow-md backdrop-blur-lg"
      style={{ width: isNarrow ? 272 : 296 }}
    >
      {/*
       * Pinned outside the scroll area: with a long block open you should never
       * have to scroll back up to see which block you are editing — or to reach
       * the duplicate/delete actions.
       */}
      <div className="flex flex-none items-center gap-[9px] border-b border-neutral-800 px-3.5 py-3">
        <span
          className="flex h-[26px] w-[26px] flex-none items-center justify-center rounded-md border border-neutral-700 bg-neutral-850"
          style={{ color: getNodeDefinition(node.type).color }}
        >
          <Icon name={getNodeDefinition(node.type).icon} size={13} />
        </span>
        {/*
         * The block's *name*, which is what everything else calls it.
         *
         * This said the block's kind over its internal id — «Xabar / ID: n2» —
         * while the card on the canvas beside it said «Xush kelibsiz» and the
         * warnings panel said the same. One block, three names, and the only
         * one nobody outside this file can use was the one printed largest.
         * `n2` is an array index in a saved graph; it is on screen in the
         * export and in the import errors, which is where it means something.
         *
         * The kind stays as the second line, and only when it adds something:
         * a block the author never renamed *is* called its own kind, and
         * «Xabar» over «Xabar» is the heading printed twice — the same rule the
         * phone's step sheet already follows.
         */}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12.5px] max-md:text-[15px] font-medium">{title}</div>
          {title !== kindLabel && (
            <div className="truncate text-[10.5px] max-md:text-[12px] text-neutral-600">{kindLabel}</div>
          )}
        </div>
        {isNarrow && (
          <IconButton icon="x" label="Yopish" size={26} tooltip tooltipAlign="end" onClick={() => select(null, false)} />
        )}
        <IconButton
          icon="corners-out"
          label="Kengaytirish va ko'rib chiqish"
          size={26}
          tooltip
          tooltipAlign="end"
          onClick={() => expandNode(node.id)}
        />
        {/* A block the flow owns has neither control: /start is the module's
            entry point, so there is nothing here to copy it or take it away. */}
        {!isFixedNodeType(node.type) && (
          <>
            <IconButton
              icon="copy"
              label="Nusxa olish"
              size={26}
              tooltip
              tooltipAlign="end"
              onClick={duplicateSelected}
            />
            <IconButton
              icon="trash"
              label="O'chirish"
              size={26}
              tone="danger"
              tooltip
              tooltipAlign="end"
              onClick={deleteSelected}
            />
          </>
        )}
      </div>

      {/* Keyed by node so per-block field state — collapsed sections, drag state — resets with the selection. */}
      <div key={node.id} className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-x-hidden overflow-y-auto p-3.5">
        <NodeFields node={node} siblingFlows={siblingFlows} docked />
      </div>
    </div>
  );
}
