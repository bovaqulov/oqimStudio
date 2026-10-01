"use client";

import { useState } from "react";
import Link from "next/link";
import { askConfirm } from "@/components/ui/confirm-store";
import { useHelpDialogStore } from "@/components/layout/help-store";
import { Icon, type IconName } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
import { Modal } from "@/components/ui/Modal";
import { SegmentedTabs } from "@/components/ui/SegmentedTabs";
import type { FlowLayoutMode } from "@/features/flows";
import { usePhoneViewport } from "@/lib/hooks/usePhoneViewport";
import { cn } from "@/lib/utils/cn";
import { confirmDestructive } from "@/lib/telegram/MainButton";
import { useFlowEditorStore } from "../store/useFlowEditorStore";
import { FlowSearch } from "./FlowSearch";
import { GraphWarnings, useGraphFindings } from "./GraphWarnings";
import { SaveButton } from "./SaveButton";
import { SaveIndicator } from "./SaveIndicator";

/**
 * One shape for every control on this bar.
 *
 * There were seven of them at four heights (24, 26, 27 and 28px) and two radii,
 * sitting on one 52px row — near-identical greys that lined up with nothing.
 * Nothing here is a new look; it is the same controls agreeing on a size.
 *
 * `h-7` because `SegmentedTabs` is 28px tall and is the one control on the row
 * this file does not own, so it sets the height rather than being fought. Fully
 * round for the same reason: the picker and the status pill were already
 * capsules, and half a toolbar of rounded rectangles beside them read as two
 * toolbars that happened to touch.
 */
const BAR_CONTROL = "flex h-7 flex-none cursor-pointer items-center gap-1.5 rounded-full px-3 text-[12px] whitespace-nowrap transition-colors";
const BAR_QUIET = "bg-neutral-800 text-neutral-100 hover:bg-neutral-700";

