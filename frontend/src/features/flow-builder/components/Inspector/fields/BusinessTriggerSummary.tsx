"use client";

import { Icon } from "@/components/ui/Icon";
import type { BusinessTriggerConfig } from "@/features/flows";
import {
  businessChangedParts,
  businessTriggerIssues,
  describeBusinessTrigger,
} from "../../../lib/trigger";
import { FieldHint } from "./FieldHint";
import { FieldLabel } from "./FieldLabel";

/**
 * The Handler's condition as the docked panel shows it: what it fires on, which
 * layers were narrowed, and a way into the editor.
 *
 * The panel is ~270px wide and the editor is four layers deep — running the
 * same form in both places gave the narrow one wrapped chip rows and a scroll
 * nobody reaches the bottom of, and gave the user two versions of one control
 * to keep in their head. So the dock reads and the modal edits: the sentence
 * here is the same one the editor opens with, and the chips are only the layers
 * somebody actually moved — an untouched default is true but not worth the
 * width.
 */
export function BusinessTriggerSummary({
  business,
  onExpand,
}: {
  business?: BusinessTriggerConfig;
  onExpand: () => void;
}) {
  const changed = businessChangedParts(business);
  const issues = businessTriggerIssues(business);

  return (
    <div className="flex flex-col gap-2 rounded-md border border-neutral-800 bg-neutral-800/40 p-[11px]">
      <FieldLabel>Shart</FieldLabel>

      <div className="flex items-start gap-1.5 rounded-md bg-neutral-900/70 px-2 py-1.5">
        <Icon name="lightning" size={11} className="mt-[3px] flex-none text-accent-300" />
        <span className="min-w-0 flex-1 text-[10.5px] max-md:text-[12px] leading-relaxed text-neutral-300">
          {describeBusinessTrigger(business)}
        </span>
      </div>

      {changed.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {changed.map((part) => (
            <span
              key={part.key}
              className="max-w-full truncate rounded-full bg-accent-900 px-2 py-[2px] text-[10px] max-md:text-[12px] text-accent-200"
            >
              {part.label}
            </span>
          ))}
        </div>
      )}

      {/* A block that cannot mean what it says must not be something you only
          find out about by opening the editor. */}
      {issues.map((issue) => (
        <p
          key={issue.message}
          className={`flex items-start gap-1.5 text-[10.5px] max-md:text-[12px] leading-relaxed ${
            issue.level === "error" ? "text-danger-fg" : "text-warning-fg"
          }`}
        >
          <Icon name="warning" size={11} className="mt-[2px] flex-none" />
          <span>{issue.message}</span>
        </p>
      ))}

      <button
        type="button"
        onClick={onExpand}
        className="flex cursor-pointer items-center justify-center gap-1.5 rounded-md border border-neutral-700 bg-neutral-800 px-2 py-[7px] text-[11.5px] max-md:text-[13px] text-neutral-200 transition-colors hover:border-accent-600 hover:text-accent-200"
      >
        <Icon name="gear" size={12} className="flex-none" />
        Batafsil sozlash
      </button>
      <FieldHint>Ikki qatlam — tarkib va ish vaqti — kengaytirilgan oynada.</FieldHint>
    </div>
  );
}
