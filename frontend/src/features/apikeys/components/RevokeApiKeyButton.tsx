"use client";

import { useTransition } from "react";
import { Icon } from "@/components/ui/Icon";
import { showToast } from "@/components/ui/toast-store";
import { confirmDestructive } from "@/lib/telegram/MainButton";
import { hapticResult } from "@/lib/telegram/webapp";
import { revokeApiKeyAction } from "../actions";

/**
 * Revoking one key, asked about by name.
 *
 * The name is in the question and not only in the row, because the row is not
 * what the reader is looking at once a dialog has covered it — and four keys
 * called "Test", "Test 2", "CRM" and "CRM eski" are four rows a finger can miss
 * by one. The prefix goes in with it: that is the string in the caller's own
 * configuration file, so it is what settles "is this the one I think it is"
 * when two keys share a name.
 *
 * No form. The confirmation is asynchronous — inside Telegram it is the
 * client's own popup — and a `<form>` inside a row that re-renders when the
 * list revalidates is a form that may not exist by the time the answer comes
 * back. The action is called with the id this component was given, which needs
 * nothing in the document to still be there.
 */
export function RevokeApiKeyButton({ keyId, name, prefix }: { keyId: string; name: string; prefix: string }) {
  const [pending, startTransition] = useTransition();

  function revoke() {
    void (async () => {
      const ok = await confirmDestructive({
        title: name,
        message:
          `«${name}» (${prefix}) bekor qilinadi. Shu kalit bilan ishlayotgan hamma narsa shu zahoti ` +
          "to'xtaydi va buni orqaga qaytarib bo'lmaydi — o'rniga yangi kalit yaratib, uni hamma joyda almashtirish kerak bo'ladi.",
        // Not "Bekor qilish": the dialog's other button already says exactly
        // that and means the opposite. The affirmative form is what keeps the
        // two apart at a glance.
        confirmText: "Ha, bekor qilinsin",
      });
      if (!ok) return;

      hapticResult("warning");
      startTransition(async () => {
        const result = await revokeApiKeyAction({ keyId });
        if (result.error) {
          // Silence here is the worst answer available: the reader walks away
          // believing a leaked credential is dead when it is still working.
          showToast(result.error, { tone: "danger" });
          return;
        }
        showToast(`${name} bekor qilindi`);
      });
    })();
  }

  return (
    <button
      type="button"
      disabled={pending}
      onClick={revoke}
      title={`${name} — kalitni bekor qilish`}
      aria-label={`${name} — kalitni bekor qilish`}
      className="oq-tap flex h-8 w-8 flex-none cursor-pointer items-center justify-center rounded-full text-neutral-600 hover:bg-danger-bg hover:text-danger-fg disabled:cursor-default disabled:opacity-40"
    >
      <Icon name="trash" size={15} />
    </button>
  );
}
