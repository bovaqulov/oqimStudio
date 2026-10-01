"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { Icon } from "@/components/ui/Icon";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { haptic } from "@/lib/telegram/webapp";
import { cn } from "@/lib/utils/cn";
import type { ChecklistStep, OnboardingChecklist as Checklist } from "../get-checklist";

const DISMISS_KEY = "oqim:onboarding-dismissed";

/*
 * "Has this been closed before?" is a question only the browser can answer, and
 * the server renders this component too. `useSyncExternalStore` is how that is
 * said without a render pass that sets state on itself: the server snapshot is
 * "not closed", the client reads storage, and the subscription is what lets the
 * close button re-render every mounted copy.
 */
const dismissListeners = new Set<() => void>();

function subscribeDismissed(listener: () => void): () => void {
  dismissListeners.add(listener);
  return () => {
    dismissListeners.delete(listener);
  };
}

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    // Storage walled off inside a webview — the card simply stays.
    return false;
  }
}

function dismiss(): void {
  try {
    localStorage.setItem(DISMISS_KEY, "1");
  } catch {
    // Nothing to do; the card is closed for this visit either way.
  }
  for (const listener of dismissListeners) listener();
}

/**
 * The first-run path, on the dashboard and nowhere else.
 *
 * Three things the audit asked of it, and each one removes something. It is the
 * *only* onboarding card in the product, so it is not repeated on the screens
 * it points at. It can be closed, because somebody who knows what they are
 * doing should not have to finish a checklist to be rid of it. And it vanishes
 * on its own at 100% — a completed checklist is furniture.
 *
 * What is left is one line per outstanding step. The paragraph and the separate
 * call-to-action each step used to carry were the bulk of a block that already
 * owned the top of the screen, and the row is the link, so neither said
 * anything the row does not.
 */
export function OnboardingChecklist({ checklist }: { checklist: Checklist }) {
  const dismissed = useSyncExternalStore(subscribeDismissed, readDismissed, () => false);

  if (checklist.complete || dismissed) return null;

  const percent = Math.round((checklist.doneCount / checklist.steps.length) * 100);
  const pending = checklist.steps.filter((step) => !step.done);

  function close() {
    haptic("light");
    dismiss();
  }

  return (
    <section className="mb-5 overflow-hidden rounded-[16px] bg-surface shadow-md">
      <div className="flex items-center gap-3 px-4 pt-4 pb-3">
        <div className="min-w-0 flex-1">
          <h2 className="t-headline m-0">Ishga tushirish</h2>
          <p className="t-footnote t-secondary m-0 mt-0.5 tabular-nums">
            {checklist.doneCount}/{checklist.steps.length}
          </p>
        </div>
        <button
          type="button"
          onClick={close}
          aria-label="Yopish"
          className="oq-press flex h-11 w-11 flex-none cursor-pointer items-center justify-center rounded-full text-neutral-500"
        >
          <Icon name="x" size={18} />
        </button>
      </div>

      <div className="px-4 pb-3">
        <ProgressBar percent={percent} />
      </div>

      <div className="oq-group rounded-none bg-transparent" data-inset="icon">
        {pending.map((step) => (
          <PendingStep key={step.key} step={step} />
        ))}
      </div>
    </section>
  );
}

/** One outstanding step. The whole row is the link; the arrow says so. */
function PendingStep({ step }: { step: ChecklistStep }) {
  return (
    <Link href={step.href} className="oq-row">
      <span
        className={cn(
          "flex h-[29px] w-[29px] flex-none items-center justify-center rounded-[8px] bg-neutral-800 text-neutral-400",
        )}
      >
        <Icon name={step.icon} size={16} />
      </span>
      {/* Wraps rather than truncates. These titles are ours, they are short,
          and there are five of them — "Oqimni ishga tus…" is a step nobody can
          act on, where a second line costs 22px once. `line-clamp-2` keeps the
          row bounded all the same. */}
      <span className="t-body line-clamp-2 min-w-0 flex-1">{step.title}</span>
      <Icon name="caret-right" size={15} className="flex-none text-neutral-600" />
    </Link>
  );
}
