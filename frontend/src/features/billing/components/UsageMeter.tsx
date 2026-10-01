import { Icon } from "@/components/ui/Icon";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { cn } from "@/lib/utils/cn";
import { formatThousands } from "@/lib/utils/format";
import { isOverLimit, usagePercent, usageTone, type UsageMetric } from "../types";

/**
 * One limit, and how close it is.
 *
 * The count is the content, so it is drawn at the size of one. Every line here
 * used to be 11.5px — label, value and percentage all within half a pixel of
 * each other, which is a hierarchy nobody can see; the number a reader came for
 * now sits at 22px above the bar and the rest reads underneath it.
 *
 * `metric.hint` is no longer drawn, and `showHint` is gone with it. The hint
 * said what the resource *is* rather than where the limit stands, and a grey
 * definition under every one of eight meters was most of the screen's height.
 */
function noteFor(metric: UsageMetric, percent: number | null): { text: string; alarming: boolean } | null {
  // The only sentences left are the two the server actually refuses on, plus
  // the one warning that arrives before it does. 75–89% says itself: the bar
  // is already warning-toned and the percentage is printed beside the label.
  if (metric.limit === 0) return { text: "Bu tarifda mavjud emas", alarming: metric.used > 0 };
  if (isOverLimit(metric)) {
    // The server's own sentence for this key, not one composed here. One line
    // used to stand for all of them — "yangi so'rovlar rad etilyapti" — which
    // was false of messages, where nothing is refused, and unreadable
    // everywhere else: a «so'rov» is a thing a customer sends, so a full bots
    // bar told a workspace its bot had stopped answering people when what had
    // happened was that it could not connect a second one. `whenFull` names
    // the thing that actually stops, and `enforced` still decides the tone.
    return { text: metric.whenFull, alarming: metric.enforced };
  }
  if (percent !== null && percent >= 90) return { text: "Limit deyarli to'ldi", alarming: true };
  return null;
}

export function UsageMeter({ metric }: { metric: UsageMetric }) {
  const percent = usagePercent(metric);
  const tone = usageTone(percent);
  const limitLabel = metric.limit === null ? "cheksiz" : formatThousands(metric.limit);
  const note = noteFor(metric, percent);
  /*
   * A limit of zero is not a meter reading nought — it is a resource this plan
   * does not have. "AI bloklari 0 / 0 · 0%" over an empty bar invites the
   * reader to work out what fraction of nothing they have used, and the
   * sentence under it ("Bu tarifda mavjud emas") already told them there is no
   * quantity here at all. So the bar and the percentage step aside and leave
   * the sentence to say it.
   */
  const unavailable = metric.limit === 0;

  return (
    <div>
      <div className="flex items-baseline gap-2">
        <span className="t-subhead t-secondary min-w-0 flex-1 truncate">{metric.label}</span>
        {percent !== null && !unavailable && (
          <span
            className={cn(
              "t-footnote flex-none tabular-nums",
              tone === "danger" ? "text-danger-fg" : tone === "warning" ? "text-warning-fg" : "t-tertiary",
            )}
          >
            {percent}%
          </span>
        )}
      </div>
      {!unavailable && (
        <>
          <div className="mt-0.5 mb-2 flex items-baseline gap-1.5">
            <span className="t-title2 tabular-nums">{formatThousands(metric.used)}</span>
            <span className="t-footnote t-tertiary">/ {limitLabel}</span>
          </div>
          <ProgressBar percent={percent ?? 0} tone={metric.limit === null ? "neutral" : tone} thickness={6} />
        </>
      )}
      {note && (
        <div
          className={cn(
            "t-footnote flex items-center gap-1.5",
            unavailable ? "mt-0.5" : "mt-2",
            // Warning, never danger: the sentence carries the fact, and red on
            // a state every Free workspace lives in cried wolf (see usageTone).
            note.alarming ? "text-warning-fg" : "t-tertiary",
          )}
        >
          {note.alarming && <Icon name="warning" size={13} className="flex-none" />}
          {note.text}
        </div>
      )}
    </div>
  );
}
