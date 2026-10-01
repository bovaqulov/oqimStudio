import { Icon } from "@/components/ui/Icon";

/** The editor loads a whole graph — a blank screen here reads as a crash. */
export default function FlowEditorLoading() {
  return (
    <div className="flex h-screen w-full flex-col items-center justify-center gap-3 bg-bg text-neutral-600">
      <Icon name="flow-arrow" size={22} className="animate-pulse" />
      <span className="text-[12px]">Oqim yuklanmoqda…</span>
    </div>
  );
}
