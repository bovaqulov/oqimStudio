"use client";

import { Icon } from "@/components/ui/Icon";
import { MARKDOWN_ACTIONS, type MarkdownAction } from "../../../lib/markdown";

/** Formatting strip above a message body. Mouse-down is suppressed so the textarea keeps its selection. */
export function MarkdownToolbar({ onApply }: { onApply: (action: MarkdownAction) => void }) {
  return (
    <div className="flex flex-wrap gap-0.5">
      {MARKDOWN_ACTIONS.map((action) => (
        <button
          key={action.id}
          type="button"
          title={action.label}
          aria-label={action.label}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onApply(action)}
          className="flex h-[22px] w-[22px] cursor-pointer items-center justify-center rounded border border-transparent text-neutral-500 transition-colors hover:border-neutral-700 hover:bg-neutral-800 hover:text-accent-300"
        >
          <Icon name={action.icon} size={12} />
        </button>
      ))}
    </div>
  );
}
