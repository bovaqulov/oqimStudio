"use client";

import { useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
import { Modal } from "@/components/ui/Modal";
import { usePhoneViewport } from "@/lib/hooks/usePhoneViewport";
import type { FlowNode, NodeType } from "@/features/flows";
import { getConnectableNodeTypes } from "../../node-registry";
import { useFlowEditorStore } from "../../store/useFlowEditorStore";
import { ADD_CHOICES, nodeDefinitionOrNull } from "./step-meta";

/**
 * What a step can be, asked one screen at a time.
 *
 * Six cards, not a palette of nine plus a keyboard shortcut for each: the
 * question "what happens next" has five everyday answers, and "Ko'proq" is
 * where the other block types live rather than a tenth thing to read past.
 * A card whose block type the registry does not know yet is shown and refused
 * — the list is what the product offers, not what this build happens to have.
 *
 * Two columns either way. On a phone the tiles grow instead of multiplying: six
 * answers is already the whole question, and a 44px icon over a 16px label is
 * what makes them answerable with a thumb.
 */
export function AddStepSheet({
  onClose,
  onPick,
  onLink,
  returnable,
  returnOnly = false,
}: {
  onClose: () => void;
  onPick: (type: NodeType, patch?: Partial<FlowNode>) => void;
  /** Points this exit at a step that already exists, instead of making a new one. */
  onLink: (toNodeId: string) => void;
  /** The steps already in the flow, in reading order — what a return can go to. */
  returnable: FlowNode[];
  /** Asks only where to go back to — for an «Orqaga» row, which can be nothing else. */
  returnOnly?: boolean;
}) {
  const moduleKey = useFlowEditorStore((s) => s.moduleKey);
  const [showAll, setShowAll] = useState(false);
  const [showReturn, setShowReturn] = useState(returnOnly);
  // The glyph grows with the tile it sits in — `Icon` takes a number, so this
  // is the one part of the phone reading a media query cannot say.
  const phone = usePhoneViewport();

  const everything = getConnectableNodeTypes(moduleKey);

  return (
    <Modal open onClose={onClose} labelledBy="add-step-title" className="max-w-[520px] self-end">
      <div className="flex flex-none items-center gap-2 border-b border-separator px-4 py-3">
        {(showAll || showReturn) && !returnOnly && (
          <IconButton
            icon="arrow-left"
            label="Orqaga"
            size={26}
            className="max-md:h-9 max-md:w-9"
            onClick={() => {
              setShowAll(false);
              setShowReturn(false);
            }}
          />
        )}
        {/* The title is the whole instruction. "Bittasini tanlang" under a
            grid of six tappable cards is a sentence describing the picture
            above it. */}
        <div id="add-step-title" className="t-headline min-w-0 flex-1 truncate">
          {showReturn ? "Qaysi blokka qaytadi?" : showAll ? "Barcha bloklar" : "Keyin nima bo'ladi?"}
        </div>
        <IconButton icon="x" label="Yopish" size={28} className="max-md:h-[38px] max-md:w-[38px]" onClick={onClose} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
        {showReturn ? (
          /*
           * A return, not a step. Simple mode could always *read* one — the
           * list prints "«X» blokiga qaytadi" — but the only way to write one
           * was to leave for the canvas and drag the edge by hand, which is
           * exactly what the "Pro rejimda to'liq ko'rinadi" banner was telling
           * people to do for the commonest thing a menu does.
           */
          <div className="flex flex-col gap-1">
            {returnable.length === 0 ? (
              <p className="t-footnote t-tertiary m-0 px-2 py-6 text-center">Qaytadigan blok yo&apos;q.</p>
            ) : (
              returnable.map((node, index) => {
                const definition = nodeDefinitionOrNull(node.type);
                return (
                  <button
                    key={node.id}
                    type="button"
                    onClick={() => onLink(node.id)}
                    className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-2 text-left hover:bg-neutral-800 max-md:min-h-[52px] max-md:gap-3 max-md:px-3"
                  >
                    <span className="t-footnote t-tertiary w-4 flex-none tabular-nums">{index + 1}</span>
                    <span
                      className="flex h-7 w-7 flex-none items-center justify-center rounded-md border border-neutral-700 bg-neutral-850 max-md:h-9 max-md:w-9"
                      style={{ color: definition?.color ?? "var(--color-neutral-500)" }}
                    >
                      <Icon name={definition?.icon ?? "flow-arrow"} size={phone ? 16 : 13} />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[17px] text-neutral-200 md:text-[13px]">
                      {node.title || definition?.kindLabel || "Blok"}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        ) : showAll ? (
          <div className="flex flex-col gap-1">
            {everything.map((type) => {
              const definition = nodeDefinitionOrNull(type);
              if (!definition) return null;
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => onPick(type)}
                  className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-2 text-left hover:bg-neutral-800 max-md:min-h-[52px] max-md:gap-3 max-md:px-3"
                >
                  <span
                    className="flex h-7 w-7 flex-none items-center justify-center rounded-md border border-neutral-700 bg-neutral-850 max-md:h-9 max-md:w-9"
                    style={{ color: definition.color }}
                  >
                    <Icon name={definition.icon} size={phone ? 16 : 13} />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[17px] text-neutral-200 md:text-[13px]">
                    {definition.paletteLabel}
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2 max-md:gap-2.5">
            {ADD_CHOICES.map((choice) => {
              const definition = choice.type ? nodeDefinitionOrNull(choice.type) : null;
              // A card for a type this build has not shipped yet stays on the
              // sheet and says why — a slot that silently disappears reads as a
              // feature the author imagined.
              const missing = choice.type !== null && definition === null;
              return (
                <button
                  key={choice.key}
                  type="button"
                  disabled={missing}
                  title={missing ? "Bu blok tez orada qo'shiladi" : undefined}
                  onClick={() => {
                    if (choice.type) onPick(choice.type, choice.patch);
                    else setShowAll(true);
                  }}
                  className={
                    missing
                      ? "flex cursor-not-allowed flex-col gap-1.5 rounded-[14px] border border-dashed border-neutral-800 p-3 text-left opacity-50 max-md:min-h-[132px] max-md:gap-2 max-md:p-4"
                      : "flex cursor-pointer flex-col gap-1.5 rounded-[14px] border border-neutral-800 bg-neutral-850 p-3 text-left transition-colors hover:border-accent-700 hover:bg-neutral-800 max-md:min-h-[132px] max-md:gap-2 max-md:p-4"
                  }
                >
                  <span
                    className="flex h-8 w-8 items-center justify-center rounded-md border border-neutral-700 bg-surface max-md:h-11 max-md:w-11"
                    style={{ color: definition?.color ?? "var(--color-neutral-500)" }}
                  >
                    <Icon name={choice.icon} size={phone ? 21 : 15} />
                  </span>
                  <span className="t-headline text-text">{choice.label}</span>
                  <span className="t-footnote t-secondary line-clamp-2">
                    {missing ? "Tez orada" : choice.hint}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* Under the six cards, not among them: returning is not a seventh
            kind of step, it is the other answer to "what happens next". Only
            offered when there is something above to go back to. */}
        {!showAll && !showReturn && returnable.length > 0 && (
          <button
            type="button"
            onClick={() => setShowReturn(true)}
            className="oq-press mt-2 flex w-full cursor-pointer items-center gap-2.5 rounded-[14px] border border-dashed border-neutral-800 px-3 py-3 text-left hover:border-accent-700 max-md:min-h-[56px]"
          >
            <span className="flex h-8 w-8 flex-none items-center justify-center rounded-md border border-neutral-700 bg-surface text-neutral-400 max-md:h-11 max-md:w-11">
              <Icon name="arrow-counter-clockwise" size={phone ? 21 : 15} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[17px] text-neutral-200 md:text-[13px]">
                Avvalgi blokka qaytish
              </span>
              <span className="t-footnote t-secondary block truncate">Yangi blok yaratmaydi</span>
            </span>
            <Icon name="caret-right" size={13} className="flex-none text-neutral-600" />
          </button>
        )}
      </div>
    </Modal>
  );
}
