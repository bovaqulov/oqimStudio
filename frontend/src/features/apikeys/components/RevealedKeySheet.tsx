"use client";

import { useCallback, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Modal";
import { showToast } from "@/components/ui/toast-store";
import { MainButton, confirmDestructive } from "@/lib/telegram/MainButton";
import { hapticResult } from "@/lib/telegram/webapp";
import type { CreatedApiKey } from "../types";
import { ScopePills } from "./ScopePills";

/**
 * The one time the key exists.
 *
 * Everything about this sheet follows from a single fact: the backend stores a
 * hash, so when this closes the credential is gone from the world unless the
 * reader took it. There is no "show again", no email, no support ticket that
 * can recover it — only minting a new one and changing it wherever the old one
 * was going to be pasted.
 *
 * Three consequences, and they are the whole design:
 *
 *  1. **The warning stands with the key, not after it.** A sentence under a
 *     dismiss button is read by nobody: by the time the eye reaches it the
 *     decision to close has been made. So the sentence and the key are one
 *     block — the same border, the same tint — and the sentence is above the
 *     characters, in the path the eye takes on the way to them.
 *
 *  2. **Copying is the screen's one primary action.** Not "Yopish", not
 *     "Tayyor". Whatever the reader came here to do, it is get these characters
 *     into another program, so that is what the MainButton says until it has
 *     happened. Only then does it turn into the way out. The icon button on the
 *     block itself is the same call, kept because a MainButton press inside a
 *     Telegram client arrives over the bridge and may not carry the user
 *     activation the clipboard wants — and because a copy control that is not
 *     touching the thing it copies is a control people miss.
 *
 *  3. **Closing without copying is a question, not a click.** Escape, the
 *     backdrop, the ✕ and the button all route through one guard, because a
 *     sheet that can be dismissed by a stray tap on the dark area beside it is
 *     a sheet that will be. Once the key has been copied the guard steps aside:
 *     asking somebody to confirm something that costs them nothing is how a
 *     confirmation stops being read.
 *
 * The credential lives in this component's state and nowhere else. It is not in
 * the URL, not in a cookie, not in a revalidated server payload and not in any
 * repository — it arrived in one action result and it dies with this unmount.
 */
export function RevealedKeySheet({ apiKey, onDone }: { apiKey: CreatedApiKey; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  // Read by the guard, which must not be rebuilt when this flips: `Modal`
  // re-runs its whole effect when `onClose` changes identity — re-registering
  // Escape and bouncing focus out to the button that opened the sheet.
  const copiedRef = useRef(false);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(apiKey.secret);
      copiedRef.current = true;
      setCopied(true);
      hapticResult("success");
      showToast("Kalit nusxalandi");
    } catch {
      // Clipboard access can be refused outright — over plain HTTP, inside an
      // embedded browser, or by a permission denied an hour ago. The key is on
      // screen and one tap selects all of it, so the honest answer is to say
      // that rather than to pretend the copy happened.
      showToast("Nusxalab bo'lmadi — kalitni bosib belgilang va qo'lda ko'chiring", { tone: "danger" });
    }
  }, [apiKey.secret]);

  const guardedClose = useCallback(async () => {
    if (!copiedRef.current) {
      const ok = await confirmDestructive({
        title: apiKey.name,
        message:
          "Kalit yopilgandan keyin boshqa ko'rsatilmaydi — biz ham uni ko'ra olmaymiz. " +
          "Nusxalab olmagan bo'lsangiz, yangi kalit yaratishdan boshqa yo'l qolmaydi.",
        confirmText: "Baribir yopish",
      });
      if (!ok) return;
    }
    onDone();
  }, [apiKey.name, onDone]);

  // Stable identity for `Modal`, which registers it as the Escape and backdrop
  // handler once and would otherwise re-register on every render.
  const close = useCallback(() => {
    void guardedClose();
  }, [guardedClose]);

  return (
    <Modal open onClose={close} labelledBy="revealed-key-title" className="max-w-[520px]" detent="medium">
      <div className="flex flex-none items-center gap-2 px-4 py-3">
        <span
          className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-[8px] bg-success-fg text-white"
          aria-hidden
        >
          <Icon name="check" size={17} weight="bold" />
        </span>
        <span id="revealed-key-title" className="t-headline min-w-0 flex-1 truncate">
          {apiKey.name} tayyor
        </span>
        <button
          type="button"
          onClick={close}
          aria-label="Yopish"
          className="oq-press flex h-[30px] w-[30px] flex-none cursor-pointer items-center justify-center rounded-full bg-neutral-800 text-neutral-500"
        >
          <Icon name="x" size={16} />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-4 pb-4">
        <div className="flex flex-col gap-3 rounded-[14px] border border-warning-bg bg-warning-bg/30 p-3.5">
          <div className="flex items-start gap-2">
            <Icon name="warning" size={16} className="mt-px flex-none text-warning-fg" />
            <p className="t-footnote m-0 leading-[18px] text-text">
              Bu kalit faqat shu yerda va faqat hozir ko&apos;rinadi. Serverda uning o&apos;zi emas, hashi
              saqlanadi — yopilgandan keyin uni biz ham qayta ko&apos;rsata olmaymiz.
            </p>
          </div>

          {/* `select-all` so one tap selects the whole thing: that is the way
              out for a reader whose browser refuses the clipboard, and the key
              wraps rather than scrolls so none of it is hidden off the edge. */}
          <div className="flex items-stretch overflow-hidden rounded-[12px] bg-neutral-900">
            <code className="min-w-0 flex-1 px-3.5 py-3 font-mono text-[13px] leading-[19px] break-all text-text select-all">
              {apiKey.secret}
            </code>
            <button
              type="button"
              onClick={() => void copy()}
              aria-label="Kalitni nusxalash"
              className="flex min-h-[44px] w-11 flex-none cursor-pointer items-center justify-center text-neutral-500 hover:text-neutral-100"
            >
              <Icon name={copied ? "check" : "copy"} size={16} />
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <span className="t-footnote t-secondary">Bu kalit nimaga kira oladi</span>
          <ScopePills scopes={apiKey.scopes} />
        </div>

        <p className="t-footnote t-tertiary m-0 leading-[18px]">
          Kalitni sozlama fayliga yoki maxfiy o&apos;zgaruvchiga qo&apos;ying. Uni xabarda, kodda yoki
          skrinshotda yubormang — kalitni qo&apos;lga kiritgan har kim ish maydoniga siz kabi kiradi.
        </p>
      </div>

      <MainButton
        inline
        text={copied ? "Yopish" : "Nusxalash"}
        onClick={() => {
          if (copied) close();
          else void copy();
        }}
      />
    </Modal>
  );
}
