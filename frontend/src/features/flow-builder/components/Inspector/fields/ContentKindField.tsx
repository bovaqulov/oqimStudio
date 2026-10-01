"use client";

import { useState } from "react";
import { Icon, type IconName } from "@/components/ui/Icon";
import { cn } from "@/lib/utils/cn";
import type { MessageContentKind } from "@/features/flows";
import { CONTENT_KINDS, getContentDefinition } from "../../../lib/message-content";
import { FieldLabel } from "./FieldLabel";
import { RevealPanel } from "./RevealPanel";

/**
 * The kinds a shop actually sends, in the order it sends them.
 *
 * Telegram gives a bot thirteen ways to say something and the grid used to show
 * all thirteen, five rows deep, under a question — "Nima yuboriladi?" — that
 * most people answer with the first tile. The other eight are a survey, a
 * venue, an invoice, a voice note: real, occasionally needed, and never the
 * thing somebody is looking for while dropping their first message block.
 */
const COMMON_KINDS: MessageContentKind[] = ["text", "photo", "video", "document", "location"];

const RARE_KINDS = CONTENT_KINDS.filter((kind) => !COMMON_KINDS.includes(kind));

/** Picks what a "Xabar" block sends. The choice drives every other field the Inspector shows below it. */
export function ContentKindField({
  value,
  onChange,
}: {
  value: MessageContentKind;
  onChange: (value: MessageContentKind) => void;
}) {
  const [open, setOpen] = useState(false);
  const hidden = RARE_KINDS.includes(value);
  // Collapsed with a rarer kind chosen, the sixth tile *is* that kind — the
  // grid has to say what this block sends before it says what else it could.
  const more = hidden && !open ? getContentDefinition(value) : null;

  return (
    <div className="flex flex-col gap-1">
      <FieldLabel>Nima yuboriladi?</FieldLabel>
      <div className="grid grid-cols-3 gap-1">
        {COMMON_KINDS.map((kind) => (
          <KindTile key={kind} kind={kind} active={kind === value} onSelect={onChange} />
        ))}
        <Tile
          icon={more?.icon ?? (open ? "caret-up" : "caret-down")}
          label={more?.label ?? "Ko'proq"}
          title={more ? more.api : "Qolgan yuborish turlari — so'rovnoma, invoys, kontakt, ovozli xabar"}
          active={!!more}
          expanded={open}
          onClick={() => setOpen((shown) => !shown)}
        />
      </div>

      {open && (
        <RevealPanel>
          <div className="grid grid-cols-3 gap-1">
            {RARE_KINDS.map((kind) => (
              <KindTile key={kind} kind={kind} active={kind === value} onSelect={onChange} />
            ))}
          </div>
        </RevealPanel>
      )}
    </div>
  );
}

function KindTile({
  kind,
  active,
  onSelect,
}: {
  kind: MessageContentKind;
  active: boolean;
  onSelect: (kind: MessageContentKind) => void;
}) {
  const definition = getContentDefinition(kind);
  return (
    <Tile
      icon={definition.icon}
      label={definition.label}
      title={definition.api}
      active={active}
      onClick={() => onSelect(kind)}
    />
  );
}

function Tile({
  icon,
  label,
  title,
  active,
  expanded,
  onClick,
}: {
  icon: IconName;
  label: string;
  title: string;
  active: boolean;
  /** Set on the reveal's own tile, which is a disclosure rather than a choice. */
  expanded?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-expanded={expanded}
      onClick={onClick}
      className={cn(
        "flex cursor-pointer flex-col items-center gap-1 rounded-md border px-1 py-[7px] text-[10px] max-md:text-[12px] transition-colors",
        active
          ? "border-accent-700 bg-accent-800 text-accent-ink"
          : "border-neutral-800 text-neutral-500 hover:border-neutral-600 hover:text-neutral-200",
      )}
    >
      <Icon name={icon} size={15} />
      <span className="w-full truncate text-center leading-tight">{label}</span>
    </button>
  );
}
