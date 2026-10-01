"use client";

import { useRef, useState, useTransition } from "react";
import { Icon } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
import { Input } from "@/components/ui/Input";
import { SegmentedTabs } from "@/components/ui/SegmentedTabs";
import { cn } from "@/lib/utils/cn";
import type { MediaSource, MediaSourceKind } from "@/features/flows";
import { showToast } from "@/components/ui/toast-store";
import { uploadMediaAction } from "@/features/media/actions";
import { FieldHint } from "./FieldHint";
import { FieldLabel } from "./FieldLabel";

/**
 * The two ways somebody with a file actually has one, and nothing else.
 *
 * `file_id` used to sit here as a third peer, which put a Telegram server
 * identifier — `AgACAgIAAxkBAAI…` — in front of a shop owner as one of three
 * equal answers to "where is the picture". It is still reachable, below,
 * because a flow imported or built against the Bot API may well carry one.
 */
const TABS: { value: MediaSourceKind; label: string }[] = [
  { value: "url", label: "Havola" },
  { value: "upload", label: "Yuklash" },
];

const EMPTY: MediaSource = { kind: "url", value: "" };

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Where a block's file comes from. Telegram accepts an HTTPS URL it fetches
 * itself, a `file_id` of something already on its servers, or raw multipart
 * bytes — the last of which needs somewhere to put the file first, so the
 * upload tab records the picked file and leaves `value` for the endpoint to
 * fill in.
 */
export function MediaSourceField({
  label,
  value,
  onChange,
}: {
  label: string;
  value?: MediaSource;
  onChange: (value: MediaSource) => void;
}) {
  const source = value ?? EMPTY;
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, startUpload] = useTransition();
  // Not a tab any more, so the field it belongs to takes the whole space while
  // it is in use rather than being a third option nobody asked for.
  const byFileId = source.kind === "file_id";

  function pick(file: File | undefined) {
    if (!file) return;
    // The name goes up immediately so the row is not empty while the bytes are
    // still travelling; `value` stays empty until there is an address, which is
    // what `contentIssues` reads to know the block is unfinished.
    onChange({ kind: "upload", value: "", fileName: `${file.name} · ${formatSize(file.size)}` });

    const form = new FormData();
    form.append("file", file);
    startUpload(async () => {
      const result = await uploadMediaAction(form);
      if (!result.ok || !result.media) {
        showToast(result.message ?? "Faylni yuklab bo'lmadi", { tone: "danger" });
        // Back to empty rather than leaving a name that stands for nothing: a
        // row naming a file the block does not have is the state this whole
        // change exists to remove.
        onChange({ kind: "upload", value: "", fileName: undefined });
        return;
      }
      onChange({
        kind: "upload",
        value: result.media.url,
        fileName: `${result.media.name} · ${formatSize(result.media.size)}`,
      });
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <FieldLabel>{label}</FieldLabel>

      {!byFileId && (
        <SegmentedTabs
          options={TABS}
          value={source.kind}
          onChange={(kind) => onChange({ kind, value: "", fileName: undefined })}
        />
      )}

      {source.kind === "url" && (
        <Input
          value={source.value}
          onChange={(event) => onChange({ ...source, value: event.target.value })}
          placeholder="https://example.com/rasm.jpg"
        />
      )}

      {byFileId && (
        <>
          <Input
            value={source.value}
            onChange={(event) => onChange({ ...source, value: event.target.value })}
            placeholder="AgACAgIAAxkBAAI..."
          />
          <FieldHint>Telegram serverida allaqachon mavjud faylning identifikatori.</FieldHint>
          <button
            type="button"
            onClick={() => onChange({ kind: "url", value: "", fileName: undefined })}
            className="oq-press cursor-pointer self-start px-1 py-1 text-[11px] text-accent-400 max-md:min-h-[44px] max-md:text-[13px]"
          >
            Havola yoki fayl bilan yuborish
          </button>
        </>
      )}

      {source.kind === "upload" && (
        <>
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            onChange={(event) => {
              pick(event.target.files?.[0]);
              event.target.value = "";
            }}
          />

          {source.fileName ? (
            <div className="flex items-center gap-2 rounded-md border border-neutral-800 bg-neutral-800/40 p-2">
              <Icon
                name={uploading ? "arrow-clockwise" : source.value ? "check-circle" : "paperclip"}
                size={13}
                className={cn("flex-none", uploading ? "animate-spin text-neutral-400" : source.value ? "text-success-fg" : "text-accent-400")}
              />
              <span className="min-w-0 flex-1 truncate text-[11.5px] max-md:text-[13px] text-neutral-300">{source.fileName}</span>
              <IconButton
                icon="x"
                label="Faylni olib tashlash"
                size={22}
                onClick={() => onChange({ kind: "upload", value: "" })}
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                pick(event.dataTransfer.files[0]);
              }}
              className={cn(
                "flex cursor-pointer flex-col items-center gap-1 rounded-md border border-dashed p-3 transition-colors",
                dragging ? "border-accent-500 bg-accent-900" : "border-neutral-700 hover:border-accent-600",
              )}
            >
              <Icon name="upload-simple" size={16} className="text-neutral-500" />
              <span className="text-[11px] max-md:text-[13px] text-neutral-400">Faylni tashlang yoki tanlang</span>
            </button>
          )}

        </>
      )}

      {/* The way to the identifier, said as what it is for rather than offered
          as an equal third answer. Only where it is not already in use. */}
      {!byFileId && (
        <button
          type="button"
          onClick={() => onChange({ kind: "file_id", value: "", fileName: undefined })}
          className="oq-press cursor-pointer self-start px-1 py-1 text-[11px] text-neutral-500 hover:text-accent-400 max-md:min-h-[44px] max-md:text-[13px]"
        >
          File ID bilan yuborish
        </button>
      )}
    </div>
  );
}
