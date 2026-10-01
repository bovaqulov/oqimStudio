import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { createModuleFlowAction } from "@/features/flows";
import type { QuickCreateTarget } from "../data";

/**
 * "Yangi oqim" from anywhere. With a bot connected it creates the flow and
 * opens the editor in one click; without one it sends the reader to the step
 * that has to happen first instead of failing silently.
 *
 * Two sizes, and only one of them is filled. `md` is the button inside an empty
 * state — the single thing to do on a screen with nothing on it, so it gets the
 * one blue fill. `sm` sits in the page header next to the title, where a second
 * fill would make the screen claim two primary actions; there it is a plain
 * accent label, which is where a phone reader looks for "add" anyway.
 */
const SIZE_CLASS: Record<"sm" | "md", string> = {
  sm: "oq-press t-body flex min-h-[44px] cursor-pointer items-center gap-1.5 rounded-[12px] px-2 whitespace-nowrap text-accent-400",
  md: "oq-press t-headline flex min-h-[44px] cursor-pointer items-center justify-center gap-1.5 rounded-[12px] bg-accent-700 px-4 whitespace-nowrap text-white",
};

export function NewFlowButton({ target, size = "md" }: { target: QuickCreateTarget | null; size?: "sm" | "md" }) {
  const className = SIZE_CLASS[size];
  const iconSize = size === "sm" ? 15 : 17;

  // `/bots/new`, the screen the label names. It used to be `/projects`, so a
  // button reading "Bot ulash" opened the project list — one screen short of
  // what it promised, and a different destination from the floating button
  // saying the same two words on the same page.
  if (!target) {
    return (
      <Link href="/bots/new" className={className}>
        <Icon name="plus" size={iconSize} /> Bot ulash
      </Link>
    );
  }

  return (
    <form action={createModuleFlowAction}>
      <input type="hidden" name="projectId" value={target.projectId} />
      <input type="hidden" name="botId" value={target.botId} />
      <input type="hidden" name="moduleKey" value={target.moduleKey} />
      <button type="submit" title={`${target.botHandle} uchun yangi oqim`} className={className}>
        <Icon name="plus" size={iconSize} /> {size === "sm" ? "Yangi oqim" : "Yangi oqim yaratish"}
      </button>
    </form>
  );
}
