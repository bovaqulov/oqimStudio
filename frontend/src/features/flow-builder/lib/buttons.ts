import type { IconName } from "@/components/ui/Icon";
import type { ButtonKind, ButtonMode, FlowButton, FlowNode } from "@/features/flows";
import { getContentDefinition, nodeContentKind } from "./message-content";

export const BUTTON_KIND_OPTIONS: { value: ButtonKind; label: string; icon: IconName }[] = [
  // "Callback" is the Bot API's word for it. What the author is choosing
  // is what the button *does*, and it branches the flow.
  { value: "callback", label: "Tugma bosilganda", icon: "cursor-click" },
  { value: "url", label: "URL", icon: "globe-hemisphere-west" },
  { value: "webapp", label: "Web App", icon: "browser" },
  { value: "login", label: "Login", icon: "identification-badge" },
  { value: "switch_inline", label: "Boshqa chatga", icon: "arrows-left-right" },
  { value: "copy", label: "Nusxalash", icon: "copy" },
  { value: "request_contact", label: "Telefon so'rash", icon: "phone" },
  { value: "request_location", label: "Joylashuv so'rash", icon: "map-pin" },
];

/** Placeholder shown for the button's `value` field — omitted entirely for "callback", which needs none. */
export const BUTTON_VALUE_PLACEHOLDER: Partial<Record<ButtonKind, string>> = {
  url: "https://...",
  // Empty is the useful default here, unlike every other kind: the runtime
  // reads a blank Web App address as "this bot's own Mini App" and fills in
  // the URL the Web App module serves (`sender._mini_app_url`).
  webapp: "https://... — o'z mini ilovangiz manzili",
  login: "https://... (Login)",
  switch_inline: "qidiruv so'rovi (ixtiyoriy)",
  copy: "nusxalanadigan matn",
};

export function buttonKindMeta(kind: ButtonKind): (typeof BUTTON_KIND_OPTIONS)[number] {
  // BUTTON_KIND_OPTIONS is a fixed non-empty literal — the fallback always exists.
  return BUTTON_KIND_OPTIONS.find((option) => option.value === kind) ?? BUTTON_KIND_OPTIONS[0]!;
}

export function createFlowButton(): FlowButton {
  return { id: `b${Date.now()}${Math.round(Math.random() * 1000)}`, label: "Tugma", kind: "callback" };
}

/*
 * Per-button branching.
 *
 * A block's keyboard is not one exit but several: each button the user can
 * tap continues the flow into its own block. Those branches are ordinary
 * edges whose `port` is the button's id behind a `btn:` prefix, so the rest
 * of the editor (routing, history, persistence) needs no special case — only
 * the port list a card publishes changes.
 */
const BUTTON_PORT_PREFIX = "btn:";

export function buttonPortId(buttonId: string): string {
  return `${BUTTON_PORT_PREFIX}${buttonId}`;
}

/** The button a port belongs to, or null for the block's own "out"/"yes"/"no" ports. */
export function buttonIdFromPort(port: string): string | null {
  return port.startsWith(BUTTON_PORT_PREFIX) ? port.slice(BUTTON_PORT_PREFIX.length) : null;
}

/**
 * Kinds Telegram only accepts on an inline keyboard: a reply-keyboard button is
 * plain text the user sends back, so it can carry no URL, login, inline query
 * or copy payload.
 *
 * `webapp` was in this list and is not one of them — `KeyboardButton` has a
 * `web_app` field of its own. It is pinned to reply instead, for a reason that
 * is about the answer rather than the button: see [[isMiniAppKind]].
 */
const INLINE_ONLY_KINDS: ButtonKind[] = ["url", "login", "switch_inline", "copy"];

/** The mirror set: a share row is a `KeyboardButton` power, inline buttons have none. */
const REPLY_ONLY_KINDS: ButtonKind[] = ["request_contact", "request_location"];

export function isReplyOnlyKind(kind: ButtonKind): boolean {
  return REPLY_ONLY_KINDS.includes(kind);
}

