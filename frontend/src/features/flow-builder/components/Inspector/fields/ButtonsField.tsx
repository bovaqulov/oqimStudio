"use client";

import { Fragment, useEffect, useState } from "react";
import { CheckboxRow } from "@/components/ui/CheckboxRow";
import { Icon } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { cn } from "@/lib/utils/cn";
import type { ButtonMode, ButtonStyle, FlowButton, FlowNode } from "@/features/flows";
import {
  BUTTON_KIND_OPTIONS,
  BUTTON_VALUE_PLACEHOLDER,
  MAX_BUTTONS_PER_ROW,
  answerShareButton,
  buttonKindMeta,
  buttonModeLock,
  createFlowButton,
  effectiveButtonMode,
  isInlineOnlyKind,
  isReplyOnlyKind,
  toButtonRows,
} from "../../../lib/buttons";
import { BUTTON_STYLE_BG } from "../../preview/telegram-colors";
import { BackRowField } from "./BackRowField";
import { ButtonModeField } from "./ButtonModeField";
import { ButtonLayoutField } from "./ButtonLayoutField";
import { ContentIssues } from "./ContentIssues";
import { FieldHint } from "./FieldHint";
import { FieldLabel } from "./FieldLabel";
import { LocalizedLabel, useLocalizedText } from "./TextLanguage";

/** Past this many buttons on one row the labels are squeezed too narrow to read on a phone. */
const CROWDED_ROW = 3;

/**
 * The keyboard editor, in the order the author meets it.
 *
 * An empty block asks the one question everything else depends on — reply or
 * inline — as two cards, because Telegram draws the two keyboards in different
 * places and half the button kinds only ride one of them. Only then does the
 * list open: a name per button, «+ Tugma qo'shish», and a gear that holds the
 * keyboard's settings (today: its type, for changing the choice after the
 * fact; the rest of the per-button settings return there later).
 *
 * The choice step is skipped when the block has already decided for itself —
 * a question collecting a phone number locks to reply, some content kinds to
 * inline — `buttonModeLock` knows, and asking anyway would offer a choice the
 * segmented control in the gear immediately reports as not the author's.
 *
 * The per-button kind select and value input used to live on every card and
 * are deliberately gone from this view. A button already carrying a kind still
 * shows its icon, and a kind stranded by a reply keyboard is still reported —
 * editing them comes back with the gear's settings.
 */
