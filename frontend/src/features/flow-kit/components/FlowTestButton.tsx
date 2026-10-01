"use client";

import { useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
import { Modal } from "@/components/ui/Modal";
import type { FlowEdge, FlowNode } from "@/features/flows";
import { FlowChatPreview } from "./FlowChatPreview";

/**
 * "Sinash" on a flow card. Testing a flow used to mean opening the editor,
 * finding the test panel and starting a run — three steps away from the list
 * where the author is actually deciding whether the flow works. This is the same
 * runtime, one click from the card: the flow is walked by the engine Telegram
 * updates go through, so an answer this refuses is one the bot refuses too.
 */
export function FlowTestButton({
  flowId,
  flowName,
  nodes,
  edges,
  className,
}: {
  /** Runs on the real engine, so what the card tests is what the bot does. */
  flowId: string;
  flowName: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
  className: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* The dialog below is this component's own child, so whatever holds the
          button has to keep holding it while the chat is open — see the note on
          `closeAfterClick` in [[FlowRowMenu]], which is where this button
          actually lives. */}
      <button type="button" data-keeps-menu-open onClick={() => setOpen(true)} className={className}>
        <Icon name="play" size={16} /> Sinash
      </button>

      <Modal open={open} onClose={() => setOpen(false)} labelledBy="test-title" className="max-w-[420px]">
        <div className="flex flex-none items-center gap-2.5 border-b border-separator px-4 py-3">
          <span className="flex h-[29px] w-[29px] flex-none items-center justify-center rounded-[8px] bg-accent-700 text-white">
            <Icon name="play" size={16} />
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span id="test-title" className="t-headline truncate">
              {flowName}
            </span>
            {/* The one sentence this sheet owes the reader, and it is about
                consequence rather than mechanism: nothing they type here
                reaches a customer. */}
            <span className="t-footnote t-tertiary truncate">Sinov · mijozga xabar bormaydi</span>
          </span>
          <IconButton icon="x" label="Yopish" size={30} onClick={() => setOpen(false)} />
        </div>
        <div className="flex min-h-0 flex-1 flex-col p-3">
          {/* On a phone the dialog is a full-screen sheet, so the chat takes
              what is left of it rather than a fixed 420px with dead space
              underneath. The desktop dialog keeps the height it had. */}
          <FlowChatPreview
            flowId={flowId}
            nodes={nodes}
            edges={edges}
            className="min-h-0 flex-1 md:h-[420px] md:max-h-[60vh] md:flex-none"
          />
        </div>
      </Modal>
    </>
  );
}
