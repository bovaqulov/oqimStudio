"use client";

import { Icon } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
import { useT } from "@/lib/i18n/LocaleProvider";
import { useHelpDialogStore } from "./help-store";
import { MENU_ROW_CLASS } from "./menu-row";

/**
 * The one help affordance, at every width.
 *
 * "Yordam markazi" used to be a sidebar entry, which made a destination look
 * like a section of the product. It is neither — it is what you press when you
 * are stuck, and that is this button: the dialog it opens leads to the help
 * centre first and lists the shortcuts under it.
 */
export function HelpButton({ variant = "icon" }: { variant?: "icon" | "row" }) {
  const show = useHelpDialogStore((state) => state.show);
  const t = useT();

  if (variant === "row") {
    return (
      <button type="button" onClick={show} className={MENU_ROW_CLASS}>
        <Icon name="question" size={17} className="flex-none text-neutral-500" />
        <span className="min-w-0 flex-1 truncate">{t.nav.helpCenter}</span>
      </button>
    );
  }

  return (
    <IconButton
      icon="question"
      label={t.chrome.helpAndShortcuts}
      tooltip
      tooltipAlign="end"
      className="oq-tap relative"
      onClick={show}
    />
  );
}