export function FlowTopBar({ backHref }: { backHref: string }) {
  const name = useFlowEditorStore((s) => s.name);
  const description = useFlowEditorStore((s) => s.description);
  const setName = useFlowEditorStore((s) => s.setName);
  const setDescription = useFlowEditorStore((s) => s.setDescription);
  const nodeCount = useFlowEditorStore((s) => s.nodes.length);
  const edgeCount = useFlowEditorStore((s) => s.edges.length);
  const live = useFlowEditorStore((s) => s.live);
  const toggleLive = useFlowEditorStore((s) => s.toggleLive);
  const pastLength = useFlowEditorStore((s) => s.past.length);
  const futureLength = useFlowEditorStore((s) => s.future.length);
  const undo = useFlowEditorStore((s) => s.undo);
  const redo = useFlowEditorStore((s) => s.redo);
  const testChatOpen = useFlowEditorStore((s) => s.testChatOpen);
  const toggleTestChat = useFlowEditorStore((s) => s.toggleTestChat);
  const scriptOpen = useFlowEditorStore((s) => s.scriptOpen);
  const toggleScript = useFlowEditorStore((s) => s.toggleScript);
  const isMain = useFlowEditorStore((s) => s.isMain);
  const layoutMode = useFlowEditorStore((s) => s.layoutMode);
  const setLayoutMode = useFlowEditorStore((s) => s.setLayoutMode);
  const phone = usePhoneViewport();
  const findings = useGraphFindings();
  const [moreOpen, setMoreOpen] = useState(false);
  // A phone reads the flow as a list whatever the flow remembers — see
  // [[FlowEditor]]. The counts and the block search follow the view that is
  // actually on screen, not the stored preference behind it.
  const simple = phone || layoutMode === "simple";

  /**
   * Going live with a flow the panel beside this button says is broken.
   *
   * Nothing is refused — a half-built flow is a normal thing to have, and the
   * warnings panel exists precisely because this is not a gate. What was
   * missing is the moment of being asked: «Ishga tushirish» sits one click from
   * "the bot now answers real customers with this", and a flow whose menu has
   * two buttons wired to nothing answers two of them with silence. The question
   * says how many, so the answer is an informed one rather than a reflex.
   *
   * Only on the way *on*. Stopping a flow is the safe direction, and the phone
   * sheet already confirms that one.
   */
  async function publish() {
    if (!live && findings.length > 0) {
      const ok = await askConfirm({
        title: name,
        message: `Bu oqimda ${findings.length} ta ogohlantirish bor — ba'zi tugmalar javobsiz qolishi mumkin. Baribir ishga tushirilsinmi?`,
        confirmText: "Ishga tushirish",
        destructive: false,
      });
      if (!ok) return;
    }
    toggleLive();
  }

  return (
    <>
      {/*
       * `relative z-50` is load-bearing, not decoration. `backdrop-blur` makes this
       * header its own stacking context with no z-index of its own, so everything
       * the work area below paints at `z-[9]` and up was landing on top of it —
       * and a popover hanging out of the header (the warnings list) came out
       * underneath the canvas, reading as a transparent panel. Modals and toasts
       * sit later in the document at the same or higher z, so they still win.
       */}
      <header
        className={cn(
          "relative z-50 flex flex-none border-b border-neutral-950 bg-overlay/80 backdrop-blur-sm",
          // On a phone the row becomes two: a title line a thumb never has to
          // reach into, and a status line. Everything that was in between moved
          // behind "⋯" rather than off the screen — see [[MoreActionsSheet]].
          // `flex-wrap` and not a fixed row: `usePhoneViewport` answers "not a
          // phone" during hydration, so a 600px window paints this desktop
          // toolbar for one frame. Wrapping is what stops that frame from
          // running off the right edge with its controls half-cut.
          phone ? "flex-col gap-1.5 px-3.5 py-2" : "min-h-[52px] flex-wrap items-center gap-3 px-[18px] py-1.5",
        )}
      >
        {/* `flex-none`, not `flex-1`. Two `flex-1` siblings split the bar in
            half, so on a 1920px screen the title claimed ~940px to draw a
            320px input — 600px of void down the middle, and the toolbar
            starting at the horizontal centre with its last button off the
            right edge. The title needs what the title needs. */}
        <div
          className={cn(
            "flex items-center gap-1.5",
            // Not `flex-none`: it takes what the name needs up to 300px and
            // gives way when the row is desperate, so a long flow title
            // truncates instead of pushing the publish button off the edge.
            phone ? "w-full" : "min-w-0 max-w-[300px]",
          )}
        >
          {/* Back sits top-left on a phone, where every other screen keeps it.
              The destination is the bot's own page — the default module now
              answers there, so "Bo'limlar" would name a list that is gone. */}
          {phone && (
            <Link
              href={backHref}
              aria-label="Bot sahifasi"
              title="Bot sahifasi"
              className="oq-tap relative -ml-1 flex h-9 w-9 flex-none items-center justify-center rounded-full text-neutral-400 active:bg-neutral-800"
            >
              <Icon name="arrow-left" size={16} />
            </Link>
          )}
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <div className="flex items-center gap-1.5">
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                title={name || "Oqim nomini tahrirlash"}
                className={cn(
                  // `field-sizing: content` shrinks the box to the name in it,
                  // which is what stops the «Asosiy» badge floating 240px away
                  // from a title that is two words long. Where it is not
                  // supported the declaration is ignored and the field falls
                  // back to filling its track, exactly as it did before.
                  "-ml-[6px] min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-[6px] py-0.5 text-[14px] font-medium tracking-tight text-text hover:bg-neutral-800 focus-visible:border-accent-500 focus-visible:bg-neutral-800 focus-visible:outline-none max-md:min-h-[44px] max-md:text-[15px]",
                  !phone && "max-w-[240px] [field-sizing:content]",
                )}
              />
              {/* Says why this editor offers /start when no other one does. */}
              {isMain && (
                <span
                  title="Bo'limning kirish nuqtasi — /start shu oqimda javob beradi"
                  className="flex-none rounded-full bg-accent-800 px-2 py-0.5 text-[10.5px] whitespace-nowrap text-accent-200 max-md:text-[12px]"
                >
                  Asosiy
                </span>
              )}
            </div>
            <input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              /* The box is 300px and the sentence is usually longer, so it is
                 read here or nowhere: a description clipped at "/start
                 buyrug'iga javob be" had the rest of itself nowhere on screen,
                 and the tooltip was offering to teach the reader what an
                 editable field is for. */
              title={description || "Izohni tahrirlash"}
              hidden={phone}
              className={cn(
                "-ml-[6px] rounded-md border border-transparent bg-transparent px-[6px] py-0.5 text-[11px] text-neutral-600 hover:bg-neutral-800 focus-visible:border-accent-500 focus-visible:bg-neutral-800 focus-visible:text-neutral-300 focus-visible:outline-none max-md:text-[13px]",
                !phone && "max-w-[300px]",
              )}
            />
          </div>
          {phone && (
            <IconButton
              icon="dots-three"
              label="Boshqa amallar"
              size={44}
              active={moreOpen}
              onClick={() => setMoreOpen(true)}
            />
          )}
        </div>

        {phone ? (
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
            {/* What it is now. Changing it is a destructive action for a live
                flow, so it lives in "⋯" as a red row with a confirmation —
                not as the brightest button on the screen. */}
            <span className="t-footnote flex items-center gap-[6px] rounded-full bg-neutral-800 px-2.5 py-1 text-neutral-300">
              <span
                className={live ? "h-1.5 w-1.5 animate-pulse rounded-full bg-success-fg" : "h-1.5 w-1.5 rounded-full bg-neutral-700"}
              />
              {live ? "Faol" : "To'xtatilgan"}
            </span>
            <SaveIndicator />
            <GraphWarnings />
          </div>
        ) : (
          /*
           * Three zones, not one row of eleven controls.
           *
           * Left is where you came from and how the flow stands, centre is how
           * you are looking at it, right is what you can do to it. Undo, redo
           * and the shortcut list moved behind "⋯" — they are reached for
           * occasionally, and each one kept in the open cost room from the two
           * that are not: "Sinash" and the publish switch.
           */
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <Link
              href={backHref}
              title="Bot sahifasi"
              aria-label="Bot sahifasi"
              className={cn(BAR_CONTROL, BAR_QUIET, "px-2.5 lg:px-3")}
            >
              <Icon name="arrow-left" size={12} />
              <span className="hidden lg:inline">Bot</span>
            </Link>

            {/* One quiet status line where three controls used to be: how big
                the flow is, and whether it is written down. The counts are the
                first thing to go when the row runs out of width — they are
                context, not controls.

                A hairline rather than a third «·»: the counts already carry one
                between them and `SaveIndicator` carries its own inside
                "Saqlandi · hozir", so a dot here made four separators of two
                different meanings read as one undifferentiated run of text. */}
            <div className="flex min-w-0 flex-none items-center gap-2 text-[11px] whitespace-nowrap text-neutral-600">
              {/* «blok» in both modes. It used to follow the view — "4 qadam"
                  in Oddiy, "4 blok" in Pro — so switching the way you look at a
                  flow renamed the things in it, and the warnings panel below
                  went on saying "blok" in both. */}
              <span className="hidden lg:inline">{nodeCount} blok</span>
              {!simple && (
                <>
                  <span className="hidden text-neutral-800 lg:inline">·</span>
                  <span className="hidden lg:inline">{edgeCount} bog&apos;lanish</span>
                </>
              )}
              <span aria-hidden className="hidden h-3 w-px flex-none bg-neutral-800 lg:block" />
              <SaveIndicator />
              {/* Only when there is something unsaved — see `SaveButton`. */}
              <SaveButton />
            </div>

            {/* Below `lg` the row cannot hold a centred control as well as the
                actions on both sides of it, so the picker moves into "⋯" —
                see [[DesktopMoreMenu]]. It used to move nowhere, and a 1000px
                laptop had no way into the canvas at all.

                `shrink-0` and not `flex-1`: this group is what took the whole
                shortfall when the row ran out of room, and `SegmentedTabs` has
                a width of its own, so the group collapsed to nothing while its
                child kept drawing — the picker painted on top of «Saqlash» on
                one side and the block search on the other. The pressure belongs
                on the group to the right, which wraps. */}
            <div className="hidden shrink-0 grow justify-center lg:flex">
              {/* Two readings of one graph, so the choice sits with the flow's
                  own controls rather than in settings: it is a way to look at
                  this flow, not a preference about the product. */}
              <SegmentedTabs
                label="Tahrirlash rejimi"
                tone="neutral"
                value={layoutMode}
                onChange={setLayoutMode}
                options={[
                  { value: "simple", label: "Oddiy", icon: "list-checks" },
                  { value: "pro", label: "Pro", icon: "flow-arrow" },
                ]}
              />
            </div>

            {/* The desktop bar starts at 768px, so this row has to give things
                up on the way down rather than clip. What it gives up is spelled
                out and always in the same order: the "Bot" label below `lg`,
                the search box and the status word below `xl`.

                `flex-wrap` is the last resort, and it now works. It never fired
                before because this group was also `flex-none` — it could
                neither shrink nor break, only run off the right edge with the
                publish button half-cut, which is exactly what it did. */}
            <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
              {/* Stays in the open rather than inside "⋯": it carries its own
                  popover, and a popover opened from inside a menu is the
                  dialog-over-dialog shape the rest of this editor removed. It
                  is one small control, and only the canvas has anything to
                  search. ⌘F reaches it at any width, and the "⋯" menu says so. */}
              {!simple && (
                <div className="hidden xl:flex">
                  <FlowSearch />
                </div>
              )}
              {/* Beside the publish control, where "is this ready" is decided. */}
              <GraphWarnings />
              {/* A state, not a control — the switch beside it is what changes
                  it. Below `xl` the dot carries it alone: it is the half that
                  can be read at a glance, and `title` keeps the word for
                  anyone who needs it. */}
              <span
                role="status"
                /* The word is the first thing this pill gives up for room, so
                   below `xl` the dot carries the state alone — and a coloured
                   dot is nothing at all to a screen reader, or to anybody who
                   has not learnt which colour means which. `aria-label` says it
                   at every width; `title` is the same sentence for a pointer. */
                aria-label={live ? "Oqim faol" : "Oqim to'xtatilgan"}
                title={live ? "Oqim faol" : "Oqim to'xtatilgan"}
                className="flex h-7 flex-none items-center gap-[6px] rounded-full bg-neutral-800 px-2.5 text-[12px] text-neutral-300 xl:px-3"
              >
                <span
                  className={cn(
                    "h-1.5 w-1.5 flex-none rounded-full",
                    live ? "animate-pulse bg-success-fg" : "bg-neutral-600",
                  )}
                />
                <span className="hidden xl:inline">{live ? "Faol" : "To'xtatilgan"}</span>
              </span>
              {/* Beside "Sinash" rather than beside the Oddiy/Pro picker it was
                  first drawn next to. That picker is the centred group, which
                  the row drops below `lg` because it cannot hold a centred
                  control as well as both sets of actions — and the code of a
                  flow is not a thing that stops mattering on a narrow screen.
                  It is grey like everything else here: writing a script changes
                  nothing a customer sees until the flow beside it is published. */}
              <button
                type="button"
                onClick={toggleScript}
                title="Oqim skripti va bot kutubxonasi"
                className={cn(BAR_CONTROL, scriptOpen ? "bg-accent-800 text-accent-ink hover:bg-accent-700" : BAR_QUIET)}
              >
                <Icon name="code" size={12} /> Script
              </button>
              {/* One name for testing a flow, wherever it is offered: the card
                  says "Sinash", the block's ▶ says "Sinash", and both open this
                  panel. */}
              <button
                type="button"
                onClick={toggleTestChat}
                title="Oqimni suhbat ko'rinishida sinab ko'rish"
                className={cn(
                  BAR_CONTROL,
                  testChatOpen ? "bg-accent-800 text-accent-ink hover:bg-accent-700" : BAR_QUIET,
                )}
              >
                <Icon name="play" size={12} /> Sinash
              </button>
              {/* The one filled control on the row, and the only one that
                  changes what customers see. Everything beside it is grey so
                  that this is what the eye lands on. */}
              <button type="button" onClick={publish} className={cn(BAR_CONTROL, "bg-accent-700 text-white hover:bg-accent-600")}>
                {live ? "To'xtatish" : "Ishga tushirish"}
              </button>
              <DesktopMoreMenu
                simple={simple}
                pastLength={pastLength}
                futureLength={futureLength}
                undo={undo}
                redo={redo}
                layoutMode={layoutMode}
                setLayoutMode={setLayoutMode}
              />
            </div>
          </div>
        )}
      </header>
      {/* Outside the header on purpose: `backdrop-blur` makes that element a
          containing block for anything `position: fixed` inside it, so a sheet
          rendered in there would be pinned to the 60px bar rather than to the
          screen. */}
      {phone && moreOpen && (
        <MoreActionsSheet
          onClose={() => setMoreOpen(false)}
          undoable={pastLength > 0}
          redoable={futureLength > 0}
          onUndo={undo}
          onRedo={redo}
          description={description}
          onDescriptionChange={setDescription}
          live={live}
          onToggleLive={toggleLive}
          name={name}
          onNameChange={setName}
          onOpenScript={toggleScript}
        />
      )}
    </>
  );
}

