"use client";

import { useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { cn } from "@/lib/utils/cn";
import type { AlbumItem, AlbumItemKind } from "@/features/flows";
import type { LocalizedText } from "@/features/flows/localized-text";
import { ALBUM_ITEM_KIND_OPTIONS, ALBUM_MAX_ITEMS, createAlbumItem } from "../../../lib/message-content";
import { FieldHint } from "./FieldHint";
import { FieldLabel } from "./FieldLabel";
import { LocalizedLabel, useLocalizedText } from "./TextLanguage";
import { MediaSourceField } from "./MediaSourceField";

/** `sendMediaGroup` editor — 2–10 items, reorderable, with the caption living on the first entry. */
export function AlbumField({ items, onChange }: { items: AlbumItem[]; onChange: (items: AlbumItem[]) => void }) {
  const [dragId, setDragId] = useState<string | null>(null);

  function update(id: string, patch: Partial<AlbumItem>) {
    onChange(items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }
  function reorder(targetId: string) {
    if (!dragId || dragId === targetId) return;
    const from = items.findIndex((item) => item.id === dragId);
    const to = items.findIndex((item) => item.id === targetId);
    if (from === -1 || to === -1) return;
    const next = [...items];
    const [moved] = next.splice(from, 1);
    if (!moved) return;
    next.splice(to, 0, moved);
    onChange(next);
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <FieldLabel>Albom elementlari</FieldLabel>
        <span className="text-[10px] max-md:text-[12px] text-neutral-600">
          {items.length}/{ALBUM_MAX_ITEMS}
        </span>
      </div>

      {items.map((item, index) => (
        <div
          key={item.id}
          draggable
          // Stopped at the card for the same reason as ButtonsField's: in
          // Simple mode this editor sits inside the step's own draggable <li>,
          // and a bubbled dragstart turns an album reorder into a step reorder.
          onDragStart={(event) => {
            event.stopPropagation();
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", item.id);
            setDragId(item.id);
          }}
          onDragOver={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onDrop={(event) => {
            event.preventDefault();
            event.stopPropagation();
            reorder(item.id);
          }}
          onDragEnd={(event) => {
            event.stopPropagation();
            setDragId(null);
          }}
          className={cn(
            "flex flex-col gap-1.5 rounded-md border border-neutral-800 bg-neutral-800/40 p-[8px] transition-opacity",
            dragId === item.id && "opacity-40",
          )}
        >
          <div className="flex items-center gap-1.5">
            <span className="cursor-grab text-neutral-600" title="Tashish uchun torting">
              <Icon name="dots-three" size={13} />
            </span>
            <Select
              value={item.kind}
              onChange={(event) => update(item.id, { kind: event.target.value as AlbumItemKind })}
              className="flex-1"
            >
              {ALBUM_ITEM_KIND_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
            <IconButton icon="x" label="O'chirish" size={26} onClick={() => onChange(items.filter((x) => x.id !== item.id))} />
          </div>
          <MediaSourceField
            label="Manba"
            value={item.source}
            onChange={(source) => update(item.id, { source })}
          />
          {index === 0 && (
            <CaptionField value={item.caption} onChange={(caption) => update(item.id, { caption })} />
          )}
        </div>
      ))}

      {items.length < ALBUM_MAX_ITEMS && (
        <button
          type="button"
          onClick={() => onChange([...items, createAlbumItem()])}
          className="flex items-center gap-1 self-start rounded-md border border-dashed border-neutral-700 px-[10px] py-[5px] text-[11.5px] max-md:text-[13px] text-neutral-400 hover:border-accent-500 hover:text-accent-400"
        >
          <Icon name="plus" size={11} /> Element
        </button>
      )}
      <FieldHint>
        Izoh birinchi elementga biriktiriladi. Audio va fayl boshqa turlar bilan aralashtirilmaydi.
      </FieldHint>
    </div>
  );
}

/**
 * The album's caption, which Telegram takes off the first item alone.
 *
 * It had no label row of its own — the placeholder said what it was — and one
 * is added here rather than left off, because the language switch has nowhere
 * else to sit: a caption is the one sentence in an album a customer reads, so
 * it is exactly the thing a Russian-speaking customer should not get in Uzbek.
 */
function CaptionField({ value, onChange }: { value?: LocalizedText; onChange: (value: LocalizedText) => void }) {
  const caption = useLocalizedText(value, onChange);

  return (
    <div className="flex flex-col gap-1">
      <LocalizedLabel label="Izoh" value={value ?? ""} />
      <Input
        value={caption.value}
        onChange={(event) => caption.onChange(event.target.value)}
        // An empty translation shows what goes out in its place, so leaving one
        // blank reads as a decision rather than as a caption nobody wrote.
        placeholder={caption.fallback || "Albom izohi (ixtiyoriy)"}
      />
    </div>
  );
}
