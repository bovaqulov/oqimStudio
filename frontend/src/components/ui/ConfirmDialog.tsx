"use client";

import { useCallback } from "react";
import { Button } from "./Button";
import { Modal } from "./Modal";
import { useConfirmStore } from "./confirm-store";

/**
 * The one confirmation dialog, mounted once beside the toast viewport.
 *
 * Shape follows the platform: the question is the title, the consequence is the
 * sentence under it, and the two answers sit in a row with the safe one on the
 * left. `Modal` puts focus on the dialog itself rather than on a button, so a
 * reflex Enter lands on nothing at all — which for a question whose wrong
 * answer cannot be undone is the right place for it to land.
 *
 * The destructive answer is `danger-ghost` and not a filled red button, for the
 * reason stated on `Button`: nothing destructive in this product is ever the
 * one filled control on the screen.
 */
export function ConfirmDialog() {
  const request = useConfirmStore((state) => state.request);
  const answer = useConfirmStore((state) => state.answer);

  // Escape and a backdrop click both mean "no", and `Modal` routes both here.
  const cancel = useCallback(() => answer(false), [answer]);

  if (!request) return null;

  return (
    <Modal open onClose={cancel} labelledBy="confirm-title" detent="medium" className="max-w-[380px]">
      <div key={request.id} className="flex flex-col gap-2 p-5">
        <h2 id="confirm-title" className="t-headline text-text">
          {request.title ?? "Tasdiqlaysizmi?"}
        </h2>
        <p className="t-subhead t-secondary">{request.message}</p>
        <div className="mt-3 flex flex-none justify-end gap-2">
          <Button type="button" variant="secondary" onClick={cancel}>
            Bekor qilish
          </Button>
          <Button
            type="button"
            variant={request.destructive ? "danger-ghost" : "primary"}
            onClick={() => answer(true)}
          >
            {request.confirmText}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
