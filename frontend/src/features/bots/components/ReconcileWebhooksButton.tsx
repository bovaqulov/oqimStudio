"use client";

import { useState, useTransition } from "react";
import { Icon } from "@/components/ui/Icon";
import { reconcileWebhooksAction } from "../actions";

/**
 * "Point every bot at this backend again."
 *
 * One button for the whole class of problem where the address moved under a
 * running product: a redeployment, a new development tunnel, a webhook somebody
 * set by hand. The same pass runs when a worker boots and every ten minutes, so
 * the honest answer here is usually "0 ta o'zgardi" — which is itself useful,
 * because it says the silent bot's problem is somewhere else.
 *
 * **It was rendered nowhere.** The component existed, `reconcileWebhooksAction`
 * existed, `POST /api/bots/reconcile-webhooks/` existed and worked — and no
 * screen in the product imported any of them, while a comment in
 * `BotConnectionPanel` told the reader this was "still available in
 * Sozlamalar". It is on the bots list now, which is the screen somebody is
 * looking at when *all* of their bots have gone quiet; one bot's own repair is
 * on its Sozlamalar tab, next to the verdict that sends them looking for it.
 *
 * The word "webhook" is gone from the label. It was the whole label — «Barcha
 * webhooklarni qayta ro'yxatdan o'tkazish» — for an audience that has never
 * registered one and never will. What it does is said underneath in the terms
 * the owner has: Telegram is being told again where to send messages.
 */
export function ReconcileWebhooksButton() {
  const [busy, startTransition] = useTransition();
  const [result, setResult] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setResult(null);
          startTransition(async () => {
            const outcome = await reconcileWebhooksAction();
            if (!outcome) {
              setResult("Buning uchun ruxsatingiz yo'q.");
              return;
            }
            setResult(
              outcome.changed > 0
                ? `${outcome.checked} ta bot tekshirildi, ${outcome.changed} tasi qayta ulandi.`
                : `${outcome.checked} ta bot tekshirildi — hammasi to'g'ri manzilga ulangan. Muammo boshqa joyda.`,
            );
          });
        }}
        className="oq-press oq-group oq-row t-body w-full text-accent-400 disabled:opacity-40"
      >
        <Icon name="plugs-connected" size={20} className="flex-none" />
        <span className="min-w-0 flex-1 text-left">
          {busy ? "Tekshirilmoqda…" : "Barcha botlarni Telegramga qayta ulash"}
        </span>
      </button>
      <p className="t-footnote t-tertiary m-0 px-4">
        {result ||
          "Hamma botlar birdaniga jim qolsa shundan boshlang: Telegramga xabarlarni qayerga yuborishni qaytadan aytadi. Bir bot uchun — o'sha botning Sozlamalar bo'limida."}
      </p>
    </div>
  );
}
