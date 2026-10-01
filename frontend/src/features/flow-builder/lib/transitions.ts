import type { EdgeTransition, FlowEdge, FlowNode, MessageContentKind } from "@/features/flows";
import { effectiveButtonMode, nodeButtons } from "./buttons";
import { nodeContentKind } from "./message-content";

/**
 * What happens to the message already on screen when the next block arrives.
 *
 * A mirror of `backend/apps/engine/transitions.py`, and the mirroring is the
 * point: the editor must offer exactly the transitions the runtime will
 * actually attempt, or an author picks something that silently degrades the
 * moment a customer taps it. The backend stays the authority — it knows what
 * was really sent, which this side can only predict from the graph — so when
 * the two disagree the runtime's ladder wins and nothing breaks.
 *
 * Two sentences from https://core.telegram.org/bots/api (Bot API 10.3) decide
 * the whole matrix, and neither is guessable:
 *
 * - `editMessageMedia` — "…or to replace a text or a rich message with a
 *   media." A text menu can become a photo card in place.
 * - `editMessageText` — "Use this method to edit text, rich and game
 *   messages." Media is absent, so the reverse is impossible.
 */

/** Content kinds `editMessageMedia` can produce. There is no `InputMediaVoice`, so voice is out. */
const EDITABLE_MEDIA: readonly MessageContentKind[] = ["photo", "video", "animation", "document", "audio"];

/** What a message on screen may be edited *from*, keyed by what it currently is. */
const EDITABLE_FROM: Partial<Record<MessageContentKind, readonly MessageContentKind[]>> = {
  text: ["text", ...EDITABLE_MEDIA],
  ...Object.fromEntries(EDITABLE_MEDIA.map((kind) => [kind, EDITABLE_MEDIA])),
};

/**
 * What this block sends, as the runtime resolves it.
 *
 * `nodeContentKind`, and nothing of its own. It was a hand-written list here
 * for a while, and the comment justifying it said that `nodeContentKind`
 * "stops at `menu`" while `sender.TYPE_CONTENT_KINDS` also pins `subscription`,
 * `rating`, `language` and `followup` to text. That was true of the editor's
 * table and stopped being true when it was brought level with the runtime's;
 * what was left was a third copy of the same six rows, saying the same thing,
 * held together by nothing — `tests_vocabulary_contract::ContentKindContractTests`
 * reads `message-content.ts` and has never known this file existed. A sixth
 * forced type would have been added to two tables and silently missed by this
 * one, and the symptom is a transition the editor offers that the runtime
 * refuses on the first tap.
 *
 * The name stays because the *question* is this module's: what a transition may
 * be attempted from is what actually went out, not what content panel the
 * author was looking at.
 */
export function transitionContentKind(node: FlowNode): MessageContentKind {
  return nodeContentKind(node);
}

/** Whether Telegram will let a message of one kind become the other. */
export function canEdit(previousKind: MessageContentKind, nextKind: MessageContentKind): boolean {
  return (EDITABLE_FROM[previousKind] ?? []).includes(nextKind);
}

/**
 * Whether this block's keyboard could ride on an edited message.
 *
 * Every `editMessage…` method types `reply_markup` as `InlineKeyboardMarkup`.
 * A reply keyboard is chat furniture — the only way to put one up is to send
 * something — so a block that wants one can never arrive as an edit.
 */
export function acceptsInlineKeyboard(node: FlowNode): boolean {
  return effectiveButtonMode(node) !== "reply";
}

/** Block types that build their own inline keyboard whether or not the author drew buttons. */
const SELF_KEYBOARDED = ["subscription", "rating", "language", "invoice"];

/**
 * Whether this block leaves an inline keyboard on screen — the thing
 * "clearButtons" exists to take away.
 *
 * A prediction, where the runtime has the fact. It errs towards yes on purpose:
 * offering the transition when there was nothing to clear costs a skipped
 * no-op, while withholding it costs the author an option they were entitled to.
 */
export function leavesInlineKeyboard(node: FlowNode): boolean {
  if (!acceptsInlineKeyboard(node)) return false;
  return nodeButtons(node).length > 0 || node.back !== undefined || SELF_KEYBOARDED.includes(node.type);
}

/** Every transition, in the order a reader meets them: least of the old message surviving first. */
export const TRANSITION_LADDER: readonly EdgeTransition[] = ["edit", "delete", "clearButtons", "keep"];

export const TRANSITION_LABELS: Record<EdgeTransition, string> = {
  keep: "Qoldirish",
  clearButtons: "Tugmasiz qoldirish",
  edit: "Tahrirlash",
  delete: "O'chirish",
};

export const TRANSITION_HINTS: Record<EdgeTransition, string> = {
  keep: "Avvalgi xabar o'z holicha qoladi, yangisi ostiga yuboriladi.",
  clearButtons: "Avvalgi xabar qoladi, lekin tugmalari olib tashlanadi — eski menyu bosilmaydi.",
  edit: "Avvalgi xabarning o'rniga yoziladi. Suhbat o'smaydi va ekran sakramaydi.",
  delete: "Avvalgi xabar suhbatdan olib tashlanadi. Tahrirlab bo'lmaydigan xabarlar uchun.",
};

