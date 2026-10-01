"use client";

import { useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";

/**
 * Shown when a flow was created by a template or the wizard, and the button
 * that said "Yaratish va yoqish" only managed the first half.
 *
 * Switching a flow on is checked against the plan, so it can be refused after
 * the flow already exists. Landing an author in a paused flow with no
 * explanation is how "I turned the template on" becomes "the bot ignores my
 * customers" — the toggle is right there in the top bar, but nothing says why
 * it is off, or that it was ever meant to be on.
 */
export function NotEnabledBanner({ show }: { show: boolean }) {
  const [dismissed, setDismissed] = useState(false);
  if (!show || dismissed) return null;

  return (
    <div className="absolute inset-x-[14px] top-[14px] z-[12] flex items-start gap-2.5 rounded-md border border-warning-fg/40 bg-warning-bg px-3.5 py-3 shadow-lg">
      <Icon name="warning" size={15} className="mt-0.5 flex-none text-warning-fg" />
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] font-medium text-warning-fg">Oqim yaratildi, lekin yoqilmadi</div>
        <p className="mt-0.5 text-[11.5px] leading-relaxed text-neutral-300">
          Tarifingiz bu oqimni ishga tushirishga yetmadi — hozircha u to&apos;xtatilgan holatda turibdi va
          mijozlarga javob bermaydi. Ortiqcha bloklarni olib tashlab &laquo;Ishga tushirish&raquo;ni bosing yoki
          tarifni ko&apos;taring.
        </p>
      </div>
      <Link
        href="/billing"
        className="flex-none cursor-pointer rounded-md bg-neutral-800 px-2.5 py-1.5 text-[11.5px] text-neutral-100 hover:bg-neutral-700"
      >
        Tariflar
      </Link>
      <button
        type="button"
        aria-label="Yopish"
        onClick={() => setDismissed(true)}
        className="flex-none cursor-pointer rounded-md p-1 text-neutral-400 hover:text-neutral-100"
      >
        <Icon name="x" size={13} />
      </button>
    </div>
  );
}
