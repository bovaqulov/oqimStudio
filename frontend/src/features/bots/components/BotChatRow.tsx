"use client";

import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/utils/cn";
import { refreshBotChatAction, removeBotChatAction } from "../actions";
import { CHAT_STATUS_LABELS, chatIcon, grantedCount, rightsFor } from "../data/chat-rights";
import type { BotChat } from "../types";

/**
 * One group or channel, and why the bot is or is not working in it.
 *
 * The findings are on the outside of the card, above the fold, because they are
 * the whole reason anybody opened this screen — «botim nega bu guruhda
 * ishlamayapti». Folding them into the detail panel would put the answer one
 * tap behind the question. What *is* folded is the rights list, the ids and the
 * dates: those are what somebody reads once the finding has told them where to
 * look.
 *
 * Nothing here decides what is wrong. `problems` arrives decided from
 * `apps/bots/chats.py::chat_problems`, which is the only place that can join
 * the bot's enabled modules, the rights Telegram granted and whether the last
 * refresh landed — three facts that live in three places, and a second copy of
 * the rule would let a chat read as healthy here and broken in the API.
 */
export function BotChatRow({ chat, botId, canManage }: { chat: BotChat; botId: string; canManage: boolean }) {
  const [open, setOpen] = useState(false);
  const [busy, startTransition] = useTransition();
  const [note, setNote] = useState("");

  const { granted, total } = grantedCount(chat);
  const worst = chat.problems.some((problem) => problem.tone === "danger") ? "danger" : chat.problems[0]?.tone;

  return (
    <div
      className={cn(
        "flex flex-col rounded-[14px] border bg-surface-raised",
        // The edge carries the verdict, so a list of twelve chats can be
        // skimmed for the broken one without reading a word.
        worst === "danger" ? "border-danger-fg/40" : worst === "warning" ? "border-warning-fg/30" : "border-separator",
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="oq-press flex min-h-[56px] w-full cursor-pointer items-center gap-3 rounded-[14px] px-3.5 py-3 text-left"
      >
        <span
          className={cn(
            "flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[10px]",
            chat.isMember ? "bg-accent-800 text-accent-200" : "bg-neutral-800 text-neutral-600",
          )}
        >
          <Icon name={chatIcon(chat)} size={18} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="t-body truncate font-medium">{chat.title || `#${chat.chatId}`}</span>
          <span className="t-footnote t-tertiary truncate">
            {chat.username ? `@${chat.username} · ` : ""}
            {CHAT_STATUS_LABELS[chat.status]}
            {/* The count and its age travel together: a number with no date on
                it is a claim, and this one survives a refresh that failed. */}
            {chat.memberCount !== null && ` · ${chat.memberCount} a'zo`}
            {chat.memberCount !== null && chat.memberCountAt && ` (${chat.memberCountAt})`}
          </span>
        </span>
        {chat.isAdministrator && chat.isMember && (
          <Badge tone={granted === total ? "success" : "neutral"}>
            {granted}/{total}
          </Badge>
        )}
        <Icon name={open ? "caret-up" : "caret-down"} size={14} className="flex-none text-neutral-600" />
      </button>

      {chat.problems.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-1.5 px-3.5 pb-3">
          {chat.problems.map((problem) => (
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
        <div className="animate-rise flex flex-col gap-3.5 border-t border-separator px-3.5 py-3.5">
          {chat.isAdministrator ? (
            <div className="flex flex-col gap-1.5">
              <span className="t-caption t-tertiary tracking-[.07em] uppercase">Huquqlar</span>
              {rightsFor(chat).map((right) => {
                const has = chat.rights[right.api] === true;
                return (
                  <span key={right.key} className="flex items-start gap-1.5" title={right.about}>
                    <Icon
                      name={has ? "check" : "x"}
                      size={12}
                      className={cn("mt-[3px] flex-none", has ? "text-success-fg" : "text-neutral-600")}
                    />
                    <span className={cn("t-footnote min-w-0 flex-1", has ? "text-neutral-300" : "text-neutral-600")}>
                      {right.label}
                    </span>
                  </span>
                );
              })}
            </div>
          ) : (
            <p className="t-footnote t-secondary m-0">
              Bot bu yerda administrator emas, shuning uchun hech qanday huquqi yo&apos;q. Telegramda chatni oching →
              Administratorlar → botni qo&apos;shing.
            </p>
          )}

          <div className="flex flex-col gap-1 border-t border-separator pt-3">
            <Fact label="Chat ID" value={String(chat.chatId)} />
            {chat.addedAt && <Fact label="Qo'shilgan sana" value={chat.addedAt} />}
            {!chat.isMember && chat.leftAt && <Fact label="Chiqarilgan" value={chat.leftAt} />}
            <Fact label="Oxirgi tekshiruv" value={chat.refreshedAt || "hech qachon"} />
            {chat.joinByRequest && <Fact label="Qo'shilish" value="tasdiqlash orqali" />}
          </div>

          {canManage && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setNote("");
                  startTransition(async () => {
                    const updated = await refreshBotChatAction(botId, chat.chatId);
                    setNote(updated ? "" : "Telegramdan javob olinmadi — ro'yxatdagi ma'lumot saqlanib qoldi.");
                  });
                }}
                className="oq-press flex min-h-[36px] cursor-pointer items-center gap-1.5 rounded-[10px] bg-neutral-800 px-3 text-[13px] text-neutral-200 disabled:opacity-40"
              >
                <Icon name="arrow-clockwise" size={13} />
                {busy ? "Tekshirilmoqda…" : "Telegramdan yangilash"}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setNote("");
                  startTransition(async () => {
                    const outcome = await removeBotChatAction(botId, chat.chatId);
                    if (!outcome.ok) setNote(outcome.message);
                  });
                }}
                className="oq-press flex min-h-[36px] cursor-pointer items-center gap-1.5 rounded-[10px] px-3 text-[13px] text-danger-fg disabled:opacity-40"
              >
                <Icon name="trash" size={13} />
                Ro&apos;yxatdan o&apos;chirish
              </button>
            </div>
          )}
          {/* Said where the button is, not in a footnote nobody reaches: a
              reader who believes this removed the bot from their group stops
              looking for the reason it is still answering there. */}
          {canManage && (
            <p className="t-caption t-tertiary m-0">
              O&apos;chirish faqat shu ro&apos;yxatdan olib tashlaydi — botni guruhdan Telegramning o&apos;zida
              chiqarasiz.
            </p>
          )}
          {note && <p className="t-footnote m-0 text-warning-fg">{note}</p>}
        </div>
      )}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="t-footnote t-tertiary flex-1">{label}</span>
      <span className="t-footnote t-secondary truncate font-mono tabular-nums">{value}</span>
    </div>
  );
}