/** Longest a delete may be held back for. Mirrors `transitions.MAX_DELETE_DELAY`. */
export const MAX_DELETE_DELAY = 3600;

/**
 * Why a transition is not on offer between these two blocks, or null when it is.
 *
 * The reason and not just the fact: an author who sees «Tahrirlash» greyed out
 * with nothing said about it will change the graph at random until it comes
 * back. Telling them it is the reply keyboard turns a mystery into a decision.
 */
export function unavailableReason(
  transition: EdgeTransition,
  previous: FlowNode | null,
  next: FlowNode,
): string | null {
  if (transition === "keep") return null;
  if (!previous) return "Bu blokka keladigan avvalgi xabar yo'q.";

  // Deleting asks nothing of either block. Its one condition — that the message
  // went out less than 48 hours ago — is a fact about the clock, which the
  // editor cannot know and the runtime checks when it matters.
  if (transition === "delete") return null;

  if (transition === "clearButtons") {
    return leavesInlineKeyboard(previous) ? null : "Avvalgi blokda olib tashlanadigan inline tugma yo'q.";
  }

  const previousKind = transitionContentKind(previous);
  const nextKind = transitionContentKind(next);
  if (!canEdit(previousKind, nextKind)) {
    if (previousKind !== "text" && nextKind === "text") {
      return "Rasm yoki fayl xabarini matnga qaytarib bo'lmaydi — Telegram bunga ruxsat bermaydi.";
    }
    return "Bu ikki blokning turlari tahrir orqali almashmaydi.";
  }
  if (!acceptsInlineKeyboard(next)) {
    return "Keyingi blok reply klaviatura bilan chiqadi, tahrirlangan xabarga esa faqat inline qo'yiladi.";
  }
  return null;
}

/** The transitions that would actually work between these two blocks, best first. */
export function availableTransitions(previous: FlowNode | null, next: FlowNode): EdgeTransition[] {
  return TRANSITION_LADDER.filter((transition) => unavailableReason(transition, previous, next) === null);
}

/**
 * What an unconfigured connection into this block means.
 *
 * **A screen replaces a screen; a screen does not eat a statement.**
 *
 * A Menyu block is a screen — the thing a reader navigates rather than a thing
 * the bot said — so it takes the place of the screen before it. But only of a
 * screen: what makes a message one is that it carried an inline keyboard.
 *
 * The narrowing was learned on a live bot. Its flow opened with a greeting and
 * put a menu under it, and "every edge into a Menyu replaces what is there"
 * deleted the greeting before anyone could read it. A menu after a plain
 * message is a menu *under* a message; a menu after a menu is the next page of
 * the same one. Mirrors `transitions.default_for`.
 */
export function defaultTransition(_node: FlowNode, _previous: FlowNode | null): EdgeTransition {
  // «Menyu» was the one block that defaulted to "edit" (a menu after a menu is
  // the next page of the same one); it is gone, so every edge keeps by default.
  return "keep";
}

/**
 * The transition this edge will attempt: the line's own setting, then the
 * target block's default for everything wired into it, then [[defaultTransition]].
 */
export function resolveTransition(
  edge: Pick<FlowEdge, "transition"> | null,
  node: FlowNode,
  previous: FlowNode | null,
): EdgeTransition {
  return edge?.transition ?? node.incomingTransition ?? defaultTransition(node, previous);
}

/* -------------------------------------------------------------------------- */
/* How a transition looks                                                      */
/* -------------------------------------------------------------------------- */

/**
 * One violet for "this line does something to the message above it", and the
 * dash pattern to say which thing.
 *
 * Two levels rather than three hues, because the canvas already spends colour
 * on something else: an edge's stroke says which *exit* it left by — a Shart's
 * green «Ha» and amber «Yo'q», a button's accent, a plain grey out. Giving each
 * transition its own hue would have put a third and fourth colour into that same
 * channel and left an author guessing which question a given colour answers.
 *
 * So `keep` is drawn exactly as edges have always been drawn — it is the case
 * where nothing happens, and it is most of them — while the two that do
 * something share a hue the existing four do not use, and are told apart by
 * their stroke. `yes` and `no` keep their identity regardless: those two are the
 * only edges whose chip is always on screen, so their text says what their
 * colour used to.
 *
 * Read by both the canvas and the connection panel, so the two cannot drift.
 */
export const TRANSITION_STROKE = "#8a7ac4";
export const TRANSITION_GLOW = "rgba(138,122,196,.18)";

/** `strokeDasharray` per transition — `null` leaves the line solid. */
export const TRANSITION_DASH: Record<EdgeTransition, string | null> = {
  // Nothing to say: the connection behaves the way every connection did before
  // there was a setting on it.
  keep: null,
  // Dotted, the lightest mark: the message stays, only its keyboard goes.
  clearButtons: "2 4",
  // Dashed: the message on screen is replaced where it stands.
  edit: "7 4",
  // Dash-dot, the broken one — the old message does not survive at all.
  delete: "9 3 2 3",
};

/** Whether this transition changes how the edge is painted at all. */
export function isMarkedTransition(transition: EdgeTransition): boolean {
  return transition !== "keep";
}
