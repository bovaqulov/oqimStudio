"use client";

import { Icon } from "@/components/ui/Icon";
import { Input } from "@/components/ui/Input";
import { parseMessageLink } from "../../../lib/telegram-link";
import { FieldHint } from "./FieldHint";
import { FieldLabel } from "./FieldLabel";

/**
 * Points a block at an existing Telegram message to re-send with
 * `copyMessage`. The link is stored as typed and resolved on the fly, so what
 * the field shows is exactly what the parser will hand the Bot API.
 */
export function CopyMessageField({ value, onChange }: { value?: string; onChange: (value: string) => void }) {
  const raw = value ?? "";
  const link = raw.trim() ? parseMessageLink(raw) : null;

  return (
    <div className="flex flex-col gap-1">
      <FieldLabel>Xabar havolasi</FieldLabel>
      <Input
        value={raw}
        onChange={(event) => onChange(event.target.value)}
        placeholder="https://t.me/kanal/123"
      />

      {link ? (
        <div className="flex flex-col gap-1 rounded-md border border-neutral-800 bg-neutral-800/40 p-2">
          <Row label="Chat" value={link.chatId} />
          <Row label="Xabar ID" value={String(link.messageId)} />
          {link.threadId !== undefined && <Row label="Mavzu" value={String(link.threadId)} />}
        </div>
      ) : raw.trim() ? (
        <div className="flex items-start gap-1.5 text-[11px] max-md:text-[13px] leading-relaxed text-warning-fg">
          <Icon name="warning" size={12} className="mt-[1px] flex-none" />
          <span>Bu t.me xabar havolasiga o&apos;xshamaydi.</span>
        </div>
      ) : null}

      <FieldHint>
        Telegram&apos;da xabar ustiga bosib &laquo;Copy Link&raquo; ni tanlang. Xabar manba nusxasiga havolasiz
        yuboriladi. Yopiq kanaldan nusxa olish uchun bot o&apos;sha kanalda bo&apos;lishi kerak.
      </FieldHint>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2 text-[11px] max-md:text-[13px]">
      <span className="w-[64px] flex-none text-neutral-600">{label}</span>
      <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] max-md:text-[12px] text-accent-200">{value}</span>
    </div>
  );
}
