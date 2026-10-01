import { ThemeToggle } from "@/components/layout/ThemeToggle";

/**
 * Chrome for the signed-out screens: none. No sidebar, no page header, no
 * workspace — the only thing on screen is the form and the one control that
 * belongs to the person rather than to the account (the theme).
 *
 * The toggle sits at `--island-inset`, the same distance off the edge every
 * floating capsule in the app keeps, and drops below the notch on a phone
 * rather than under it.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-svh w-full bg-bg text-text">
      <div className="absolute top-[max(env(safe-area-inset-top),var(--island-inset))] right-[var(--island-inset)] z-10">
        <ThemeToggle />
      </div>
      {children}
    </div>
  );
}
