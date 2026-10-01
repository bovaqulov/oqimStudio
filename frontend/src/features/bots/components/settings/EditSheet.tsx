"use client";

import type { ReactNode } from "react";
import { Icon } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Modal";
import { MainButton } from "@/lib/telegram/MainButton";

/**
 * One setting, on its own screen.
 *
 * The push-screen half of an iOS settings list: the list says what a value *is*,
 * and changing it happens here, where there is exactly one field and one way
 * out. It is what let the settings screen drop from a scroll of stacked
 * label/input/paragraph triples to a list of rows — a field only exists while
 * somebody is editing it, so it costs no height the rest of the time.
 *
 * The confirm is Telegram's MainButton, so the button that finishes the job is
 * in the same place on every sheet in the app and never inside the scroll.
 */
export function EditSheet({
  title,
  onClose,
  onDone,
  doneText = "Saqlash",
  detent = "medium",
  children,
}: {
  title: string;
  onClose: () => void;
  /**
   * Runs before closing.
   *
   * Most sheets write their values as they are typed, so this only dismisses
   * and returns nothing. A sheet that saves on confirm instead — where the
   * server can still refuse — returns `false` to stay open and show why:
   * closing on a rejected save would take the reader's typing with it and leave
   * them looking at the old value with no idea it had not been taken.
   */
  onDone?: () => boolean | void | Promise<boolean | void>;
  doneText?: string;
  /** `full` for the sheets that hold a list — languages, weekdays, the menu rows. */
  detent?: "full" | "medium";
  children: ReactNode;
}) {
  const finish = async () => {
    if ((await onDone?.()) === false) return;
    onClose();
  };

  return (
    <Modal open onClose={onClose} labelledBy="edit-sheet-title" className="max-w-[520px]" detent={detent}>
      <div className="flex flex-none items-center gap-2 px-4 py-3">
        <span id="edit-sheet-title" className="t-headline min-w-0 flex-1 truncate">
          {title}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Yopish"
          className="oq-press flex h-[30px] w-[30px] flex-none cursor-pointer items-center justify-center rounded-full bg-neutral-800 text-neutral-500"
        >
          <Icon name="x" size={16} />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-4 pb-4">
        {children}
      </div>

      <MainButton inline text={doneText} onClick={finish} />
    </Modal>
  );
}
