"use client";

import { useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
import { Modal } from "@/components/ui/Modal";
import { NodeFields } from "./Inspector/NodeFields";
import type { FlowLinkOption } from "./Inspector/fields/FlowLinkField";
import { TelegramPreview } from "./preview/TelegramPreview";
import { getNodeDefinition } from "../node-registry";
import { useFlowEditorStore } from "../store/useFlowEditorStore";

/**
 * The expanded editor: the same fields as the docked Inspector, with room to
 * breathe and a live Telegram preview beside them. Preview is only meaningful
 * for blocks that actually send something, so other block types get the wider
 * form on its own.
 *
 * This is the deepest the editor ever goes. Nothing a block's fields can open
 * — a map, a confirm, a picker — is allowed to be a dialog of its own: a second
 * layer hides the block being edited behind the thing editing it, and leaves
 * Escape meaning two different things. Fields expand inside this panel instead.
 */
export function NodeEditorModal({ siblingFlows }: { siblingFlows: FlowLinkOption[] }) {
  const nodes = useFlowEditorStore((s) => s.nodes);
  const expandedNodeId = useFlowEditorStore((s) => s.expandedNodeId);
  const collapseNode = useFlowEditorStore((s) => s.collapseNode);
  const [previewOpen, setPreviewOpen] = useState(true);

  const node = nodes.find((n) => n.id === expandedNodeId);
  if (!node) return null;

  const definition = getNodeDefinition(node.type);
  // The invoice block sends a message too — it just builds it from product
  // fields instead of from a content picker.
  const hasPreview = definition.hasContent || definition.hasMedia;
  const showPreview = hasPreview && previewOpen;

  return (
    <Modal
      open
      onClose={collapseNode}
      labelledBy="node-editor-title"
      className={showPreview ? "max-w-[880px]" : "max-w-[560px]"}
    >
      <div className="flex flex-none items-center gap-2.5 border-b border-neutral-800 px-4 py-3">
        <span
          className="flex h-[28px] w-[28px] flex-none items-center justify-center rounded-md border border-neutral-700 bg-neutral-850"
          style={{ color: definition.color }}
        >
          <Icon name={definition.icon} size={14} />
        </span>
        <div className="min-w-0 flex-1">
          <div id="node-editor-title" className="truncate text-[13.5px] font-medium">
            {node.title || definition.kindLabel}
          </div>
          <div className="text-[10.5px] text-neutral-600">
            {definition.kindLabel} · ID: {node.id}
          </div>
        </div>
        {hasPreview && (
          <IconButton
            icon={previewOpen ? "eye" : "eye-slash"}
            label={previewOpen ? "Oldindan ko'rishni yashirish" : "Oldindan ko'rishni ochish"}
            size={28}
            active={previewOpen}
            onClick={() => setPreviewOpen((open) => !open)}
          />
        )}
        <IconButton icon="x" label="Yopish" size={28} onClick={collapseNode} />
      </div>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div className="flex min-w-0 flex-1 flex-col gap-3.5 overflow-y-auto p-4">
          <NodeFields node={node} siblingFlows={siblingFlows} />
        </div>

        {showPreview && (
          <div className="flex w-full flex-none flex-col gap-2 border-t border-neutral-800 bg-bg/40 p-4 md:w-[340px] md:border-t-0 md:border-l">
            <div className="flex items-center justify-between">
              <span className="text-[10.5px] tracking-[.06em] text-neutral-600 uppercase">Ko&apos;rinishi</span>
              <span className="text-[10px] text-neutral-600">real vaqtda</span>
            </div>
            <div className="min-h-[320px] flex-1">
              {/* The block itself, not a copy resolved on the way in: the
                  preview picks the language for every string it draws — see
                  [[TelegramPreview]] — and a second resolver here would be a
                  second set of fields to remember to add to. */}
              <TelegramPreview node={node} />
            </div>
            <p className="text-[10px] leading-relaxed text-neutral-600">
              O&apos;zgaruvchilar namuna qiymatlar bilan ko&apos;rsatilgan. Media fayllar hali yuklanmagani uchun
              o&apos;rniga joy egallovchi ko&apos;rinadi.
            </p>
          </div>
        )}
      </div>
    </Modal>
  );
}
