import { Icon } from "@/components/ui/Icon";
import { getT } from "@/lib/i18n/server";

/**
 * Says out loud that the numbers on this screen are made up.
 *
 * Shown on every screen that reports a figure for a demo workspace. A clinic
 * being shown "904 suhbat · 60 mln so'm" has no way to tell a seeded
 * demonstration from its own results, and the honest fix is not a smaller
 * number — it is a label.
 */
export async function DemoDataNotice({ isDemo }: { isDemo?: boolean }) {
  if (!isDemo) return null;
  const t = await getT();

  return (
    // One line, and it is the label. The three-line explanation underneath was
    // a caveat charging more of the screen than the numbers it qualified —
    // "Demo ma'lumot" is the part that must never be missed, and there is
    // nothing a reader does differently after reading the rest.
    <div className="mb-3.5 flex items-center gap-2.5 rounded-[12px] bg-warning-bg px-3.5 py-3">
      <Icon name="info" size={17} className="flex-none text-warning-fg" />
      <span className="t-subhead min-w-0 flex-1 text-warning-fg">{t.chrome.demoData}</span>
    </div>
  );
}
