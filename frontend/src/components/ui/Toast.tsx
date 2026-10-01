"use client";

import { Icon } from "./Icon";
import { useToastStore } from "./toast-store";

export function ToastViewport() {
  const toast = useToastStore((state) => state.toast);
  const dismiss = useToastStore((state) => state.dismiss);
  if (!toast) return null;

  const danger = toast.tone === "danger";

  return (
    <div
      // Keyed by id so two toasts with the same words still replay the entrance
      // — otherwise a repeated action looks like nothing happened.
      key={toast.id}
      // A refusal interrupts; an acknowledgement does not. `alert` is read out
      // at once, `status` waits for a pause — the difference between hearing
      // why the delete was refused and never hearing it.
      role={danger ? "alert" : "status"}
      // Above the tab bar and clear of the home indicator: a toast that lands
      // under either is a message nobody reads. `z-[70]` puts it over the
      // mobile sheet and the floating action button too — both used to cover it.
      //
      // `text-text`, never `text-white`. `--color-overlay` is the covering
      // surface and it inverts with the theme (#1c1c1e dark, #ffffff light);
      // white ink on it meant the whole toast was white-on-white in the light
      // theme. Three separate bug reports — a failed delete showing no error,
      // "Tahrirlash" looking dead, the integration waiting list not reacting —
      // were all this one line: the toast was firing and could not be seen.
      className="animate-rise oq-safe-bottom fixed bottom-[62px] left-1/2 z-[70] flex max-w-[92vw] -translate-x-1/2 items-center gap-2 rounded-full bg-overlay px-4 py-2.5 text-[15px] text-text shadow-lg ring-1 ring-neutral-800 md:bottom-[22px] md:text-[13px]"
    >
      <Icon
        name={danger ? "warning" : "check-circle"}
        size={17}
        className={danger ? "text-danger-fg" : undefined}
      />
      {toast.message}
      {toast.action && (
        <button
          type="button"
          onClick={() => {
            toast.action?.run();
            dismiss();
          }}
          className="oq-press -my-1 ml-1 cursor-pointer rounded-full px-2 py-1 text-[15px] font-medium text-accent-300 md:text-[13px]"
        >
          {toast.action.label}
        </button>
      )}
    </div>
  );
}
