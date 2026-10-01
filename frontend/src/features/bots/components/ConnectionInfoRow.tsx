"use client";

import { Icon } from "@/components/ui/Icon";
import { showToast } from "@/components/ui/toast-store";

/**
 * A read-only value with a copy button — the bot's address, and whatever else
 * somebody has to paste elsewhere.
 *
 * The `hint` prop is gone. It printed a grey sentence under every value saying
 * what the value was for ("Foydalanuvchilar shu manzil orqali botni ochadi"),
 * which the label above it already says in three words; two of those lines
 * stacked was most of the height of the panel they were in.
 */
export function ConnectionInfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="t-footnote t-secondary">{label}</span>
      <div className="flex items-stretch overflow-hidden rounded-[12px] bg-neutral-800">
        <span className="min-w-0 flex-1 self-center truncate px-3.5 font-mono text-[15px] text-text">{value}</span>
        <button
          type="button"
          aria-label="Nusxalash"
          onClick={() => {
            navigator.clipboard?.writeText(value).catch(() => {});
            showToast("Nusxalandi");
          }}
          className="flex min-h-[44px] w-11 flex-none cursor-pointer items-center justify-center text-neutral-500"
        >
          <Icon name="copy" size={17} />
        </button>
      </div>
    </div>
  );
}
