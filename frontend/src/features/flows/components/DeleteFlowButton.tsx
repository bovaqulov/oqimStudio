"use client";

import { useTransition } from "react";
import { Icon } from "@/components/ui/Icon";
import { showToast } from "@/components/ui/toast-store";
import { confirmDestructive } from "@/lib/telegram/MainButton";
import { hapticResult } from "@/lib/telegram/webapp";
import type { FlowSummary } from "../types";
import { deleteFlowAction } from "../actions";

/**
 * Deleting a flow, asked about by the client and carried out without a form.
 *
 * The `<form>` this used to be could not survive its own confirmation. The
 * button lives inside the card's "⋯" menu, and that menu closes itself on the
 * next tick after any click — which was correct while the confirm was
 * `window.confirm`, a *synchronous* call that returned before anything
 * unmounted. Telegram's `showPopup` is asynchronous: the menu closed, the form
 * went with it, and by the time the reader pressed "O'chirish" the ref pointed
 * at nothing. The press did nothing at all, twice over — no deletion, no error,
 * no sign that anything had been asked.
 *
 * So the action is called directly with a `FormData` built here. Nothing in the
 * document has to still exist when the answer comes back, which is the only
 * property that makes an async confirmation safe.
 */
export function DeleteFlowButton({ flow, className }: { flow: FlowSummary; className: string }) {
  const [pending, startTransition] = useTransition();

  async function remove() {
    const ok = await confirmDestructive({
      title: flow.name,
      message: "Oqim o'chiriladi. Buni orqaga qaytarib bo'lmaydi.",
      confirmText: "O'chirish",
    });
    if (!ok) return;

    hapticResult("warning");
    startTransition(async () => {
      const data = new FormData();
      data.set("flowId", flow.id);
      data.set("botId", flow.botId);
      data.set("moduleKey", flow.moduleKey);
      try {
        await deleteFlowAction(data);
      } catch (error) {
        // A redirect is thrown, not returned. The action itself no longer
        // redirects — it revalidates the two lists the row appears on — but
        // `getSession` still sends an expired session to the sign-out route,
        // and swallowing that would leave the reader pressing a dead button.
        // Anything else is a deletion that did not happen, and the reader is
        // owed that rather than a row that quietly stays put.
        if (isRedirect(error)) throw error;
        showToast(`${flow.name} · o'chirib bo'lmadi`, { tone: "danger" });
      }
    });
  }

  return (
    <button type="button" disabled={pending} onClick={remove} className={className}>
      <Icon name="trash" size={16} /> {pending ? "O'chirilmoqda…" : "O'chirish"}
    </button>
  );
}

/** Next signals a server-side redirect by throwing; it must not be swallowed. */
function isRedirect(error: unknown): boolean {
  return typeof (error as { digest?: unknown } | null)?.digest === "string"
    && String((error as { digest: string }).digest).startsWith("NEXT_REDIRECT");
}
