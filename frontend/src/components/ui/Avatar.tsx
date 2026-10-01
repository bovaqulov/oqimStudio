import { cn } from "@/lib/utils/cn";
import { initialsOf } from "@/lib/utils/format";

export function Avatar({ name, size = 26, className }: { name: string; size?: number; className?: string }) {
  return (
    <span
      className={cn(
        "flex flex-none items-center justify-center rounded-full bg-accent-700 font-semibold text-white",
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}
    >
      {initialsOf(name)}
    </span>
  );
}
