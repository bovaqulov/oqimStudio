import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/utils/cn";

/**
 * Form-level message — the one that belongs to the whole submit, not to a
 * field. `role="alert"` for failures (interrupt: the reader just pressed a
 * button and nothing else happened) and a polite status for the rest.
 *
 * Tinted fill, no outline: an outline round a coloured block is the second
 * edge that made every card on these screens read as a box.
 */
export function FormAlert({
  tone = "danger",
  children,
  className,
}: {
  tone?: "danger" | "success" | "info";
  children: React.ReactNode;
  className?: string;
}) {
  const isError = tone === "danger";
  return (
    <div
      role={isError ? "alert" : "status"}
      aria-live={isError ? "assertive" : "polite"}
      className={cn(
        "t-subhead flex items-start gap-2.5 rounded-[12px] px-3.5 py-3",
        isError && "bg-danger-bg text-text",
        tone === "success" && "bg-success-bg text-text",
        tone === "info" && "bg-accent-900 text-text",
        className,
      )}
    >
      <Icon
        name={isError ? "warning" : tone === "success" ? "check-circle" : "info"}
        size={17}
        className={cn(
          "mt-px flex-none",
          isError ? "text-danger-fg" : tone === "success" ? "text-success-fg" : "text-accent-400",
        )}
      />
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  );
}