/** Whether Telegram takes this button on an inline keyboard only. */
export function isInlineOnlyKind(kind: ButtonKind): boolean {
  return INLINE_ONLY_KINDS.includes(kind);
}

/**
 * The Web App button, which settles the keyboard without being exclusive to it.
 *
 * Telegram takes `web_app` on both kinds of button, but the two open different
 * apps. A Mini App launched from a `KeyboardButton` "will be able to send a
 * 'web_app_data' service message"; one launched from an `InlineKeyboardButton`
 * answers through `answerWebAppQuery` instead, and the client-side rule is
 * blunter — `sendData` "is only available for Mini Apps launched via a Keyboard
 * button".
 *
 * So an inline Mini App button opens a page that can never reach the flow that
 * sent it: the app runs, the customer fills it in, and the branch drawn off the
 * button never fires. That is not a keyboard an author should be able to draw
 * by accident, so this kind pins the block to reply the way a share row does —
 * and unlike `isReplyOnlyKind` it stays *selectable* on an inline block, since
 * picking it is what moves the block.
 *
 * Mirrors `sender.REPLY_PINNED_KINDS`.
 * https://core.telegram.org/bots/api#keyboardbutton
 */
export function isMiniAppKind(kind: ButtonKind): boolean {
  return kind === "webapp";
}

/**
 * The button a question asks its answer with — Telegram's `request_contact` /
 * `request_location`. Derived from the answer type rather than stored and
 * edited: the author says what they are asking for, and the button that asks
 * it comes with it, spelled the one way Telegram accepts.
 */
const ANSWER_SHARE_BUTTONS: Record<"contact" | "location", AnswerShareButton> = {
  contact: { label: "Telefon raqamni yuborish", icon: "phone", sample: "+998 90 123 45 67" },
  location: { label: "Joylashuvni yuborish", icon: "map-pin", sample: "Toshkent, Amir Temur ko'chasi 1" },
};

export interface AnswerShareButton {
  label: string;
  icon: IconName;
  /**
   * What a tap on it delivers, for the test chat.
   *
   * A real tap hands Telegram a phone number or a place; the simulator has
   * neither to hand, and a tap that answers with nothing leaves the question's
   * "save answer" block storing whatever the tester said before it — which is
   * how a name ends up filed as a phone number.
   */
  sample: string;
}

/** The share button this block sends on its own, or null when it asks for plain text. */
export function answerShareButton(_node: FlowNode): AnswerShareButton | null {
  // Only «Savol» ever sent one, off its `answerType`, and that block is gone.
  return null;
}

/**
 * The keyboard type the block already decides for itself — by the answer it
 * asks for, by its content kind, or by a button that only an inline keyboard
 * can carry — together with the reason to show. Null when a plain callback
 * keyboard works either way and the choice is genuinely the author's.
 */
export function buttonModeLock(node: FlowNode): { mode: ButtonMode; reason: string } | null {
  // What the block asks for outranks what its buttons happen to be: a phone
  // number or a place can only be shared off a reply keyboard, so that answer
  // settles the keyboard and the button kinds bend to it, not the other way.
  const share = answerShareButton(node);
  if (share) return { mode: "reply", reason: `«${share.label}» faqat reply klaviaturada yuboriladi.` };

  const content = getContentDefinition(nodeContentKind(node));
  if (content.inlineButtonsOnly) {
    return { mode: "inline", reason: `«${content.label}» faqat inline klaviatura bilan yuboriladi.` };
  }
  // The share row is checked *before* the inline-only kinds, because that is
  // the order the runtime's `effective_button_mode` resolves them in: on a
  // keyboard carrying both, reply wins — a URL button on a reply keyboard
  // degrades to a tappable label, a share row on an inline one to nothing at
  // all. When these two disagreed, every lock-aware surface (the preview, the
  // ports, the warnings) told the author the exact inverse of what shipped.
  const replyPinned = nodeButtons(node).find((button) => isReplyOnlyKind(button.kind));
  if (replyPinned) {
    return { mode: "reply", reason: `«${buttonKindMeta(replyPinned.kind).label}» tugmasi faqat reply klaviaturada ishlaydi.` };
  }
  // Before the inline-only kinds below, for the same reason the share row is:
  // on a keyboard carrying both, reply is what actually ships. A Mini App on an
  // inline row would open and then have no way back into the flow.
  if (nodeButtons(node).some((button) => isMiniAppKind(button.kind))) {
    return {
      mode: "reply",
      reason: "Mini ilova javobni faqat reply klaviaturadagi tugmadan qaytara oladi.",
    };
  }
  const pinned = nodeButtons(node).find((button) => isInlineOnlyKind(button.kind));
  if (!pinned) return null;
  return { mode: "inline", reason: `«${buttonKindMeta(pinned.kind).label}» tugmasi faqat inline klaviaturada ishlaydi.` };
}

