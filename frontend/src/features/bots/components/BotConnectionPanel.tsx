"use client";

import { useState, useTransition } from "react";
import { Icon } from "@/components/ui/Icon";
import { Panel } from "@/components/ui/Panel";
import { cn } from "@/lib/utils/cn";
import { checkBotWebhookAction, reconnectBotWebhookAction } from "../actions";
import type { BotWebhook, WebhookCheck } from "../types";
import { webhookConditions, webhookFailures, webhookVerdict } from "../webhook-status";
import { ConnectionInfoRow } from "./ConnectionInfoRow";
import { TokenReveal } from "./TokenReveal";

/**
 * Everything about how the bot is wired up, as one line.
 *
 * The owner of a bot is not its administrator: this used to greet them with a
 * token, a raw webhook URL, four diagnostic rows and two buttons before they
 * could see a single flow — a screenful answering a question they only ask when
 * something is broken. So the answer comes first and the evidence stays one
 * click away, and when the answer is "muammo bor" the evidence is already open,
 * because that is the visit where they needed it.
 *
 * Closed, it is one list row: a tinted status square, "Ulanish", the verdict on
 * the right, a chevron. The header used to carry four things that only existed
 * from `md` up — a second half of the sentence, the check time, the word
 * "Batafsil" — none of which a phone ever saw, and all of which were a
 * different size from each other.
 *
 * **The two repair buttons are back, and they were the point of the panel.**
 * Taking them out took the check with them: `checkBotWebhookAction` and
 * `reconnectBotWebhookAction` were left in `actions.ts` and called from no
 * screen at all, so the one class of failure this product cannot self-diagnose
 * — the public address moved and Telegram is still posting to the old one —
 * had a fix nobody could reach. The reconcile pass repairs it unasked every ten
 * minutes, which is exactly why the button reporting "hammasi joyida" is
 * useful: it says the silent bot's problem is somewhere else.
 *
 * The URL is still not printed. It carries `webhook_token`, which *is* the
 * endpoint's access control, so putting it on a screen — or in a screenshot,
 * which is where it ended up — hands that out. Neither button needs it: they
 * name the bot and the server computes the address.
 */
export function BotConnectionPanel({
  botId,
  handle,
  tokenMasked,
  webhook,
  canEdit,
}: {
  botId: string;
  handle: string;
  tokenMasked: string;
  webhook: BotWebhook;
  canEdit: boolean;
}) {
  // What the last press learned, or null while nobody has pressed anything.
  // Kept apart from `webhook` on purpose: that one is what the page was
  // rendered with, and the whole reason to press the button is to find out
  // whether it is still true.
  const [checked, setChecked] = useState<WebhookCheck | null>(null);
  const [busy, startTransition] = useTransition();
  const [note, setNote] = useState("");

  // The webhook is still *read* — it is what decides whether this row says
  // "Ulanish" or "muammo bor". Before a press there has been no probe, so the
  // reachability condition has no answer yet and says so rather than failing.
  const live: BotWebhook = checked
    ? { ...webhook, actualUrl: checked.actualUrl, url: checked.expectedUrl, error: checked.error, pending: checked.pending }
    : webhook;
  const conditions = webhookConditions(live, checked?.probe ?? null);
  const failed = webhookFailures(conditions);
  const [open, setOpen] = useState(failed.length > 0);
  const broken = failed.length > 0;

  function run(what: "check" | "reconnect") {
    setNote("");
    startTransition(async () => {
      const result = what === "check" ? await checkBotWebhookAction(botId) : await reconnectBotWebhookAction(botId);
      if (!result) {
        setNote("Buning uchun tahrirlash huquqi kerak.");
        return;
      }
      setChecked(result);
      setNote(webhookVerdict(webhookConditions({ ...webhook, ...result, url: result.expectedUrl }, result.probe)));
    });
  }

  return (
    <Panel className="overflow-hidden">
      <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)} className="oq-row w-full cursor-pointer">
        <span
          className={cn(
            "flex h-[29px] w-[29px] flex-none items-center justify-center rounded-[8px] text-white",
            broken ? "bg-danger-fg" : "bg-success-fg",
          )}
        >
          <Icon name={broken ? "warning" : "check-circle"} size={17} />
        </span>
        <span className={cn("t-body flex-none", broken && "text-danger-fg")}>Ulanish</span>
        <span className="t-body t-secondary min-w-0 flex-1 truncate text-right">
          {broken
            ? `${failed.length} ta muammo`
            : webhook.checkedAt
              ? `${webhook.checkedAt} tekshirilgan`
              : "Hammasi joyida"}
        </span>
        <Icon
          name="caret-down"
          size={15}
          className={cn("flex-none text-neutral-600 transition-transform duration-150", open ? "" : "-rotate-90")}
        />
      </button>

      {open && (
        <div className="flex flex-col gap-4 border-t border-separator p-4">
          <ConnectionInfoRow label="Bot manzili" value={handle} />
          <TokenReveal botId={botId} masked={tokenMasked} />

          {/* Only after a press. Before one there is nothing here the header
              row has not already said in a line, and four grey ticks stacked
              under it is the screenful this panel exists to have stopped
              being. */}
          {checked && (
            <ul className="m-0 flex list-none flex-col gap-1.5">
              {conditions.map((condition) => (
                <li key={condition.label} className="flex items-start gap-1.5">
                  <Icon
                    name={condition.ok === false ? "warning" : condition.ok === null ? "info" : "check-circle"}
                    size={13}
                    className={cn(
                      "mt-[3px] flex-none",
                      condition.ok === false ? "text-danger-fg" : condition.ok === null ? "text-neutral-600" : "text-success-fg",
                    )}
                  />
                  <span className="t-footnote min-w-0 flex-1">
                    <span className={condition.ok === false ? "text-danger-fg" : "t-secondary"}>{condition.label}</span>
                    {condition.detail && <span className="t-tertiary"> · {condition.detail}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {canEdit && (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap gap-2">
                <RepairButton icon="magnifying-glass" busy={busy} onClick={() => run("check")}>
                  Telegramdan tekshirish
                </RepairButton>
                <RepairButton icon="plugs-connected" busy={busy} onClick={() => run("reconnect")}>
                  Telegramga qayta ulash
                </RepairButton>
              </div>
              {/* What each one does, in the words of somebody who has never
                  heard the word "webhook" — which is every owner this product
                  is for. */}
              <p className="t-footnote t-tertiary m-0">
                {note ||
                  "«Tekshirish» — Telegramdan xabarlar qayerga borayotganini so'raydi. «Qayta ulash» — Telegramga ularni shu yerga yuborishni qaytadan aytadi; bot jim qolgan bo'lsa shundan boshlang."}
              </p>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

function RepairButton({
  icon,
  busy,
  onClick,
  children,
}: {
  icon: "magnifying-glass" | "plugs-connected";
  busy: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onClick}
      className="oq-press flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-[12px] bg-neutral-800 px-3 text-[15px] text-neutral-200 disabled:opacity-40 md:min-h-[36px] md:flex-none md:text-[13px]"
    >
      <Icon name={icon} size={15} className="flex-none" />
      {busy ? "Tekshirilmoqda…" : children}
    </button>
  );
}
