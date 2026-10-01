import { ToggleChip } from "@/components/ui/ToggleChip";
import type { MediaKind } from "@/features/flows";
import { FieldLabel } from "./FieldLabel";

const MEDIA_OPTIONS: { key: MediaKind; label: string }[] = [
  { key: "photo", label: "Rasm" },
  { key: "video", label: "Video" },
  { key: "audio", label: "Audio" },
  { key: "voice", label: "Ovozli xabar" },
  { key: "document", label: "Hujjat" },
];

export function MediaField({
  value,
  onChange,
}: {
  value?: MediaKind;
  onChange: (value: MediaKind | undefined) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <FieldLabel>Media</FieldLabel>
      <div className="flex flex-wrap gap-1.5">
        <ToggleChip active={!value} onClick={() => onChange(undefined)}>
          Yo&apos;q
        </ToggleChip>
        {MEDIA_OPTIONS.map((option) => (
          <ToggleChip
            key={option.key}
            active={value === option.key}
            onClick={() => onChange(value === option.key ? undefined : option.key)}
          >
            {option.label}
          </ToggleChip>
        ))}
      </div>
    </div>
  );
}
