"use client";

import { useEffect, useMemo, useTransition } from "react";
import { Icon, type IconName } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
import { Modal } from "@/components/ui/Modal";
import { usePhoneViewport } from "@/lib/hooks/usePhoneViewport";
import type { ModuleKey } from "@/features/flows";
// Straight from the action module, not the feature's barrel: the barrel also
// re-exports the repository, and importing that from a client component would
// drag the server-only API client into the browser bundle.
import { createModuleFlowAction } from "@/features/flows/actions";
import { cn } from "@/lib/utils/cn";
import { useFlowStudioStore } from "../flow-studio-store";
import { buildableTemplates } from "../lib/build-graph";
import { getModuleKit } from "../registry";
import { FlowWizard } from "./FlowWizard";
import { TemplateGallery } from "./TemplateGallery";

/**
 * The three ways to get a flow, mounted once per module page.
 *
 * Every "Yangi oqim" affordance on the page — the header button, the empty
 * state's CTA, a hint's link — goes through `useFlowStudioStore`, so this is the
 * only place the dialogs live and they can never end up open twice.
 */
export function FlowStudio({
  moduleKey,
  projectId,
  botId,
}: {
  moduleKey: ModuleKey;
  projectId: string;
  botId: string;
}) {
  const phone = usePhoneViewport();
  const mode = useFlowStudioStore((state) => state.mode);
  const seed = useFlowStudioStore((state) => state.seed);
  const close = useFlowStudioStore((state) => state.close);
  const openGallery = useFlowStudioStore((state) => state.openGallery);
  const openWizard = useFlowStudioStore((state) => state.openWizard);
  /*
   * The store outlives the page — that is its point — but a *dialog* must not.
   * A successful save redirects into the new flow from inside the server
   * action, so the `close()` a success would have called never runs and the
   * store keeps saying "wizard". Nothing shows in the editor, which mounts no
   * FlowStudio; the ghost waited for the reader to press the header's "Bot"
   * and greeted them with step 1 of a wizard nobody opened (BUG-001). The
   * blank-canvas path parked a "chooser" the same way. Leaving the page is
   * the one moment that covers every exit, so the cleanup lives there.
   */
  useEffect(() => close, [close]);

  const kit = getModuleKit(moduleKey);
  // The number the chooser promises has to be the number the gallery shows.
  const offered = useMemo(() => buildableTemplates(kit), [kit]);
  const [pending, startTransition] = useTransition();

  function openBlankCanvas() {
    startTransition(async () => {
      const form = new FormData();
      form.set("projectId", projectId);
      form.set("botId", botId);
      form.set("moduleKey", moduleKey);
      await createModuleFlowAction(form);
    });
  }

  return (
    <>
      <Modal open={mode === "chooser"} onClose={close} labelledBy="chooser-title" className="max-w-[520px]">
        <div className="flex flex-none items-center gap-2.5 border-b border-separator px-4 py-3">
          <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-accent-800 text-accent-ink">
            <Icon name="flow-arrow" size={14} />
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            {/* The three rows below answer this; a line saying they are
                equivalent is a caption on a picture. */}
            <span id="chooser-title" className="t-headline truncate">
              Oqimni qanday boshlaymiz?
            </span>
          </span>
          <IconButton icon="x" label="Yopish" size={26} className="max-md:h-[38px] max-md:w-[38px]" onClick={close} />
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-4">
          {/* The count says which shelf it is counting. It read "N ta tayyor
              oqim" beside a Market that says "3 ta shablon", and the two
              numbers are of two different things — these are the kit's
              recipes for *this* module, the Market is a catalogue of
              installable graphs — so a reader comparing them concluded the
              product had lost some. */}
          <ChooserRow
            icon="puzzle-piece"
            title="Tayyor shablondan"
            description={`Shu bo'lim uchun ${offered.length} ta tayyor oqim`}
            badge="eng tez"
            onClick={openGallery}
          />
          {/* No badge. It said "kod kerak emas", which is true of this row and
              equally true of the two beside it — and a claim made on one of
              three is a claim about the other two. "eng tez" above stays: that
              one really does separate its row from the others. */}
          <ChooserRow
            icon="sparkle"
            title="Yordamchi bilan yig'ish"
            description="Uch savolda yig'iladi"
            onClick={() => openWizard()}
          />
          {/*
            «Eng sodda oqim» and not «Bo'sh kanvas».
            
            The row created a flow with a Handler and a welcome message already
            in it — which is the right thing to create, and the wrong thing to
            call empty. A reader who picks "blank" and is handed two blocks does
            not conclude the name was loose; they conclude something else made
            them, and go looking for what.

            The description carries the phone caveat rather than leaving it to
            be discovered later under «⋯»: on a phone every flow opens as a list
            whatever it remembers, so "vizual muharrirda" was a promise this row
            cannot keep at this width. Said where the choice is made, which is
            the only place it can change the choice.
          */}
          <ChooserRow
            icon="git-branch"
            title="Eng sodda oqim"
            description={
              phone
                ? "Handler va bitta xabar — telefonda ro'yxat ko'rinishida ochiladi"
                : "Handler va bitta xabar — qolganini o'zingiz yig'asiz"
            }
            onClick={openBlankCanvas}
            pending={pending}
          />
        </div>
      </Modal>

      <TemplateGallery
        moduleKey={moduleKey}
        projectId={projectId}
        botId={botId}
        open={mode === "gallery"}
        onClose={close}
        onCustomize={(initial) => openWizard(initial)}
      />

      <FlowWizard
        moduleKey={moduleKey}
        projectId={projectId}
        botId={botId}
        open={mode === "wizard"}
        onClose={close}
        initial={seed ?? undefined}
      />
    </>
  );
}

function ChooserRow({
  icon,
  title,
  description,
  badge,
  pending = false,
  onClick,
}: {
  icon: IconName;
  title: string;
  description: string;
  badge?: string;
  pending?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className={cn(
        "oq-press flex cursor-pointer items-center gap-3 rounded-[16px] bg-surface-raised p-4 text-left transition-colors",
        "disabled:cursor-wait disabled:opacity-60",
        "max-md:min-h-[68px]",
      )}
    >
      <span className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[8px] bg-neutral-800 text-neutral-400">
        <Icon name={icon} size={18} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-1.5">
          <span className="text-[17px] font-semibold md:text-[13.5px]">{title}</span>
          {badge && <span className="t-caption rounded-full bg-accent-800 px-2 py-[3px] text-accent-200">{badge}</span>}
        </span>
        <span className="t-footnote t-secondary line-clamp-1">{description}</span>
      </span>
      <Icon name={pending ? "clock" : "caret-right"} size={15} className="flex-none text-neutral-600" />
    </button>
  );
}
