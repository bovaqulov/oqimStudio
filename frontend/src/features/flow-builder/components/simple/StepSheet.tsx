"use client";

import { Icon } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
import { Modal } from "@/components/ui/Modal";
import { MainButton } from "@/lib/telegram/MainButton";
import { isFixedNodeType } from "../../node-registry";
import { NodeFields } from "../Inspector/NodeFields";
import type { FlowLinkOption } from "../Inspector/fields/FlowLinkField";
import { TelegramPreview } from "../preview/TelegramPreview";
import { useFlowEditorStore } from "../../store/useFlowEditorStore";
import { nodeDefinitionOrNull } from "./step-meta";

/**
 * Everything a block can be set to, in one sheet over the chat.
 *
 * The chat itself only ever edits what the customer reads — the words and the
 * button labels. Every other setting (the file, the answer type, the keyboard
 * kind, a condition's rules) lives here, behind the ⚙ on the bubble, so the
 * screen an owner builds on is not a form. These are the same `NodeFields` the
 * Pro inspector renders: a field added there is never quietly missing here.
 *
 * Opened by `expandedNodeId`, which is also what the warnings panel sets to
 * take the author to a block — so "go to the problem" works from any screen.
 */
export function StepSheet({ siblingFlows }: { siblingFlows: FlowLinkOption[] }) {
  const expandedNodeId = useFlowEditorStore((s) => s.expandedNodeId);
  const node = useFlowEditorStore((s) => s.nodes.find((n) => n.id === s.expandedNodeId));
  const collapseNode = useFlowEditorStore((s) => s.collapseNode);
  const removeSimpleStep = useFlowEditorStore((s) => s.removeSimpleStep);

  if (!expandedNodeId || !node) return null;
  const definition = nodeDefinitionOrNull(node.type);
  const title = node.title?.trim() || definition?.kindLabel || "Blok";
  const hasPreview = !!definition && (definition.hasContent || definition.hasMedia);

  return (
    <Modal open onClose={collapseNode} labelledBy={`step-sheet-${node.id}`} className="max-w-[560px]">
      <div className="flex flex-none items-center gap-2.5 border-b border-separator px-4 py-3">
        <span
          className="flex h-9 w-9 flex-none items-center justify-center rounded-md border border-neutral-700 bg-neutral-850"
          style={{ color: definition?.color }}
        >
          <Icon name={definition?.icon ?? "flow-arrow"} size={16} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span id={`step-sheet-${node.id}`} className="t-headline truncate">
            {title}
          </span>
          {definition && title !== definition.kindLabel && (
            <span className="t-footnote t-tertiary truncate">{definition.kindLabel}</span>
          )}
        </span>
        <IconButton icon="x" label="Yopish" size={34} onClick={collapseNode} />
      </div>

      {/* Keyed by block so per-field state belongs to the block being edited. */}
      <div key={node.id} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain p-4">
        {!definition ? (
          <p className="t-subhead t-secondary m-0">
            Bu blok turi («{node.type}») bu yerda sozlanmaydi — uni Pro rejimda oching.
          </p>
        ) : (
          <>
            {hasPreview && (
              <div className="flex flex-col gap-1.5">
                <span className="text-[10.5px] tracking-[.06em] text-neutral-600 uppercase">Ko&apos;rinishi</span>
                <div className="max-w-[340px]">
                  <TelegramPreview node={node} />
                </div>
              </div>
            )}
            <NodeFields node={node} siblingFlows={siblingFlows} />
          </>
        )}
        {!isFixedNodeType(node.type) && (
          <button
            type="button"
            onClick={() => removeSimpleStep(node.id)}
            className="oq-press flex min-h-[44px] cursor-pointer items-center gap-2 self-start rounded-[10px] px-2 text-[15px] text-danger-fg"
          >
            <Icon name="trash" size={16} /> O&apos;chirish
          </button>
        )}
      </div>

      {/* Nothing to save — autosave already wrote every keystroke — so the one
          button says the step is done rather than promising a write. */}
      <MainButton inline text="Tayyor" onClick={collapseNode} />
    </Modal>
  );
}