/**
 * Everything the phone's top bar has no room for, one tap away.
 *
 * The rule this follows is the one in `MOBILE.md`: three decisions on a screen,
 * and the fourth goes behind "⋯". Undo, redo and the explicit save are all here
 * as rows big enough to hit.
 *
 * The shortcut list is the one thing that does *not* follow the desktop menu
 * down here. It is a list of key combinations for a device with no keys — the
 * only row on the sheet that could not be acted on after reading it.
 */
function MoreActionsSheet({
  onClose,
  undoable,
  redoable,
  onUndo,
  onRedo,
  description,
  onDescriptionChange,
  live,
  onToggleLive,
  name,
  onNameChange,
  onOpenScript,
}: {
  onClose: () => void;
  undoable: boolean;
  redoable: boolean;
  onUndo: () => void;
  onRedo: () => void;
  description: string;
  onDescriptionChange: (value: string) => void;
  live: boolean;
  onToggleLive: () => void;
  name: string;
  onNameChange: (value: string) => void;
  onOpenScript: () => void;
}) {
  const save = useFlowEditorStore((s) => s.save);

  return (
    <Modal open onClose={onClose} labelledBy="flow-more-title">
      <div className="flex flex-none items-center gap-2 border-b border-neutral-800 px-4 py-3">
        <span id="flow-more-title" className="flex-1 text-[15px] font-medium">
          Boshqa amallar
        </span>
        <IconButton icon="x" label="Yopish" size={38} onClick={onClose} />
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overscroll-contain p-3">
        {/* Not actions, so they sit above them rather than among them: two
            fields that write straight through, the same two the desktop header
            has.

            The name is here as well as in the bar above. On a phone the bar's
            copy is a small target wedged between the back button and «⋯», and
            this sheet is where somebody goes looking for "rename" — it was
            found here, tried on the «Izoh» field, and reported as the name
            field being mislabelled. Both are bound to the same store value, so
            neither can disagree with the other. */}
        <label className="flex flex-col gap-2 px-1">
          <span className="t-footnote t-secondary">Oqim nomi</span>
          <input
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
            placeholder="Masalan: Navbatga yozilish"
            className="min-h-[44px] rounded-[12px] border border-neutral-800 bg-neutral-850 px-3 text-[15px] text-text placeholder:text-neutral-600 focus-visible:border-accent-500 focus-visible:outline-none"
          />
        </label>
        <label className="mb-2 flex flex-col gap-2 px-1">
          <span className="t-footnote t-secondary">Izoh</span>
          <input
            value={description}
            onChange={(event) => onDescriptionChange(event.target.value)}
            placeholder="Bu oqim nima qiladi?"
            className="min-h-[44px] rounded-[12px] border border-neutral-800 bg-neutral-850 px-3 text-[15px] text-text placeholder:text-neutral-600 focus-visible:border-accent-500 focus-visible:outline-none"
          />
        </label>
        <SheetAction
          icon="check"
          label="Saqlash"
          onClick={() => {
            void save();
            onClose();
          }}
        />
        {/* A phone is not where anybody writes a script, and it is where
            somebody reads one they wrote yesterday — which is the half that
            matters here. The panel drops its rail at this width; the editor
            and the two files stay. */}
        <SheetAction
          icon="code"
          label="Script"
          onClick={() => {
            onOpenScript();
            onClose();
          }}
        />
        {/*
          * Why there is no Oddiy/Pro here.
          *
          * A phone reads every flow as a list whatever the flow remembers — see
          * [[FlowEditor]] — so the picker the desktop bar carries is not merely
          * hidden on this device, it has nothing to switch to. Said once, in
          * the place somebody goes looking for a control they have seen on
          * their laptop, rather than left as a control that silently is not
          * there.
          */}
        <p className="t-footnote t-tertiary mt-1 mb-1 px-3">
          Pro kanvas telefonda ochilmaydi — oqim shu yerda ro&apos;yxat ko&apos;rinishida tahrirlanadi.
        </p>
        <SheetAction
          icon="arrow-counter-clockwise"
          label="Bekor qilish"
          disabled={!undoable}
          onClick={() => {
            onUndo();
            onClose();
          }}
        />
        <SheetAction
          icon="arrow-clockwise"
          label="Qaytarish"
          disabled={!redoable}
          onClick={() => {
            onRedo();
            onClose();
          }}
        />

        {/* Stopping a live flow is the one thing on this sheet a customer
            notices before its author does. Red, last, and asked about first. */}
        <SheetAction
          icon={live ? "pause" : "play"}
          label={live ? "To'xtatish" : "Ishga tushirish"}
          destructive={live}
          onClick={async () => {
            if (live) {
              const ok = await confirmDestructive({
                title: name,
                message: "Oqim to'xtatiladi va mijozlarga javob bermaydi.",
                confirmText: "To'xtatish",
              });
              if (!ok) return;
            }
            onToggleLive();
            onClose();
          }}
        />
      </div>
    </Modal>
  );
}

