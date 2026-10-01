"use client";

import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/utils/cn";
import { useHydrated } from "@/lib/hooks/useHydrated";
import { useFlowStudioStore } from "../flow-studio-store";

/**
 * The page's primary action. It opens the chooser rather than creating a blank
 * canvas outright: "Yangi oqim" used to drop the author straight into an empty
 * editor, which is exactly the moment a non-technical owner gives up. The three
 * ways in are now the first thing they see.
 */
export function NewFlowButton({ className }: { className?: string }) {
  const openChooser = useFlowStudioStore((state) => state.openChooser);
  // Until React owns this button, pressing it does nothing at all. Saying so is
  // the difference between "loading" and "broken".
  const ready = useHydrated();
  return (
    <button
      type="button"
      onClick={openChooser}
      disabled={!ready}
      aria-busy={!ready}
      className={cn(
        "flex flex-none cursor-pointer items-center gap-1.5 rounded-md bg-accent-700 px-3.5 py-2 text-[12.5px] font-medium text-white transition-colors hover:bg-accent-600",
        // A page's primary action is primary text — 15px on a phone, and a
        // target a thumb can land on (`MOBILE.md`).
        "max-md:min-h-[44px] max-md:px-4 max-md:text-[15px]",
        // Hydration is quick, so this is a beat, not a state worth explaining.
        "disabled:cursor-progress disabled:opacity-70",
        className,
      )}
    >
      <Icon name="plus" size={13} /> Yangi oqim
    </button>
  );
}

/**
 * The same three ways in, as a secondary affordance — used by empty states and
 * hints, where a second solid blue button would compete with the header's.
 */
export function StudioLink({
  target,
  icon,
  children,
  className,
}: {
  target: "chooser" | "gallery" | "wizard";
  icon?: "puzzle-piece" | "sparkle" | "plus";
  children: React.ReactNode;
  className?: string;
}) {
  const openChooser = useFlowStudioStore((state) => state.openChooser);
  const openGallery = useFlowStudioStore((state) => state.openGallery);
  const openWizard = useFlowStudioStore((state) => state.openWizard);
  const open = target === "gallery" ? openGallery : target === "wizard" ? () => openWizard() : openChooser;
  const ready = useHydrated();

  return (
    <button
      type="button"
      onClick={open}
      disabled={!ready}
      aria-busy={!ready}
      className={cn(
        "flex cursor-pointer items-center gap-1.5 rounded-md bg-neutral-800 px-3 py-2 text-[12.5px] font-medium text-neutral-100 transition-colors hover:bg-neutral-700",
        "max-md:min-h-[44px] max-md:px-4 max-md:text-[15px]",
        "disabled:cursor-progress disabled:opacity-70",
        className,
      )}
    >
      {icon && <Icon name={icon} size={13} />}
      {children}
    </button>
  );
}