export function ButtonsField({
  node,
  onPatch,
  chrome = "full",
}: {
  node: FlowNode;
  onPatch: (value: Partial<FlowNode>) => void;
  /**
   * "plain" is the menu's: it embeds this list inside an editor of its own,
   * keeps its keyboard type in the drawer below, and its blocks are never
   * usefully empty — so neither the opening choice nor the gear applies.
   */
  chrome?: "full" | "plain";
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  /** Card the pointer is over mid-drag — where the insertion line is drawn. */
  const [overId, setOverId] = useState<string | null>(null);
  /** Card whose handle is pressed — the only card that is draggable right now. */
  const [armedId, setArmedId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** Card whose own settings drawer is open — one at a time, like an accordion. */
  const [openId, setOpenId] = useState<string | null>(null);

  // The drag is over when the *browser* says it is over — the same lesson
  // SimpleStepList wrote down: after a drop reorders the list, `dragend` can
  // fire on an element React has already moved, and a card was left frozen at
  // its drag opacity with the insertion line still drawn. The window hears
  // about every end, including a drop outside the list.
  useEffect(() => {
    if (!dragId) return;
    const end = () => {
      setDragId(null);
      setOverId(null);
      setArmedId(null);
    };
    window.addEventListener("dragend", end);
    window.addEventListener("drop", end);
    return () => {
      window.removeEventListener("dragend", end);
      window.removeEventListener("drop", end);
    };
  }, [dragId]);

  /** Everything a finished drag leaves behind, cleared in one place. */
  function endDrag() {
    setDragId(null);
    setOverId(null);
    setArmedId(null);
  }
  const buttons = node.buttons ?? [];
  const lock = buttonModeLock(node);
  const replyKeyboard = effectiveButtonMode(node) === "reply";
  const share = answerShareButton(node);
  // A kind the current keyboard cannot carry, either direction. The lock in
  // `buttonModeLock` prevents most of these; a keyboard holding both an
  // inline-only and a reply-only kind is the one that still gets here.
  const stranded = buttons
    .filter((button) => (replyKeyboard ? isInlineOnlyKind(button.kind) : isReplyOnlyKind(button.kind)))
    .map((button) => button.kind);
  const strandedKinds = [...new Set(stranded)];

  // The choice, then the list. `!lock` and not `buttonMode == null`: an author
  // who picked a type, added a button and deleted it again lands back here,
  // which is also the only way to re-pick the type without opening the gear.
  if (chrome === "full" && buttons.length === 0 && !lock) {
    return (
      <div className="flex flex-col gap-1">
        <FieldLabel>Tugmalar</FieldLabel>
        <FieldHint>Avval klaviatura turini tanlang:</FieldHint>
        <div className="grid grid-cols-2 gap-1.5">
          <ModeChoice
            label="Reply"
            hint="Yozish maydoni o'rnida katta tugmalar"
            onClick={() => onPatch({ buttonMode: "reply", buttons: [createFlowButton()] })}
          />
          <ModeChoice
            label="Inline"
            hint="Xabarning ostida ixcham tugmalar"
            onClick={() => onPatch({ buttonMode: "inline", buttons: [createFlowButton()] })}
          />
        </div>
      </div>
    );
  }

  /**
   * Every edit goes out through here so the keyboard can never keep a `sameRow`
   * on its first button. Nothing reads such a flag — the first button always
   * opens a row — but left in the data it springs back the moment another
   * button is dragged or added above it.
   */
  function commit(next: FlowButton[]) {
    const first = next[0];
    if (!first?.sameRow) return onPatch({ buttons: next });
    const opened = { ...first };
    delete opened.sameRow;
    onPatch({ buttons: [opened, ...next.slice(1)] });
  }

  function update(id: string, patch: Partial<FlowButton>) {
    commit(buttons.map((button) => (button.id === id ? { ...button, ...patch } : button)));
  }
  function remove(id: string) {
    commit(buttons.filter((button) => button.id !== id));
  }
  /** Paints the button, or hands it back to the app's default (`null`). */
  function setStyle(id: string, style: ButtonStyle | null) {
    commit(
      buttons.map((button) => {
        if (button.id !== id) return button;
        const next = { ...button };
        if (style) next.style = style;
        // Deleted rather than left `undefined`: absent is what "app-specific
        // style" is spelled as, both in the stored graph and in the payload.
        else delete next.style;
        return next;
      }),
    );
  }
  /** Joins the button to the row above (`true`), or drops it onto a row of its own. */
  function setSameRow(id: string, sameRow: boolean) {
    commit(
      buttons.map((button) => {
        if (button.id !== id) return button;
        const next = { ...button };
        if (sameRow) next.sameRow = true;
        else delete next.sameRow;
        return next;
      }),
    );
  }
  function reorder(targetId: string) {
    if (!dragId || dragId === targetId) return;
    const from = buttons.findIndex((button) => button.id === dragId);
    const to = buttons.findIndex((button) => button.id === targetId);
    if (from === -1 || to === -1) return;
    const next = [...buttons];
    const [moved] = next.splice(from, 1);
    if (!moved) return;
    next.splice(to, 0, moved);
    commit(next);
  }

  // Rows are still drawn grouped: a keyboard built before this editor lost its
  // row controls may carry `sameRow`, and rendering it flat would misreport
  // what Telegram sends. The controls for making such rows return with the
  // gear's settings.
  const rows = toButtonRows(buttons);

  return (
    <div
      className="flex flex-col gap-1"
      /*
       * The whole list takes the drop, not only the cards. The insertion line
       * is drawn in the 4px gap *between* cards — exactly where a reader aims —
       * and a drop into that gap used to land on nothing: the ghost flew back
       * and the order stayed put. The cards keep saying which of them the
       * pointer is over; letting go anywhere in the list then lands on the line
       * that was showing.
       */
      onDragOver={(event) => {
        if (!dragId) return;
        event.preventDefault();
        event.stopPropagation();
      }}
      onDrop={(event) => {
        if (!dragId) return;
        event.preventDefault();
        event.stopPropagation();
        if (overId) reorder(overId);
        endDrag();
      }}
    >
      <div className="flex items-center gap-1">
        {/* One switch for the whole keyboard: a Russian message with Uzbek
            buttons under it is not a thing anybody means to ship, so the
            languages are chosen once here and every card below follows. */}
        <div className="min-w-0 flex-1">
          <LocalizedLabel label="Tugmalar" value={buttons.map((button) => button.label)} />
        </div>
        {chrome === "full" && (
          <IconButton
            icon="gear"
            label="Tugmalar sozlamalari"
            size={24}
            active={settingsOpen}
            onClick={() => setSettingsOpen((open) => !open)}
          />
        )}
      </div>
      {chrome === "full" && settingsOpen && (
        <div className="grid grid-cols-2 items-start gap-2 rounded-md border border-neutral-800 bg-neutral-800/40 p-2">
          <ButtonModeField
            value={node.buttonMode ?? "inline"}
            lock={lock}
            onChange={(buttonMode) => onPatch({ buttonMode })}
          />
          <ButtonLayoutField buttons={buttons} onChange={commit} />
          {/* The block's own way back. It lives here rather than in the list
              because it is not one of the author's keys — and in a component of
              its own because an album has no keyboard editor to hold it, and
              was leaving the row unreachable. See [[BackRowField]]. */}
          <div className="col-span-2">
            <BackRowField node={node} onPatch={onPatch} />
          </div>
        </div>
      )}
      {/* The question's own share button. It is not in the list because it is
          not the author's to edit — it follows "Kutilayotgan javob". */}
      {share && (
        <div
          title="«Kutilayotgan javob» sozlamasidan kelib chiqadi"
          className="flex items-center gap-1.5 rounded-md border border-dashed border-accent-800 bg-accent-900/25 p-[8px] text-[11.5px] max-md:text-[13px] text-accent-200"
        >
          <Icon name={share.icon} size={13} className="flex-none" />
          <span className="min-w-0 flex-1 truncate">{share.label}</span>
          <span className="flex-none text-[10px] max-md:text-[12px] text-neutral-500">avtomatik</span>
        </div>
      )}
      {rows.map((row) => {
        const cards = row.map((button) => {
          const from = buttons.findIndex((item) => item.id === dragId);
          const to = buttons.findIndex((item) => item.id === button.id);
          // The line sits on the side the card is travelling towards, so where
          // it is drawn is where the card lands — SimpleStepList's rule.
          const line =
            dragId && overId === button.id && dragId !== button.id ? (from > to ? "above" : "below") : null;
          // The card's join switch always speaks about the row above it: the
          // very first button opens the keyboard and has no row to join, and a
          // full row above cannot take one more.
          const rowAbove = to > 0 ? rows.find((r) => r.some((item) => item.id === buttons[to - 1]!.id)) : undefined;
          const join =
            to === 0
              ? undefined
              : {
                  joined: !!button.sameRow,
                  disabled: !button.sameRow && (rowAbove?.length ?? 0) >= MAX_BUTTONS_PER_ROW,
                  onToggle: () => setSameRow(button.id, !button.sameRow),
                };
          return (
            <ButtonCard
              key={button.id}
              button={button}
              replyKeyboard={replyKeyboard}
              noRequestKinds={false}
              join={join}
              open={openId === button.id}
              onStyle={(style) => setStyle(button.id, style)}
              onToggleOpen={() => setOpenId(openId === button.id ? null : button.id)}
              dragging={dragId === button.id}
              armed={armedId === button.id}
              line={line}
              onArm={() => setArmedId(button.id)}
              onDisarm={() => setArmedId(null)}
              onDragStart={() => setDragId(button.id)}
              onDragOver={() => setOverId(button.id)}
              onDragEnd={endDrag}
              onUpdate={(patch) => update(button.id, patch)}
              onRemove={() => remove(button.id)}
            />
          );
        });

        if (row.length === 1) return <Fragment key={row[0]?.id}>{cards}</Fragment>;
        return (
          <div key={row[0]?.id} className="flex flex-col gap-1 rounded-md border border-dashed border-neutral-800 p-1">
            <span className="flex items-center gap-1 px-0.5 text-[10.5px] max-md:text-[12px] text-neutral-500">
              <Icon name="arrows-left-right" size={11} className="flex-none text-accent-400" />
              Bir qatorda · {row.length} ta{row.length > CROWDED_ROW && " · yorliqlar qisqaradi"}
            </span>
            {cards}
          </div>
        );
      })}
      <ContentIssues
        issues={strandedKinds.map((kind) =>
          replyKeyboard
            ? `«${buttonKindMeta(kind).label}» tugmasi reply klaviaturada ishlamaydi — Telegram uni oddiy matn sifatida yuboradi.`
            : `«${buttonKindMeta(kind).label}» tugmasi inline klaviaturada ishlamaydi — turini o'zgartiring yoki klaviaturani reply qiling.`,
        )}
      />
      <button
        type="button"
        title="Yangi tugma qo'shish"
        onClick={() => commit([...buttons, createFlowButton()])}
        className={cn(
          // 32px was under the floor on the one screen a phone actually edits.
          "flex cursor-pointer items-center justify-center gap-1.5 rounded-[10px] border border-dashed border-neutral-700 transition-colors",
          "min-h-[44px] px-3.5 text-[15px] md:min-h-0 md:gap-1 md:px-[10px] md:py-[6px] md:text-[11.5px]",
          "text-neutral-400 hover:border-accent-500 hover:text-accent-400",
        )}
      >
        <Icon name="plus" size={15} className="md:hidden" />
        <Icon name="plus" size={11} className="hidden md:block" />
        Tugma qo&apos;shish
      </button>
    </div>
  );
}

/** One half of the opening choice — the keyboard type, named and placed. */
function ModeChoice({ label, hint, onClick }: { label: ButtonMode | string; hint: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex min-h-[44px] cursor-pointer flex-col items-start gap-0.5 rounded-[10px] border border-dashed border-neutral-700 px-3 py-2 text-left transition-colors",
        "hover:border-accent-500",
      )}
    >
      <span className="text-[13px] font-medium text-neutral-200 capitalize">{label}</span>
      <span className="text-[10.5px] leading-snug text-neutral-500 max-md:text-[12px]">{hint}</span>
    </button>
  );
}