/** The keyboard as it actually goes out: the locked type, else the author's pick. */
export function effectiveButtonMode(node: FlowNode): ButtonMode {
  return buttonModeLock(node)?.mode ?? node.buttonMode ?? "inline";
}

/** The keyboard as Telegram would render it — empty for content kinds that take no buttons. */
export function nodeButtons(node: FlowNode): FlowButton[] {
  if (!node.buttons?.length) return [];
  return getContentDefinition(nodeContentKind(node)).supportsButtons ? node.buttons : [];
}

/** Telegram accepts at most this many buttons side by side on one keyboard row. */
export const MAX_BUTTONS_PER_ROW = 8;

/**
 * The flat button list cut into keyboard rows — the shape Telegram's
 * `inline_keyboard` / `keyboard` actually takes. A button opens a new row
 * unless it is marked `sameRow`; the first one always opens the first row, and
 * a row that has run out of width pushes the next button down rather than
 * building a keyboard Telegram would reject.
 */
export function toButtonRows(buttons: FlowButton[]): FlowButton[][] {
  const rows: FlowButton[][] = [];
  for (const button of buttons) {
    const last = rows[rows.length - 1];
    if (button.sameRow && last && last.length < MAX_BUTTONS_PER_ROW) last.push(button);
    else rows.push([button]);
  }
  return rows;
}

/** This block's keyboard, laid out in rows. */
export function buttonRows(node: FlowNode): FlowButton[][] {
  return toButtonRows(nodeButtons(node));
}

/**
 * Whether tapping this button reports back to the bot, which is what makes a
 * branch from it possible:
 *  - a reply keyboard sends the button's label as a normal message, so every
 *    button on one continues the flow — and the Web App row is the one that
 *    does it differently: it opens a page instead of sending its label, and
 *    what comes back is the `web_app_data` message the app sent minutes later.
 *    `dispatch._webapp_port` matches that update to this button's exit, which
 *    is why the port is drawn here rather than treated as unroutable;
 *  - an inline keyboard only reports `callback` taps (`callback_query`). A
 *    url / login / switch_inline / copy button never returns to the bot, and
 *    an inline `web_app` button answers through `answerWebAppQuery` rather
 *    than the update stream this editor models — which is exactly why
 *    [[isMiniAppKind]] keeps a Mini App button off an inline keyboard.
 */
export function isRoutableButton(button: FlowButton, mode: ButtonMode): boolean {
  return mode === "reply" || button.kind === "callback";
}

/** The buttons that get their own output port on the card, in keyboard order. */
export function routableButtons(node: FlowNode): FlowButton[] {
  const mode = effectiveButtonMode(node);
  return nodeButtons(node).filter((button) => isRoutableButton(button, mode));
}

/** Why a button has no branch of its own — shown next to it in the inspector. */
export function unroutableReason(button: FlowButton): string {
  return button.kind === "webapp"
    ? "Web App tugmasi inline klaviaturada javobni oqimga qaytarmaydi."
    : "Bu tugma Telegram'ga javob yubormaydi — tarmoq ochilmaydi.";
}
