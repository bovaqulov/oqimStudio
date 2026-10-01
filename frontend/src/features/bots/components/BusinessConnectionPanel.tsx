"use client";

import { useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { InfoTip } from "@/components/ui/InfoTip";
import { cn } from "@/lib/utils/cn";
import { BUSINESS_RIGHT_GROUPS, BUSINESS_RIGHTS_TOTAL, isSensitiveRight } from "../data/business";
import type { BusinessConnection } from "../types";

/**
 * The account-level half of the `business` module: which Business account has
 * attached this bot, and what its owner allowed it to do there.
 *
 * **Read-only, and that is the correction this panel exists in.** What stood
 * here before was a fixture — an account called "Sunrise Academy" with a
 * handful of invented chats — rendered against every bot, including bots that
 * had never been attached to any Business account at all. Under it sat a
 * rights editor whose "save" fired a toast reading `account.updateConnectedBot`
 * and changed nothing, and a chat list whose pause and disconnect controls had
 * no backend behind them either.
 *
 * None of that could have been made to work by wiring it up. `updateConnectedBot`
 * is a method of Telegram's *client* API, called by the account's owner in
 * their own app — the Bot API gives a bot no way to grant itself a right or to
 * stop handling one of the owner's chats. So the rights are shown as Telegram
 * reports them and the controls are gone, which is the whole truth this screen
 * has access to.
 *
 * It was showing them wrongly for as long as it existed. The catalogue's `api`
 * fields were that same client method's flags — `reply`, `view_gifts`,
 * `sell_gifts` — and what a `business_connection` update carries is the Bot API
 * object, whose fields are `can_reply`, `can_view_gifts_and_stars`,
 * `can_convert_gifts_to_stars`. Not one name matched, so every account in the
 * product read as «0/14 huquq» and «Akkaunt egasi botga hech qanday huquq
 * bermagan» however much had been granted.
 *
 * `problems` is on the outside of the card, above the fold, for the reason
 * `BotChatRow` puts findings there: it is the answer to the question the panel
 * was opened with, and folding it away would put the answer one tap behind it.
 * It arrives decided from `apps/bots/business.py` — the join of Telegram's
 * grant with this workspace's own switches is one rule, and a second copy of it
 * here is how an account comes to read as healthy on one screen and broken in
 * the API.
 */
export function BusinessConnectionPanel({ connection }: { connection: BusinessConnection }) {
  const [open, setOpen] = useState(false);

  // `rights` arrives as Telegram's own `BusinessBotRights` object, so the
  // catalogue's `api` field is what joins the two: a right Telegram has not
  // heard of simply reads as not granted rather than throwing.
  const granted = BUSINESS_RIGHT_GROUPS.flatMap((group) =>
    group.rights.filter((right) => connection.rights[right.api] === true),
  );
  const sensitiveCount = granted.filter((right) => isSensitiveRight(right.key)).length;
  const title = connection.userName || connection.username || connection.connectionId;
  const worst = connection.problems.some((problem) => problem.tone === "danger")
    ? "danger"
    : connection.problems[0]?.tone;

  return (
    <div
      className={cn(
        "mb-3.5 rounded-md border bg-surface-raised",
        // The edge carries the verdict, so a reader with three accounts
        // attached can find the broken one without reading a word.
        worst === "danger"
          ? "border-danger-fg/40"
          : worst === "warning"
            ? "border-warning-fg/30"
            : "border-neutral-900",
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center gap-2.5 rounded-md px-4 py-[15px] text-left transition-colors hover:bg-neutral-800/40"
      >
        <Icon name="plugs-connected" size={15} className="flex-none text-accent-300" />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-[15px] md:text-[13.5px] font-medium">Business connection · {title}</span>
          {/* Folded, the header has to carry the reach — otherwise the only way
              to check what the bot may do is to open the panel and count. */}
          <span className="truncate text-[12px] md:text-[11px] text-neutral-600">
            {connection.username ? `@${connection.username} · ` : ""}
            {granted.length}/{BUSINESS_RIGHTS_TOTAL} huquq
          </span>
        </span>
        <span
          className={cn(
            "flex-none rounded-full px-2 py-[2px] text-[12px] md:text-[10px]",
            connection.isEnabled ? "bg-success-bg text-success-fg" : "bg-neutral-800 text-neutral-500",
          )}
        >
          {connection.isEnabled ? "active" : "suspended"}
        </span>
        <Icon name={open ? "caret-up" : "caret-down"} size={13} className="flex-none text-neutral-500" />
      </button>

      {connection.problems.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-1.5 px-4 pb-3.5">
          {connection.problems.map((problem) => (
            <li key={problem.code} className="flex items-start gap-1.5">
              <Icon
                name="warning"
                size={13}
                className={cn("mt-[3px] flex-none", problem.tone === "danger" ? "text-danger-fg" : "text-warning-fg")}
              />
              <span className={cn("t-footnote", problem.tone === "danger" ? "text-danger-fg" : "text-warning-fg")}>
                {problem.message}
              </span>
            </li>
          ))}
        </ul>
      )}

      {open && (
        <div className="animate-rise flex flex-col gap-4 px-4 pb-4">
          <div className="flex flex-col gap-3">
            {BUSINESS_RIGHT_GROUPS.map((group) => {
              const rows = group.rights.filter((right) => connection.rights[right.api] === true);
              if (rows.length === 0) return null;
              return (
                <div key={group.key} className="flex min-w-0 flex-col gap-1.5">
                  <span className="flex items-center gap-1.5 text-[12px] md:text-[10.5px] tracking-[.07em] text-neutral-600 uppercase">
                    <Icon name={group.icon} size={12} className="flex-none" />
                    {group.title}
                  </span>
                  {rows.map((right) => (
                    <span key={right.key} className="flex items-start gap-1.5 text-[13px] md:text-[12px]">
                      <Icon name="check" size={12} className="mt-1 flex-none text-success-fg" />
                      <span className="min-w-0 flex-1 text-neutral-300">{right.label}</span>
                      {right.sensitive && right.risk && (
                        <InfoTip text={right.risk} size={11} align="start" tone="warning" />
                      )}
                    </span>
                  ))}
                </div>
              );
            })}
            {granted.length === 0 && (
              <p className="t-footnote t-secondary m-0">
                Akkaunt egasi botga hech qanday huquq bermagan — bot bu akkauntda hech narsa qila olmaydi.
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5 border-t border-neutral-900 pt-[11px] text-[12px] md:text-[11px]">
            <InfoRow label="Berilgan huquqlar" value={`${granted.length} / ${BUSINESS_RIGHTS_TOTAL}`} />
            <InfoRow
              label="Shundan ehtiyot talab qiladi"
              value={String(sensitiveCount)}
              tone={sensitiveCount ? "warning" : "default"}
              tip={
                sensitiveCount
                  ? "Bu huquqlar akkauntga qaytarib bo'lmaydigan ta'sir ko'rsatadi: xabar o'chirish, profilni almashtirish yoki Stars ko'chirish."
                  : undefined
              }
            />
            <InfoRow label="Ulangan sana" value={connection.connectedAt} />
            <InfoRow label="Ulanish ID" value={connection.connectionId} />
          </div>

          {/* Said once, plainly: the controls are not missing, they are not
              ours. Without this the panel reads as a screen somebody forgot to
              finish. */}
          <div className="flex items-start gap-1.5 text-[12px] md:text-[11px] leading-relaxed text-neutral-600">
            <Icon name="info" size={12} className="mt-0.5 flex-none" />
            <span>
              Huquqlarni va botning ulanishini akkaunt egasi Telegramda boshqaradi: Sozlamalar → Business →
              Chatbots. Xabar turi, kalit so&apos;z va ish vaqti filtri esa har bir oqim ichida sozlanadi.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function InfoRow({
  label,
  value,
  tone = "default",
  tip,
}: {
  label: string;
  value: string;
  tone?: "default" | "warning";
  tip?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex flex-1 items-center gap-1 text-neutral-600">
        {label}
        {tip && <InfoTip text={tip} size={11} align="start" tone={tone === "warning" ? "warning" : "info"} />}
      </span>
      <span className={cn("font-mono tabular-nums", tone === "warning" ? "text-warning-fg" : "text-neutral-400")}>
        {value}
      </span>
    </div>
  );
}
