import { Icon, type IconName } from "./Icon";

/**
 * Nothing here yet — an icon, one line, and whatever the caller offers next.
 *
 * `description` is optional and mostly unused now: a paragraph explaining what
 * *would* be on this screen is a paragraph the reader has to get past to reach
 * the button that puts something on it.
 */
export function EmptyState({
  icon,
  title,
  description,
}: {
  icon: IconName;
  title: string;
  description?: string;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-9 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-neutral-800 text-neutral-500">
        <Icon name={icon} size={26} />
      </span>
      <div className="t-headline">{title}</div>
      {description && <div className="t-subhead t-secondary max-w-[280px]">{description}</div>}
    </div>
  );
}
