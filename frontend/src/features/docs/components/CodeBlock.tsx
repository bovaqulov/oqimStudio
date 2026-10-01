"use client";

import { Icon } from "@/components/ui/Icon";
import { showToast } from "@/components/ui/toast-store";

/**
 * A sample somebody is meant to run, with the one button that makes it usable.
 *
 * The copy button is not decoration here. This page has no OpenAPI file behind
 * it, so a paste-and-run sample *is* the machine-readable half of the
 * documentation — the reader is as likely to be handing it to a model as to a
 * terminal, and either way retyping a signed `curl` by hand is where the typo
 * comes from.
 *
 * The failure path is the one `InviteLinkPanel` and `SchemaCopyPanel` already
 * take: `navigator.clipboard` is refused outright over plain HTTP and by a
 * permission somebody has already denied, and a button that silently does
 * nothing is worse than one that says so. The text is on screen and selectable
 * either way, which is the whole reason saying so is enough.
 */
export function CodeBlock({
  label,
  code,
  /** A response is read, not run — no button, and a quieter frame. */
  copyable = false,
}: {
  label: string;
  code: string;
  copyable?: boolean;
}) {
  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      showToast("Nusxalandi");
    } catch {
      showToast("Nusxalab bo'lmadi — matnni qo'lda belgilang", { tone: "danger" });
    }
  }

  return (
    <div className="overflow-hidden rounded-[12px] border border-separator bg-neutral-900">
      <div className="flex items-center gap-2 border-b border-separator px-3 py-1.5">
        <span className="t-caption t-secondary min-w-0 flex-1 truncate">{label}</span>
        {copyable && (
          <button
            type="button"
            onClick={copy}
            aria-label={`${label} — nusxalash`}
            // 28px drawn, 44px reachable: `oq-tap` puts the touch target back
            // as a pseudo-element, so the button does not stretch the strip it
            // sits in the way a 44px box would.
            className="oq-tap oq-press relative flex h-7 flex-none cursor-pointer items-center gap-1.5 rounded-[8px] px-2 text-accent-400"
          >
            <Icon name="copy" size={15} />
            <span className="t-caption">Nusxalash</span>
          </button>
        )}
      </div>
      {/*
        Its own scroll container, for the reason the guide pages give: a curl
        line with a signed header has nothing to wrap on, and without
        `overflow-x-auto` here that one line widens the panel, the page and the
        layout under it. The reader scrolls the block; the page never moves
        sideways.

        12.5px on a desktop and 13px on a phone — this is the one thing on the
        page read character by character, so how many columns fit matters more
        than the ink.
      */}
      <pre className="overflow-x-auto p-3 font-mono text-[12.5px] leading-relaxed text-neutral-200 max-md:text-[13px]">
        {code}
      </pre>
    </div>
  );
}
