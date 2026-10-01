"use client";

import { useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { Input } from "@/components/ui/Input";
import { cn } from "@/lib/utils/cn";
import type { FlowNode } from "@/features/flows";
import {
  MAX_PRIORITY,
  MIN_PRIORITY,
  PRIORITY_LEVEL_LABEL,
  autoPriority,
  effectivePriority,
  handlerOrder,
  isPriorityOverridden,
} from "../../../lib/trigger";
import { FieldHint } from "./FieldHint";
import { FieldLabel } from "./FieldLabel";

/**
 * Which Handler wins when one update matches several of them — lower runs
 * first. The number is normally derived from the trigger itself (an exact
 * command outranks a keyword search, which outranks the catch-all), and this
 * field is the escape hatch for the cases the rule cannot know about.
 *
 * A priority is a position in a queue, and a number on its own cannot show a
 * position — so the queue itself is listed under it, with this block marked in
 * place. "#2" then reads as "after the /start block, before the catch-all".
 */
export function PriorityField({
  node,
  siblings,
  conflicts,
  onChange,
}: {
  node: FlowNode;
  /** Every block in the flow — the Handlers among them are the queue this one sits in. */
  siblings: FlowNode[];
  conflicts?: string[];
  onChange: (priority: number | undefined) => void;
}) {
  const auto = autoPriority(node);
  const value = effectivePriority(node);
  const overridden = isPriorityOverridden(node);
  const order = handlerOrder(siblings);
  /*
   * What is being typed, while it is being typed. Without it the field can never
   * be emptied — clearing it drops the override, the derived level flows straight
   * back in, and the digit you just deleted reappears under the cursor. The draft
   * is released on blur, so what is shown afterwards is always the real value.
   */
  const [draft, setDraft] = useState<string | null>(null);

  function commit(raw: string) {
    const trimmed = raw.trim();
    // An emptied field means "stop overriding", not "priority zero".
    if (!trimmed) return onChange(undefined);
    const parsed = Number.parseInt(trimmed, 10);
    if (Number.isNaN(parsed)) return;
    onChange(Math.min(MAX_PRIORITY, Math.max(MIN_PRIORITY, parsed)));
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <FieldLabel>Ustuvorlik</FieldLabel>
        {/* The badge is a state, and one of the two states is undoable — so that
            one is the button rather than a label with a separate control. */}
        {overridden ? (
          <button
            type="button"
            onClick={() => onChange(undefined)}
            title={`Avtomatik darajaga qaytarish (#${auto})`}
            className="flex cursor-pointer items-center gap-1 rounded bg-accent-900 px-[6px] py-[1px] text-[9.5px] max-md:text-[12px] text-accent-200 transition-colors hover:bg-accent-800"
          >
            qo&apos;lda
            <span className="text-accent-400">·</span>
            <Icon name="arrow-counter-clockwise" size={9} className="flex-none" />
            tiklash
          </button>
        ) : (
          <span className="rounded bg-neutral-800 px-[6px] py-[1px] text-[9.5px] max-md:text-[12px] text-neutral-500">avtomatik</span>
        )}
      </div>

      <div className="flex items-center gap-2">
        {/* Width lives on the wrapper: `cn` is plain clsx, so a `w-*` class on
            the Input itself would just race the field's own `w-full`. */}
        <div className="w-[72px] flex-none">
          <Input
            type="number"
            min={MIN_PRIORITY}
            max={MAX_PRIORITY}
            value={draft ?? value}
            aria-label="Ustuvorlik raqami"
            onChange={(event) => {
              setDraft(event.target.value);
              commit(event.target.value);
            }}
            onBlur={() => setDraft(null)}
            className="tabular-nums"
          />
        </div>
        <span className="min-w-0 flex-1 truncate text-[11.5px] max-md:text-[13px] text-neutral-400">
          {PRIORITY_LEVEL_LABEL[value] ?? "Qo'lda belgilangan"}
        </span>
      </div>

      {/* One Handler is a number with nothing to compare against; two or more is
          an order, and the order is the thing that actually decides behaviour. */}
      {order.length > 1 && (
        <div className="flex flex-col gap-1 rounded-md bg-neutral-900/70 px-2 py-1.5">
          <span className="text-[10px] max-md:text-[12px] text-neutral-600">Avval tekshiriladi:</span>
          <ol className="flex flex-col gap-[2px]">
            {order.map((entry) => {
              const current = entry.id === node.id;
              return (
                <li
                  key={entry.id}
                  className={cn(
                    "flex items-center gap-1.5 text-[10.5px] max-md:text-[12px]",
                    current ? "text-accent-200" : "text-neutral-500",
                  )}
                >
                  <span className="flex-none tabular-nums opacity-70">#{entry.priority}</span>
                  <span className="min-w-0 flex-1 truncate">{entry.title}</span>
                  {entry.overridden && (
                    <span className="flex-none text-[9px] max-md:text-[12px] text-neutral-600" title="Ustuvorlik qo'lda belgilangan">
                      qo&apos;lda
                    </span>
                  )}
                  {current && <Icon name="arrow-left" size={9} className="flex-none" />}
                </li>
              );
            })}
          </ol>
        </div>
      )}

      <FieldHint>
        Kichik raqam avval tekshiriladi. Shu shartlar uchun avtomatik daraja — #{auto}{" "}
        {PRIORITY_LEVEL_LABEL[auto] ? `(${PRIORITY_LEVEL_LABEL[auto]!.toLowerCase()})` : ""}.
      </FieldHint>

      {conflicts?.length ? (
        <div className="flex flex-col gap-1 rounded-md border border-warning-fg/35 bg-warning-bg p-2">
          <span className="flex items-center gap-1.5 text-[11px] max-md:text-[13px] text-warning-fg">
            <Icon name="warning" size={12} />
            Konflikt
          </span>
          <ul className="flex flex-col gap-[3px] text-[10.5px] max-md:text-[12px] leading-relaxed text-neutral-400">
            {conflicts.map((reason) => (
              <li key={reason}>· {reason}</li>
            ))}
          </ul>
          <FieldHint>
            Bir xil shartni ikki handler ushlasa, ustuvorlik ham yordam bermaydi — birini o&apos;zgartiring yoki
            o&apos;chiring.
          </FieldHint>
        </div>
      ) : null}
    </div>
  );
}