function ButtonCard({
  button,
  replyKeyboard,
  noRequestKinds,
  join,
  open,
  onToggleOpen,
  onStyle,
  dragging,
  armed,
  line,
  onArm,
  onDisarm,
  onDragStart,
  onDragOver,
  onDragEnd,
  onUpdate,
  onRemove,
}: {
  button: FlowButton;
  /** Which kinds this keyboard can carry — the impossible ones go inert, with the reason on them. */
  replyKeyboard: boolean;
  /**
   * A question offers no request kinds: what they provide is the question's
   * own job — `answerType` telefon/joylashuv sends the share keyboard — and
   * the runtime neither sends author buttons on a share question nor routes a
   * share through them there (`_reply_port` answers "out" first). A port the
   * test chat can walk and production cannot is worse than no option.
   */
  noRequestKinds: boolean;
  /** Absent on the keyboard's first button — it has no row above it to join. */
  join?: { joined: boolean; disabled: boolean; onToggle: () => void };
  /** This card's own settings drawer. */
  open: boolean;
  onToggleOpen: () => void;
  onStyle: (style: ButtonStyle | null) => void;
  dragging: boolean;
  /** The handle is pressed — only then is the card draggable at all. */
  armed: boolean;
  /** Insertion marker: the side of this card the dragged one would land on. */
  line: "above" | "below" | null;
  onArm: () => void;
  onDisarm: () => void;
  onDragStart: () => void;
  onDragOver: () => void;
  onDragEnd: () => void;
  onUpdate: (patch: Partial<FlowButton>) => void;
  onRemove: () => void;
}) {
  const meta = buttonKindMeta(button.kind);
  const label = useLocalizedText(button.label, (next) => onUpdate({ label: next }));
  const placeholder = BUTTON_VALUE_PLACEHOLDER[button.kind];

  return (
    <div
      /*
       * Draggable only while the handle is held. With the whole card always
       * draggable, selecting text inside the name input flung the card
       * instead — the browser treats any press-and-move on a draggable as a
       * drag, and an input's own selection loses that fight.
       */
      draggable={armed}
      /*
       * Stopped at this card, every one of them. In Simple mode the whole
       * editor lives inside a draggable <li> — the step, which has drag
       * handlers of its own — and a dragstart that bubbles up convinces the
       * list a *step* is being dragged: the open editor fades to the step's
       * drag opacity and the drop reorders the conversation instead of the
       * keyboard. The payload is for Firefox, which starts no drag without one.
       */
      onDragStart={(event) => {
        event.stopPropagation();
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", button.id);
        onDragStart();
      }}
      // No stopPropagation on these two: the card only reports which target the
      // pointer is over, and the drop itself is the list's to handle — it
      // bubbles up to the container, which also owns the gaps between cards.
      onDragOver={(event) => {
        event.preventDefault();
        onDragOver();
      }}
      onDragEnd={(event) => {
        event.stopPropagation();
        onDragEnd();
      }}
      className={cn(
        "relative flex flex-col gap-1.5 rounded-md border border-neutral-800 bg-neutral-800/40 p-[8px] transition-opacity",
        dragging && "opacity-40",
      )}
    >
      {/* Where the drop would land — drawn in the 4px gap between cards. */}
      {line && (
        <span
          className={cn(
            "pointer-events-none absolute right-0 left-0 h-0.5 rounded-full bg-accent-500",
            line === "above" ? "-top-[3px]" : "-bottom-[3px]",
          )}
        />
      )}
      <div className="flex items-center gap-1.5">
        <span
          className="cursor-grab touch-none text-neutral-600"
          title="Tashish uchun torting"
          onMouseDown={onArm}
          onMouseUp={onDisarm}
          onTouchStart={onArm}
          // Paired, like the mouse events above. A plain tap that armed and
          // never disarmed left the card draggable for good — the next
          // long-press in its name input dragged the card instead of
          // selecting text, the exact regression arming exists to prevent.
          onTouchEnd={onDisarm}
          onTouchCancel={onDisarm}
        >
          <Icon name="dots-three" size={13} />
        </span>
        {/* What the button *is*, even while its settings are closed — a URL
            button that stopped announcing itself would read as a plain one. */}
        <span className="flex-none text-accent-400" title={meta.label}>
          <Icon name={meta.icon} size={13} />
        </span>
        <Input
          value={label.value}
          onChange={(event) => label.onChange(event.target.value)}
          // An untranslated button shows the label it will actually carry.
          placeholder={label.fallback}
          aria-label="Tugma nomi"
          className="flex-1"
        />
        {/* The gear closes what it opened — an open drawer next to a control
            that still says "settings" left the ✕ beside it as the only thing
            that *looked* like "close", and that one deletes the button. The
            bin says what deleting is, in both states. */}
        <IconButton
          icon={open ? "x" : "gear"}
          label={open ? "Sozlamalarni yopish" : "Tugma sozlamalari"}
          size={24}
          active={open}
          onClick={onToggleOpen}
        />
        <IconButton icon="trash" label="Tugmani o'chirish" size={24} onClick={onRemove} />
      </div>

      {open && (
        <div className="flex flex-col gap-1.5 border-t border-neutral-800 pt-1.5">
          <div className="flex items-center gap-1.5">
            <Select
              value={button.kind}
              aria-label="Tugma turi"
              // The value clears with the kind: a URL is not a search query,
              // and carrying one into the other field only looks like data.
              onChange={(event) => onUpdate({ kind: event.target.value as FlowButton["kind"], value: "" })}
              className="max-w-[150px]"
            >
              {/*
                Not listed rather than listed-and-greyed.
                
                A `<select>` draws a disabled option in the list all the same,
                so «Telefon so'rash» and «Joylashuv so'rash» read as things this
                keyboard offers — and on an inline keyboard Telegram takes
                neither: `request_contact` and `request_location` are
                `KeyboardButton` powers. An author picked one, found it would
                not take, and had nothing on screen saying why. The kind the
                button already has is always kept, so a block converted between
                keyboards still shows what it is carrying instead of a blank
                picker.
              */}
              {BUTTON_KIND_OPTIONS.filter(
                (option) =>
                  option.value === button.kind ||
                  !(
                    (replyKeyboard && isInlineOnlyKind(option.value)) ||
                    ((noRequestKinds || !replyKeyboard) && isReplyOnlyKind(option.value))
                  ),
              ).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
            {placeholder && (
              <Input
                value={button.value ?? ""}
                onChange={(event) => onUpdate({ value: event.target.value })}
                placeholder={placeholder}
                className="flex-1"
              />
            )}
          </div>
          {/* Where the two rows that are not in the list above went. Said only
              on the keyboard that cannot carry them, and only where the author
              can act on it — the keyboard type is a control on this same
              panel. */}
          {!replyKeyboard && !noRequestKinds && (
            <FieldHint>
              Telefon va joylashuv so&apos;rash faqat reply klaviaturada ishlaydi — klaviatura turini
              o&apos;zgartiring.
            </FieldHint>
          )}
          {/*
            Bot API 9.4's `style`. Telegram takes exactly three colors — danger
            (red), success (green), primary (blue) — and "omitted" means the
            customer's own theme, which is why the default swatch is a choice
            here and not the absence of one.
          */}
          <div className="flex items-center gap-1.5">
            <span className="text-[11.5px] max-md:text-[13px] text-neutral-500">Rang</span>
            <div className="flex items-center gap-1">
              <StyleSwatch label="Odatiy" active={!button.style} tone={null} onClick={() => onStyle(null)} />
              <StyleSwatch label="Ko'k" active={button.style === "primary"} tone={BUTTON_STYLE_BG.primary!} onClick={() => onStyle("primary")} />
              <StyleSwatch label="Yashil" active={button.style === "success"} tone={BUTTON_STYLE_BG.success!} onClick={() => onStyle("success")} />
              <StyleSwatch label="Qizil" active={button.style === "danger"} tone={BUTTON_STYLE_BG.danger!} onClick={() => onStyle("danger")} />
            </div>
          </div>
          {/* Row shapes, one button at a time: this is what builds the
              3·2·2·1 keyboards the one-width picker in the keyboard settings
              cannot say. Absent on the first button — nothing above to join. */}
          {join && (
            <CheckboxRow
              checked={join.joined}
              label="Yuqoridagi tugma bilan bir qatorda"
              hint={join.disabled ? `Yuqoridagi qator to'la — ${MAX_BUTTONS_PER_ROW} ta` : undefined}
              onToggle={() => {
                if (!join.disabled) join.onToggle();
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}

/** One color choice — a filled dot for a Telegram style, a hollow one for the app's default. */
function StyleSwatch({
  label,
  active,
  tone,
  onClick,
}: {
  label: string;
  active: boolean;
  /** Swatch fill; `null` draws the hollow "theme decides" dot. */
  tone: string | null;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={`Rang: ${label}`}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex h-7 w-7 cursor-pointer items-center justify-center rounded-full transition-colors",
        active ? "ring-2 ring-accent-400 ring-inset" : "hover:bg-neutral-800",
      )}
    >
      {tone ? (
        <span className="h-4 w-4 rounded-full" style={{ background: tone }} />
      ) : (
        <span className="h-4 w-4 rounded-full border-2 border-dashed border-neutral-500" />
      )}
    </button>
  );
}
