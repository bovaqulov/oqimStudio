import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/utils/cn";

/**
 * Five stars, filled to `value`. Read-only by default; pass `onSelect` to turn
 * it into the rating control on the review form.
 *
 * The read-only stars are decoration and stay at their drawn size. The
 * selectable ones carry `oq-tap`, which widens the hit box to 44px on a finger
 * without moving anything: five 12px targets in a row is a rating nobody can
 * give on a phone.
 */
export function StarRating({
  value,
  size = 12,
  onSelect,
  className,
}: {
  value: number;
  size?: number;
  onSelect?: (rating: number) => void;
  className?: string;
}) {
  return (
    <span
      className={cn("flex items-center", onSelect ? "gap-2" : "gap-0.5", className)}
      role={onSelect ? "radiogroup" : undefined}
    >
      {[1, 2, 3, 4, 5].map((star) => {
        const filled = value >= star - 0.25;
        const half = !filled && value >= star - 0.75;
        const icon = filled ? "star" : half ? "star-half" : "star";
        return onSelect ? (
          <button
            key={star}
            type="button"
            role="radio"
            aria-checked={Math.round(value) === star}
            aria-label={`${star} yulduz`}
            onClick={() => onSelect(star)}
            className={cn(
              "oq-tap relative flex cursor-pointer items-center justify-center",
              filled || half ? "text-warning-fg" : "text-neutral-700",
            )}
          >
            <Icon name={icon} size={size} weight={filled ? "fill" : "regular"} />
          </button>
        ) : (
          <Icon
            key={star}
            name={icon}
            size={size}
            weight={filled ? "fill" : "regular"}
            className={filled || half ? "text-warning-fg" : "text-neutral-700"}
          />
        );
      })}
    </span>
  );
}
