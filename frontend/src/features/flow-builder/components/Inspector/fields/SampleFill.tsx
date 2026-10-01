import { Icon } from "@/components/ui/Icon";

/**
 * Fills an empty field with a working example.
 *
 * A placeholder shows the shape of an answer but leaves the author to retype
 * it; this writes it in, so the block is runnable one click after it is
 * dropped and the author edits something real instead of facing a blank. It
 * only exists while the field is empty — once there is content, offering to
 * overwrite it is a trap, not a shortcut.
 */
export function SampleFill({ onFill, label = "Namuna bilan to'ldirish" }: { onFill: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onFill}
      className="flex cursor-pointer items-center gap-1 self-start rounded-full border border-dashed border-neutral-700 px-2 py-[3px] text-[10.5px] max-md:text-[12px] text-neutral-500 transition-colors hover:border-accent-600 hover:text-accent-300"
    >
      <Icon name="sparkle" size={10} className="flex-none" />
      {label}
    </button>
  );
}
