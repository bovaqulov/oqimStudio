"use client";

import { Icon } from "@/components/ui/Icon";
import { useFlowEditorStore } from "../store/useFlowEditorStore";

/**
 * Shown when the graph did not arrive.
 *
 * The editor keeps rendering — closing it would lose the reader's place — but
 * it stops writing, because the canvas it is looking at is not the flow. The
 * only useful action is to load the page again, so that is the only one
 * offered.
 */
export function ReadOnlyBanner() {
  const readOnly = useFlowEditorStore((state) => state.readOnly);
  if (!readOnly) return null;

  return (
    <div className="absolute inset-x-[14px] top-[14px] z-[12] flex items-start gap-2.5 rounded-md border border-warning-fg/40 bg-warning-bg px-3.5 py-3 shadow-lg">
      <Icon name="warning" size={15} className="mt-0.5 flex-none text-warning-fg" />
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] font-medium text-warning-fg">Oqim yuklanmadi — tahrirlash to&apos;xtatildi</div>
        <p className="mt-0.5 text-[11.5px] leading-relaxed text-neutral-300">
          Kanvas bo&apos;sh ko&apos;rinyapti, lekin bu oqimda bloklar bor. Saqlash o&apos;chirildi, shunda
          mavjud oqim bo&apos;sh grafik bilan almashtirilmaydi.
        </p>
      </div>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="flex-none cursor-pointer rounded-md bg-neutral-800 px-2.5 py-1.5 text-[11.5px] text-neutral-100 hover:bg-neutral-700"
      >
        Sahifani yangilash
      </button>
    </div>
  );
}
