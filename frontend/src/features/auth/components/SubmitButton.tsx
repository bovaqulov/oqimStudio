import { Spinner } from "@/components/ui/Spinner";
import { useHydrated } from "@/lib/hooks/useHydrated";
import { AUTH_COPY } from "../messages";

/**
 * The one filled blue on an auth screen.
 *
 * Shared as a class rather than copied, because three screens end on an action
 * that is not a submit — "Yangi havola so'rash" is a link, "Kirishga o'tish" is
 * a plain button — and they have to be the same object as the button they
 * replace, not three near-misses of it. Full width is the right shape here:
 * there is one action on the card and it is at the bottom of a column of
 * full-width fields.
 */
export const authActionClasses =
  "oq-press t-headline flex h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-[12px] bg-accent-700 text-white disabled:cursor-not-allowed disabled:opacity-40";

/**
 * The one submit control on an auth form. Everything else here is a plain
 * accent text button (`authLinkClasses`).
 *
 * It is a `<button type="submit">` rather than Telegram's `MainButton`
 * deliberately: these screens also run in an ordinary browser, signed out,
 * where there is no client to hand the action to.
 *
 * Disabled while the request is in flight *and* guarded in `useAuthAction`,
 * because a disabled attribute alone loses the race against a fast double
 * click.
 *
 * And disabled until React owns it. Everything these screens do lives in one
 * `onSubmit` handler that does not exist until the bundle has run, so a button
 * drawn by the server is a finished-looking control that cannot act — the
 * audit read that as "the buttons do not work". Worse than doing nothing: the
 * form carries no `action`, so the browser's own submit is a GET to the
 * current URL, which put the typed password in the address bar and in the
 * server log. The forms answer that half with `method="post"`; this is the
 * half that says so on screen.
 */
export function SubmitButton({
  label,
  loading,
  disabled,
  loadingLabel = AUTH_COPY.common.submitting,
}: {
  label: string;
  loading: boolean;
  disabled?: boolean;
  loadingLabel?: string;
}) {
  const ready = useHydrated();
  return (
    <button
      type="submit"
      disabled={loading || disabled || !ready}
      // The word does not change: hydration is a beat, and swapping the label
      // for "loading" would make every first paint of these screens flicker.
      aria-busy={loading || !ready}
      className={authActionClasses}
    >
      {loading && <Spinner size={17} />}
      {loading ? loadingLabel : label}
    </button>
  );
}