/** One row of the sheet — a full-width target, not a toolbar button in a list. */
function SheetAction({
  icon,
  label,
  destructive = false,
  disabled = false,
  onClick,
}: {
  icon: IconName;
  label: string;
  destructive?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex min-h-[52px] cursor-pointer items-center gap-3 rounded-[12px] px-3 py-2.5 text-left active:bg-neutral-800 disabled:cursor-default disabled:opacity-45"
    >
      <span
        className={cn(
          "flex h-9 w-9 flex-none items-center justify-center rounded-full bg-neutral-800",
          destructive ? "text-danger-fg" : "text-neutral-300",
        )}
      >
        <Icon name={icon} size={16} />
      </span>
      <span className={cn("t-body min-w-0 flex-1", destructive && "text-danger-fg")}>{label}</span>
    </button>
  );
}

/**
 * The controls an author reaches for occasionally.
 *
 * Undo, redo and the shortcut list were three of the eleven things competing
 * for the top bar; none of them is what somebody opens a flow to do. They keep
 * their keyboard shortcuts — this is where they are *found*, not the only way
 * to reach them.
 */
function DesktopMoreMenu({
  simple,
  pastLength,
  futureLength,
  undo,
  redo,
  layoutMode,
  setLayoutMode,
}: {
  simple: boolean;
  pastLength: number;
  futureLength: number;
  undo: () => void;
  redo: () => void;
  layoutMode: FlowLayoutMode;
  setLayoutMode: (mode: FlowLayoutMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const showHelp = useHelpDialogStore((state) => state.show);

  /*
   * The two views, for the widths that cannot show the picker.
   *
   * The bar drops the centred Oddiy/Pro control below `lg`, and it had to —
   * there is no room for a centred group as well as the actions either side of
   * it. What it did not do was put the choice anywhere else, so on a narrower
   * laptop the canvas was not merely hidden, it was unreachable: the flow
   * remembered "simple", the picker was gone, and nothing on the screen offered
   * Pro. `lg:hidden` and not a viewport read — the row that vanishes is decided
   * in CSS, and the row that replaces it has to vanish by the same rule or the
   * two disagree for a frame.
   */
  const modes: { label: string; icon: IconName; mode: FlowLayoutMode }[] = [
    { label: "Oddiy ro'yxat", icon: "list-checks", mode: "simple" },
    { label: "Pro kanvas", icon: "flow-arrow", mode: "pro" },
  ];

  const rows: { label: string; hint: string; icon: IconName; disabled?: boolean; run: () => void }[] = [
    { label: "Bekor qilish", hint: "⌘Z", icon: "arrow-counter-clockwise", disabled: pastLength === 0, run: undo },
    { label: "Qaytarish", hint: "⌘⇧Z", icon: "arrow-clockwise", disabled: futureLength === 0, run: redo },
    { label: "Tezkor tugmalar", hint: "?", icon: "keyboard", run: showHelp },
  ];

  return (
    <div className="relative">
      <IconButton
        icon="dots-three"
        label="Boshqa amallar"
        size={28}
        onClick={() => setOpen((value) => !value)}
      />
      {open && (
        <>
          {/* Catches the next click anywhere else, so the menu closes the way
              every other menu in the app does. */}
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-30 cursor-default"
          />
          <div className="animate-rise absolute top-full right-0 z-40 mt-1.5 w-[212px] overflow-hidden rounded-[10px] border border-separator bg-overlay py-1 shadow-lg">
            <div className="border-b border-neutral-900 pb-1 lg:hidden">
              {modes.map((row) => (
                <button
                  key={row.mode}
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    setLayoutMode(row.mode);
                  }}
                  className={cn(
                    "flex w-full cursor-pointer items-center gap-2.5 px-3 py-2 text-left text-[12px] hover:bg-neutral-800",
                    layoutMode === row.mode ? "text-accent-300" : "text-neutral-200",
                  )}
                >
                  <Icon name={row.icon} size={13} className="flex-none" />
                  <span className="min-w-0 flex-1 truncate">{row.label}</span>
                  {layoutMode === row.mode && <Icon name="check" size={12} className="flex-none" />}
                </button>
              ))}
            </div>
            {rows.map((row) => (
              <button
                key={row.label}
                type="button"
                disabled={row.disabled}
                onClick={() => {
                  setOpen(false);
                  row.run();
                }}
                className="flex w-full cursor-pointer items-center gap-2.5 px-3 py-2 text-left text-[12px] text-neutral-200 hover:bg-neutral-800 disabled:cursor-default disabled:text-neutral-700 disabled:hover:bg-transparent"
              >
                <Icon name={row.icon} size={13} className="flex-none" />
                <span className="min-w-0 flex-1 truncate">{row.label}</span>
                <span className="flex-none text-[10.5px] text-neutral-600">{row.hint}</span>
              </button>
            ))}
            {!simple && (
              <p className="border-t border-neutral-900 px-3 py-2 text-[10.5px] leading-relaxed text-neutral-600">
                Blok qidirish — ⌘F
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
