"use client";

import { useState, useTransition } from "react";
import { Toggle } from "@/components/ui/Toggle";
import { showToast } from "@/components/ui/toast-store";
import { setFlowEnabledAction } from "../actions";
import type { FlowSummary } from "../types";

/**
 * The flow's on/off switch, on its card.
 *
 * Flips optimistically and rolls back if the write fails: the switch is the
 * fastest thing on the page and waiting a round trip to see the track move makes
 * the whole list feel broken. The toast then says which flow changed — the
 * author is usually looking at a different card by the time it lands.
 */
export function FlowEnableSwitch({ flow, enabled }: { flow: FlowSummary; enabled: boolean }) {
  const [optimistic, setOptimistic] = useState(enabled);
  const [pending, startTransition] = useTransition();
  const on = pending ? optimistic : enabled;

  function toggle() {
    const next = !on;
    setOptimistic(next);
    startTransition(async () => {
      const result = await setFlowEnabledAction({
        flowId: flow.id,
        botId: flow.botId,
        moduleKey: flow.moduleKey,
        enabled: next,
      });
      if (!result) {
        setOptimistic(!next);
        showToast(`${flow.name} · holatni o'zgartirib bo'lmadi`);
        return;
      }
      showToast(next ? `${flow.name} yoqildi` : `${flow.name} o'chirildi`);
    });
  }

  return (
    <span className="flex flex-none items-center">
      <Toggle checked={on} onToggle={toggle} label={`${flow.name} — ${on ? "o'chirish" : "yoqish"}`} />
    </span>
  );
}
