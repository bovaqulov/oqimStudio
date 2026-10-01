"use client";

import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { useT } from "@/lib/i18n/LocaleProvider";

/**
 * The shape every error boundary renders. Three things, always: what failed,
 * a way to retry, and a way out — an error screen with no exit is how a
 * session ends.
 */
export function ErrorState({
  title,
  description,
  error,
  reset,
}: {
  title?: string;
  description?: string;
  error?: Error & { digest?: string };
  reset?: () => void;
}) {
  // The defaults moved out of the parameter list because a default cannot call
  // a hook. `global-error.tsx` renders this outside every layout in the app, so
  // there is no provider above it there and `useT` answers in the default
  // language — which is the correct answer for a screen that is already broken.
  const t = useT();

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3.5 px-6 py-16 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-danger-bg text-danger-fg">
        <Icon name="warning" size={26} />
      </span>
      <div>
        <div className="t-headline">{title ?? t.chrome.error.title}</div>
        <p className="t-subhead t-secondary mt-1.5 max-w-[380px]">{description ?? t.chrome.error.description}</p>
        {error?.digest && <p className="t-footnote t-tertiary mt-1.5 font-mono">ID: {error.digest}</p>}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {reset && (
          <button
            type="button"
            onClick={reset}
            className="oq-press min-h-[44px] cursor-pointer rounded-[12px] bg-accent-700 px-4 text-[17px] font-medium text-white"
          >
            {t.chrome.error.retry}
          </button>
        )}
        <Link
          href="/dashboard"
          className="t-body flex min-h-[44px] items-center px-3 text-accent-400"
        >
          {t.chrome.error.home}
        </Link>
        <Link
          href="/help"
          className="t-body flex min-h-[44px] items-center px-3 text-accent-400"
        >
          {t.chrome.error.help}
        </Link>
      </div>
    </div>
  );
}
