"use client";

import { useMemo } from "react";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/utils/cn";
import type { NodeType } from "@/features/flows";
import { acceptsIncomingEdge, getNodeDefinition } from "../../../node-registry";
import { FieldHint } from "./FieldHint";
import { FieldLabel } from "./FieldLabel";

/** One block of a target flow, as the picker lists it. */
export interface FlowLinkBlock {
  id: string;
  title: string;
  type: NodeType;
}

export interface FlowLinkOption {
  id: string;
  name: string;
  /** Every block of that flow — the picker keeps the ones a jump may land on. */
  blocks: FlowLinkBlock[];
}

/**
 * Blocks a jump can land on. Two kinds are left out, for the same reason in
 * both directions:
 *
 *  · a Handler answers an update Telegram delivered, and a jump carries no
 *    update to hand it, so the flow would stall on arrival;
 *  · another jump block is not a destination but a forwarding address — the
 *    conversation would arrive somewhere the author cannot see from here.
 */
function isLandable(block: { type: NodeType }): boolean {
  return acceptsIncomingEdge(block.type) && block.type !== "flowlink";
}

/**
 * Where a "Oqimga o'tish" block sends the conversation: which flow, and which
 * step inside it.
 *
 * The step is the half that matters in practice. "Asosiy oqim" run from its
 * beginning re-sends a welcome the customer has already read; what the author
 * meant was the menu three blocks in. So a jump always names a block — picking
 * a flow takes its first landable one, and the list below changes it.
 */
export function FlowLinkField({
  options,
  selectedId,
  selectedBlockId,
  onSelect,
  onSelectBlock,
}: {
  options: FlowLinkOption[];
  selectedId?: string;
  selectedBlockId?: string;
  /** The flow, together with the block the jump lands on until it is changed. */
  onSelect: (id: string, block: FlowLinkBlock | undefined) => void;
  onSelectBlock: (block: FlowLinkBlock) => void;
}) {
  const selected = options.find((option) => option.id === selectedId);

  /*
   * The blocks come from the page, which read them from the backend. The editor
   * autosaves every edit there, so that record is the current one — a picker
   * listing yesterday's blocks is worse than none.
   */
  const blocksByFlow = useMemo(() => {
    const map = new Map<string, FlowLinkBlock[]>();
    for (const option of options) {
      map.set(option.id, option.blocks.filter((block) => isLandable(block)));
    }
    return map;
  }, [options]);

  const blocks = (selected && blocksByFlow.get(selected.id)) || [];

  // A block that was picked and has since been deleted or turned into a
  // Handler: said out loud, because the jump silently falls back to the start.
  const missingBlock = !!selectedBlockId && !blocks.some((block) => block.id === selectedBlockId);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-col gap-0.5">
        <FieldLabel>Kerakli oqimni tanlang</FieldLabel>
      </div>
      {options.length === 0 ? (
        <div className="rounded-md border border-dashed border-neutral-800 p-[10px] text-center text-[11px] max-md:text-[13px] text-neutral-500">
          Bu bo&apos;limda boshqa oqim yo&apos;q
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {options.map((option) => {
            const active = option.id === selectedId;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => onSelect(option.id, blocksByFlow.get(option.id)?.[0])}
                className={cn(
                  "flex items-center gap-2 rounded-md border px-[9px] py-[7px] text-left text-[11.5px] max-md:text-[13px] transition-colors",
                  active
                    ? "border-accent-700 bg-accent-800 text-accent-ink"
                    : "border-neutral-800 text-neutral-400 hover:border-accent-600",
                )}
              >
                <Icon name="arrow-elbow-down-right" size={12} className="flex-none" style={{ color: "#c48fc4" }} />
                <span className="flex-1 truncate">{option.name}</span>
                {active && <Icon name="check" size={12} className="flex-none" />}
              </button>
            );
          })}
        </div>
      )}

      {selected && (
        <div className="mt-1 flex flex-col gap-1.5 border-t border-neutral-800 pt-2">
          <FieldLabel>Qaysi blokdan boshlansin?</FieldLabel>

          {blocks.map((block) => {
            const definition = getNodeDefinition(block.type);
            const active = block.id === selectedBlockId;
            return (
              <button
                key={block.id}
                type="button"
                onClick={() => onSelectBlock(block)}
                className={cn(
                  "flex items-center gap-2 rounded-md border px-[9px] py-[6px] text-left text-[11px] max-md:text-[13px] transition-colors",
                  active
                    ? "border-accent-700 bg-accent-800 text-accent-ink"
                    : "border-neutral-800 text-neutral-400 hover:border-accent-600",
                )}
              >
                <Icon name={definition.icon} size={11} className="flex-none" style={{ color: definition.color }} />
                <span className="min-w-0 flex-1 truncate">{block.title || definition.kindLabel}</span>
                <span className="flex-none text-[9.5px] max-md:text-[12px] text-neutral-600">{definition.kindLabel}</span>
                {active && <Icon name="check" size={11} className="flex-none" />}
              </button>
            );
          })}

          {missingBlock && (
            <p className="flex items-start gap-1.5 text-[10.5px] max-md:text-[12px] leading-relaxed text-warning-fg">
              <Icon name="warning" size={11} className="mt-[2px] flex-none" />
              Tanlangan blok bu oqimda topilmadi — o&apos;chirilgan bo&apos;lishi mumkin. Ro&apos;yxatdan boshqasini
              tanlang.
            </p>
          )}

          {blocks.length === 0 ? (
            <p className="flex items-start gap-1.5 text-[10.5px] max-md:text-[12px] leading-relaxed text-warning-fg">
              <Icon name="warning" size={11} className="mt-[2px] flex-none" />
              Bu oqimda o&apos;tish tushadigan blok yo&apos;q — unga avval xabar yoki boshqa javob bloki qo&apos;shing.
            </p>
          ) : (
            <FieldHint>
              Handler va o&apos;tish bloklari ro&apos;yxatda yo&apos;q: biri kelgan xabarga javob beradi, ikkinchisi
              esa yana boshqa oqimga uzatadi.
            </FieldHint>
          )}
        </div>
      )}
    </div>
  );
}
