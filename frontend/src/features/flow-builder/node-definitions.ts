/**
 * What each block *is*: geometry, ports, colours, labels and per-type field
 * summaries — one `NodeTypeDefinition` per `NodeType`, and the helpers that
 * measure them.
 *
 * Data lives here; behaviour (palette order, node factories, retitling) lives
 * in `node-registry.ts`, which is also the only module that should import the
 * raw table. Adding a block type means adding one entry to this table and
 * nothing else.
 */

import type { IconName } from "@/components/ui/Icon";
import type { BotLanguage } from "@/features/bots/types";
import type { FlowButton, FlowEdge, FlowNode, ModuleKey, NodeType } from "@/features/flows";
import { DEFAULT_LANGUAGE, resolveText } from "@/features/flows/localized-text";
import { buttonIdFromPort, buttonPortId, isRoutableButton, effectiveButtonMode, nodeButtons } from "./lib/buttons";
import { createAiConfig } from "./lib/ai";
import {
  RATING_VARIABLE,
  SUBSCRIPTION_CHECK_LABEL,
  SUBSCRIPTION_RETRY_TEXT,
  createLanguageOptions,
  getContentDefinition,
  nodeContentKind,
} from "./lib/message-content";
import { stripMarkdown } from "./lib/markdown";
import { createBusinessTrigger, DEFAULT_DMS_KINDS } from "./lib/trigger";

/**
 * The fixed width of an ordinary card: `titleRowChrome` plus 128px, which is
 * what the longest title the studio ships needs — "Yangi a'zo qo'shildi",
 * measured at 126.1px in the row's own 13.5px semibold. Sized from the longest
 * rather than the average on purpose: these are the names a block is *born*
 * with, so a width that cuts one ships a flow whose blocks are unreadable
 * before their author has typed anything. A name someone types longer than
 * that truncates, with the whole of it in the card's tooltip.
 */
export const NODE_WIDTH = 252;

/**
 * Bounds for a block that sizes itself to its content (`fitContent`). The
 * ceiling is what a named Handler is allowed to grow to before its title
 * truncates instead; the floor is a guard under the estimate rather than a
 * design width — the chrome alone is wider than it, so it no longer binds.
 */
export const MIN_NODE_WIDTH = 148;
export const MAX_NODE_WIDTH = 264;

/**
 * The title row, measured. Exported because FlowNodeCard *draws* with these
 * same numbers: a card is given a width rather than left to `fit-content`, so
 * the row the DOM lays out and the row measured here have to be one row — and
 * the only way to keep them one is for both to read a single copy.
 *
 * They did drift, and nothing in the tree could see it. The card's icon grew
 * from a 13px glyph to a 34px chip, its gaps from 7 to 9, its title from
 * 11.5px to 13.5px semibold, and the sentence under the title went away —
 * while the estimate here stayed on the old numbers and went on budgeting two
 * clipped lines for that sentence. A Handler then measured 148px against a row
 * needing ~159 before its name even starts. The name is the only `flex-1` in
 * that row, so it absorbed the entire shortfall, and `truncate` at zero width
 * draws nothing at all: the block sat on the canvas as an icon and two buttons,
 * unnamed, while typecheck and lint stayed green.
 */
export const CARD_PAD_X = 16;
export const CARD_ICON = 34;
export const CARD_GAP = 9;
/** The play and pen buttons — an 11px and a 12px glyph, each with `p-0.5` around it. */
const CONTROLS_W = 15 + 16;
/** `#12` at 9px tabular-nums plus its own padding. Only a Handler carries one. */
const PRIORITY_BADGE_W = 26;
/**
 * Advance of one title character at 13.5px semibold — an *upper* bound, and
 * measured rather than guessed: rendered in the row's own font, the titles
 * this studio ships run from 5.9px per character ("Kalit so'zlar") to 8.7px
 * ("Menyu"), because a short name made of wide capitals is the extreme an
 * average is furthest from. 8 is the smallest value at which no shipped
 * Handler title truncates.
 *
 * The bound is deliberately on the high side, because the two directions cost
 * differently. Over-estimating widens a Handler by a few pixels and stops at
 * MAX_NODE_WIDTH. Under-estimating comes off the name — it is the only
 * flexible thing in the row — and a name short of room is not a shorter name
 * but no name at all, since `truncate` at zero width draws nothing.
 */
const TITLE_CHAR_W = 8;

/**
 * Margin on top of that estimate. "Media" lands within half a pixel of its own
 * width without it, which is not a fit so much as a coincidence — and the
 * coincidence would break on the first machine whose first font is not SF Pro.
 */
const TITLE_SLACK = 4;

/**
 * Everything on the title row except the title: the icon chip, the two hover
 * controls, a Handler's priority badge, the padding either side and the gaps
 * between them all. What is left over is what the name has to fit in.
 */
function titleRowChrome(hasPriority: boolean): number {
  const gaps = hasPriority ? 4 : 3;
  return CARD_PAD_X * 2 + CARD_ICON + CONTROLS_W + gaps * CARD_GAP + (hasPriority ? PRIORITY_BADGE_W : 0);
}

/**
 * One stacked keyboard row on a card. The card lists the block's buttons at
 * its bottom edge, one per row, and each routable row publishes a port at its
 * own centre — so the geometry here and the markup in FlowNodeCard have to
 * stay in step (they are the only two places that know these numbers).
 */
export const BUTTON_ROW_HEIGHT = 20;
/** Gap between the block's text and the first row. */
export const BUTTON_ROWS_TOP_PAD = 6;
/** Room under the last row, enough to stay clear of the card's rounded corner. */
export const BUTTON_ROWS_BOTTOM_PAD = 12;

/**
 * Height of the icon/title row FlowNodeCard draws above the body. The third
 * number this file shares with that markup, and the same warning applies:
 * change one and the other has to follow.
 *
 * It exists because the exits moved to the right edge, where a branching
 * block's pair is spread out vertically. On a card short enough the upper of
 * the two would ride level with the title row and its "Ha" caption would land
 * under the pen and play controls that live there, so the pair is held below
 * this line.
 */
export const CARD_HEADER_HEIGHT = 29;

export type NodePortKind = "out" | "yes" | "no" | "button" | "back" | "escalate";

export interface NodePort {
  id: string;
  label: string;
  /**
   * Distance down the card's right edge from its top-left corner. Every exit
   * leaves that one edge — the flow reads left to right, so an exit anywhere
   * else would have to double back across the card it belongs to. There is no
   * side to choose any more, which is why the field that used to name one is
   * gone: it could only ever hold "right".
   */
  offset: number;
  kind: NodePortKind;
  /**
   * Which edge it leaves. Absent means the right one, which is every exit
   * there is bar one: the "Orqaga" row publishes on the left, because a flow
   * read left to right should not draw its way *back* as a forward arrow.
   */
  side?: "left" | "right";
}

export interface NodeTypeDefinition {
  type: NodeType;
  kindLabel: string;
  paletteLabel: string;
  icon: IconName;
  color: string;
  height: number;
  /** Label of the free-text body field; `null` for blocks that have no body to edit. */
  bodyFieldLabel: string | null;
  /**
   * One sentence the Inspector prints above the fields. For the block that has
   * no fields worth the name: a panel opening on nothing but a closed drawer
   * reads as a block that failed to load, and the one thing worth saying about
   * such a block is the thing its card cannot — what happens to the customer
   * after it.
   */
  hint?: string;
  defaultTitle: string;
  defaultText: string;
  hasButtons: boolean;
  /**
   * Whether this block puts a message on screen, so a connection *into* it can
   * replace, strip or keep whatever is already there — see `lib/transitions`
   * and `backend/apps/engine/transitions.py`. Unset means no: a Shart, a Teg or
   * a Kutish sends nothing, so "what happens to the message above" has no
   * answer for them.
   */
  hasIncomingTransition?: boolean;
  /** Attachment-only picker (photo/video/…), kept for blocks that always send text too. */
  hasMedia: boolean;
  /** Full Telegram content-kind picker — text, media, location, contact, poll, invoice, album. */
  hasContent: boolean;
  /** Carries the «Qanday javob?» picker — what kind of answer is expected. */
  hasAnswerType: boolean;
  /** Carries «Javobni nima deb saqlaymiz?» — the variable the answer lands in. */
  hasSaveAnswer?: boolean;
  /**
   * Offers the «Orqaga» row without offering a keyboard.
   *
   * Only «Savol» needs this. Every other block that can carry the row also
   * carries buttons, so the control rides along inside `ButtonsField` — and a
   * question deliberately has no keyboard, which left the row declared in the
   * backend's vocabulary (`back_port=True`) and settable from nowhere in the
   * editor. A way out of a question is not an optional nicety: without one, a
   * customer who cannot answer is a customer who cannot leave.
   */
  hasBackRowOnly?: boolean;
  /** What `saveAnswerAs` starts as on a freshly added block. */
  defaultSaveAnswerAs?: string;
  hasDelay: boolean;
  hasFlowLink: boolean;
  hasTriggerConfig: boolean;
  hasCondition: boolean;
  hasTagAction: boolean;
  /** Appends a row to a table — the «Jadvalga yozish» block picks one and fills it. */
  hasTableWrite?: boolean;
  /** Looks one row up and branches on whether it was there («Ma'lumot o'qish»). */
  hasTableRead?: boolean;
  /** Carries model/temperature/knowledge/fallback settings (the AI block). */
  hasAiConfig?: boolean;
  /** Carries the languages a "Til" block offers. */
  hasLanguage?: boolean;
  /** Starting value of `minutes` for a `hasDelay` block; 30 when unset. */
  defaultMinutes?: number;
  /**
   * What the minutes field is called here, and what it promises. Two blocks
   * ask for a number of minutes and mean opposite things by it — Kutish holds
   * the run still, the eslatma lets it walk on — so the wording belongs to the
   * block rather than to the field.
   */
  delayLabel?: string;
  delayHint?: string;
  /** Body text is delivered to Telegram with a `parse_mode`, so it gets the formatting strip. */
  supportsMarkdown: boolean;
  /** Card hugs its content between MIN/MAX_NODE_WIDTH instead of taking the fixed NODE_WIDTH. */
  fitContent?: boolean;
  /**
   * The flow owns this block, not the author: it arrives with the flow and
   * cannot be added, copied or deleted. The two entry blocks are the ones —
   * a flow needs exactly one entry point, and a second or a missing one is not
   * a state the editor should be able to reach. What stays editable on a fixed
   * block is its *condition*, where it has one: `/start` answers what its name
   * says, while a Handler is the flow's own question of "what fires this".
   */
  fixed?: boolean;
  /**
   * `main` is the bot's own language: a port label is drawn on the canvas, where
   * nobody has chosen a language to read in, so a translated button is named by
   * the string the bot would send by default rather than by whichever half of
   * the map happens to be first.
   */
  ports: (node: FlowNode, widthPx: number, heightPx: number, main: BotLanguage) => NodePort[];
}

/** Whether this block ends with an "Orqaga" row — see [[FlowNode.back]]. */
export function hasBackRow(node: FlowNode): boolean {
  return node.back !== undefined;
}

/**
 * Height the stacked keyboard rows take up at the bottom of a card, 0 when
 * there are none. The "Orqaga" row counts as one of them: it is drawn in the
 * same stack, so the body above has to give up the same height for it — that
 * is what keeps it from sitting on top of the block's own text.
 */
export function buttonRowsHeight(node: FlowNode): number {
  const rows = nodeButtons(node).length + (hasBackRow(node) ? 1 : 0);
  return rows ? rows * BUTTON_ROW_HEIGHT + BUTTON_ROWS_TOP_PAD + BUTTON_ROWS_BOTTOM_PAD : 0;
}

/**
 * Middle of the block's own part of the card — everything above the keyboard
 * rows. Every anchor that is not tied to a button row is measured from here:
 * the block's own exit, its branch pair and the input dot on the left edge.
 *
 * The middle specifically, and not some other point in the body, because of
 * what the card is shaped like. Its corners are rounded to half its height
 * (capped at MAX_RADIUS), which on the shorter blocks leaves the right edge
 * curving almost the whole way down; a dot anchored anywhere else ends up
 * floating off the border it is supposed to straddle. The middle is the one
 * height where a rounded card and a square one agree.
 *
 * The keyboard rows are excluded rather than averaged in: a menu with six
 * buttons is mostly keyboard, and its "continue" exit would otherwise sit
 * among the button dots it has nothing to do with.
 */
function bodyMiddle(node: FlowNode, height: number): number {
  return (height - buttonRowsHeight(node)) / 2;
}

/**
 * How far apart a block's two branch exits sit on the right edge. Wide enough
 * that neither 10px dot touches the other and each still has a line of its own
 * for the "Ha"/"Yo'q" label the card prints beside it — and no wider, so the
 * pair stays within the straight stretch of a card's rounded edge.
 */
const BRANCH_PORT_SPREAD = 24;

/**
 * The two exits of a branching block, straddling the middle — the taken branch
 * above, the untaken one below, which is the order the pair is read in and so
 * the order the two blocks they open are expected to sit in.
 *
 * The pair is pushed down where the card is too short to hold it: below about
 * 82px of block the upper exit reaches the title row, and a "Ha" printed there
 * lands under the card's own edit controls. None of the three branching blocks
 * is that short today — the clamp is here so the next one does not have to be
 * discovered on screen.
 */
function branchPorts(
  node: FlowNode,
  height: number,
  yes: { id: string; label: string },
  no: { id: string; label: string },
): NodePort[] {
  const middle = Math.max(bodyMiddle(node, height), CARD_HEADER_HEIGHT + BRANCH_PORT_SPREAD / 2);
  return [
    { ...yes, offset: middle - BRANCH_PORT_SPREAD / 2, kind: "yes" },
    { ...no, offset: middle + BRANCH_PORT_SPREAD / 2, kind: "no" },
  ];
}

function singleOutPort(node: FlowNode, _width: number, height: number): NodePort[] {
  return [{ id: "out", label: "", offset: bodyMiddle(node, height), kind: "out" }];
}

/**
 * No exits at all — the block *is* where the conversation stops, so there is
 * nothing to leave it through.
 *
 * An "out" dot wired to nothing was the tempting alternative and it is the
 * wrong one: every other unwired exit on the canvas means "not finished yet",
 * and a block whose whole job is to say "finished" must not be drawn as the
 * thing it is denying. The card needs no case of its own for this — it maps
 * over the list, and the input dot is not a port.
 */
function noPorts(): NodePort[] {
  return [];
}

/**
 * One exit per routable button, on the right edge, level with the row that
 * names it. Non-routable buttons (url, web_app…) still take a row — the card
 * mirrors the real keyboard — they just publish no port.
 *
 * These were the only side-mounted ports before the canvas turned horizontal,
 * and they are why it now reads as one scheme rather than two: a keyboard's
 * branches and the block's own exit leave the same edge, the buttons keeping
 * their rows and the block keeping the body above them.
 *
 * The card stacks one button per row whatever the keyboard's own layout is:
 * `sameRow` shapes what Telegram draws (see [[toButtonRows]]), while the card
 * stays a legible column of exits.
 */
/** The default wording of the "Orqaga" row, when the author has not renamed it. */
export const BACK_ROW_LABEL = "⬅️ Orqaga";

/**
 * The block's own way back, as a port on the *left* edge, level with the row
 * the card draws for it — last in the stack, under the author's keys.
 *
 * Left, and alone in being so: everything else leaves the right edge because
 * the canvas reads left to right, which is exactly the argument for this one
 * going the other way. An exit meaning "back" drawn as a forward arrow is a
 * picture of the opposite of what it does.
 */
/**
 * Whether the block's own «Orqaga» row actually reaches Telegram.
 *
 * `sendMediaGroup` takes no `reply_markup` at all, so a block sent as an album
 * carries the row in its data and shows nobody a way to press it. The card
 * strikes it through and the validator warns rather than either side deleting
 * it: the author picked a content kind, not a keyboard, and switching back
 * brings the row and its branch with it.
 */
export function backRowReachesTelegram(node: FlowNode): boolean {
  return getContentDefinition(nodeContentKind(node)).supportsButtons;
}

/** The back row's port, wherever it sits in the stack — published or not. */
function backPortFor(node: FlowNode, height: number, main: BotLanguage): NodePort {
  const rowsTop = height - buttonRowsHeight(node) + BUTTON_ROWS_TOP_PAD;
  const index = nodeButtons(node).length;
  return {
    id: "back",
    label: resolveText(node.back ?? "", main, main) || BACK_ROW_LABEL,
    offset: rowsTop + index * BUTTON_ROW_HEIGHT + BUTTON_ROW_HEIGHT / 2,
    kind: "back" as const,
    side: "left" as const,
  };
}

function backPort(node: FlowNode, height: number, main: BotLanguage): NodePort[] {
  if (!hasBackRow(node) || !backRowReachesTelegram(node)) return [];
  return [backPortFor(node, height, main)];
}

/**
 * The back port a block carries but does not publish, so an edge saved while it
 * was an exit can still be anchored to its own row instead of being dragged
 * onto a dot that means something else. `undefined` whenever the row is either
 * absent or genuinely sendable — the published list covers that case.
 */
export function suppressedBackPort(node: FlowNode): NodePort | undefined {
  if (!hasBackRow(node) || backRowReachesTelegram(node)) return undefined;
  return backPortFor(node, nodeHeight(node), DEFAULT_LANGUAGE);
}

/**
 * Row exits the block still *stores* while publishing none of them.
 *
 * Read off `node.buttons` rather than `nodeButtons`, which already hides an
 * album's keyboard — that is the whole point here. Choosing «Albom» in the
 * content panel used to prune every branch the author had wired, with one undo
 * step covering both the choice and the loss; the rows come back untouched when
 * the kind changes again.
 */
export function carriedRowPorts(node: FlowNode): string[] {
  if (backRowReachesTelegram(node)) return [];
  const mode = effectiveButtonMode(node);
  return [
    ...(node.buttons ?? []).filter((button) => isRoutableButton(button, mode)).map((button) => buttonPortId(button.id)),
    ...(hasBackRow(node) ? ["back"] : []),
  ];
}

function buttonPorts(node: FlowNode, height: number, main: BotLanguage): NodePort[] {
  const mode = effectiveButtonMode(node);
  const rowsTop = height - buttonRowsHeight(node) + BUTTON_ROWS_TOP_PAD;

  return nodeButtons(node).flatMap((button, index) =>
    isRoutableButton(button, mode)
      ? [
          {
            id: buttonPortId(button.id),
            label: resolveText(button.label, main, main),
            offset: rowsTop + index * BUTTON_ROW_HEIGHT + BUTTON_ROW_HEIGHT / 2,
            kind: "button" as const,
          },
        ]
      : [],
  );
}


function keyboardPorts(node: FlowNode, width: number, height: number, main: BotLanguage): NodePort[] {
  return [
    ...singleOutPort(node, width, height),
    ...buttonPorts(node, height, main),
    ...backPort(node, height, main),
  ];
}

/**
 * Every block type the canvas can render, in one place. Canvas, palette and
 * inspector all read from this map instead of branching on `node.type`
 * (Open/Closed) — a new block type is a new entry here, nothing else
 * changes.
 */
export const NODE_TYPE_DEFINITIONS: Record<NodeType, NodeTypeDefinition> = {
  /*
   * `/start` is not a Handler with its command filled in — it is its own block
   * type, because everything about it is settled: the `dms` module's main flow
   * opens with it, it answers that one command, and there is nothing on it to
   * configure. A Handler holding "/start" would invite exactly the two edits
   * that must not happen — deleting it, or typing another command over it.
   */
  start: {
    type: "start",
    kindLabel: "start",
    paletteLabel: "start",
    icon: "play",
    color: "#4FC98E",
    height: 66,
    bodyFieldLabel: null,
    defaultTitle: "start",
    // No caption under the title: the block's identity is its name, and a
    // sentence restating "when the user starts the bot" only crowds the card.
    defaultText: "",
    hasButtons: false,
    hasMedia: false,
    hasContent: false,
    hasAnswerType: false,
    hasDelay: false,
    hasFlowLink: false,
    // No trigger editor: the condition is the block's identity, not a setting.
    hasTriggerConfig: false,
    hasCondition: false,
    supportsMarkdown: false,
    hasTagAction: false,
    fixed: true,
    ports: singleOutPort,
  },
  trigger: {
    type: "trigger",
    kindLabel: "Boshlanish sharti",
    paletteLabel: "Boshlanish sharti",
    icon: "lightning",
    color: "#E9B663",
    height: 66,
    bodyFieldLabel: null,
    // The block is called «Boshlanish sharti» in the palette, on the canvas and
    // in the warnings panel. It was born named "Handler" — an English word the
    // product does not translate anywhere and one nobody outside the code uses
    // — so the same block answered to two names before its author had touched
    // it. `autoTitleFor` renames it after its family the moment one is chosen;
    // this is only what it is called in the moment before that.
    defaultTitle: "Boshlanish sharti",
    defaultText: "Shartni tanlang",
    hasButtons: false,
    hasMedia: false,
    hasContent: false,
    hasAnswerType: false,
    hasDelay: false,
    hasFlowLink: false,
    hasTriggerConfig: true,
    hasCondition: false,
    supportsMarkdown: false,
    hasTagAction: false,
    // A Handler carries no body text — it is as wide as its trigger sentence needs.
    fitContent: true,
    /*
     * The flow's entry point, exactly like `/start` is for the main flow: one
     * per flow, put there by the flow itself and not the author's to add,
     * copy or delete. What it answers is still theirs — a flow that fires on
     * nothing is the one state this block cannot be in.
     */
    fixed: true,
    ports: singleOutPort,
  },
  groupjoin: {
    type: "groupjoin",
    kindLabel: "Yangi a'zo",
    paletteLabel: "Yangi a'zo",
    icon: "user-plus",
    color: "#5FCBA8",
    height: 66,
    bodyFieldLabel: "Izoh",
    defaultTitle: "Yangi a'zo qo'shildi",
    defaultText: "Guruhga yangi a'zo qo'shilganda (message.new_chat_members)",
    hasButtons: false,
    hasMedia: false,
    hasContent: false,
    hasAnswerType: false,
    hasDelay: false,
    hasFlowLink: false,
    hasTriggerConfig: false,
    hasCondition: false,
    supportsMarkdown: false,
    hasTagAction: false,
    ports: singleOutPort,
  },
  groupleave: {
    type: "groupleave",
    kindLabel: "A'zo chiqdi",
    paletteLabel: "A'zo chiqdi",
    icon: "arrow-left",
    color: "#E89C7D",
    height: 66,
    bodyFieldLabel: "Izoh",
    defaultTitle: "A'zo chiqib ketdi",
    defaultText: "Guruhdan a'zo chiqqanda yoki chiqarilganda (message.left_chat_member)",
    hasButtons: false,
    hasMedia: false,
    hasContent: false,
    hasAnswerType: false,
    hasDelay: false,
    hasFlowLink: false,
    hasTriggerConfig: false,
    hasCondition: false,
    supportsMarkdown: false,
    hasTagAction: false,
    ports: singleOutPort,
  },
  joinrequest: {
    type: "joinrequest",
    kindLabel: "Qo'shilish so'rovi",
    paletteLabel: "Qo'shilish so'rovi",
    icon: "identification-badge",
    color: "#A79BEC",
    height: 66,
    bodyFieldLabel: "Izoh",
    defaultTitle: "Qo'shilish so'rovi",
    defaultText: "Tasdiqlash talab qiladigan guruh/kanalga so'rov kelganda (chat_join_request)",
    hasButtons: false,
    hasMedia: false,
    hasContent: false,
    hasAnswerType: false,
    hasDelay: false,
    hasFlowLink: false,
    hasTriggerConfig: false,
    hasCondition: false,
    supportsMarkdown: false,
    hasTagAction: false,
    ports: singleOutPort,
  },
  channelpost: {
    type: "channelpost",
    kindLabel: "Yangi post",
    paletteLabel: "Yangi post",
    icon: "megaphone",
    color: "#EAAE74",
    height: 66,
    bodyFieldLabel: "Izoh",
    defaultTitle: "Yangi post",
    defaultText: "Kanalga yangi post joylanganda (channel_post)",
    hasButtons: false,
    hasMedia: false,
    hasContent: false,
    hasAnswerType: false,
    hasDelay: false,
    hasFlowLink: false,
    hasTriggerConfig: false,
    hasCondition: false,
    supportsMarkdown: false,
    hasTagAction: false,
    ports: singleOutPort,
  },
  message: {
    hasIncomingTransition: true,
    type: "message",
    kindLabel: "Xabar",
    paletteLabel: "Xabar",
    icon: "chat-teardrop-text",
    color: "#5AB4F0",
    height: 66,
    bodyFieldLabel: "Matn",
    defaultTitle: "Xabar",
    defaultText: "Matnni shu yerga yozing.",
    hasButtons: true,
    // The message block owns the full content picker instead of a bare attachment.
    hasMedia: false,
    hasContent: true,
    hasAnswerType: false,
    hasDelay: false,
    hasFlowLink: false,
    hasTriggerConfig: false,
    hasCondition: false,
    supportsMarkdown: true,
    hasTagAction: false,
    ports: keyboardPorts,
  },
  /**
   * Ask, wait, keep — one block, because they are one thought.
   *
   * Split across «Xabar» + «Ma'lumotni saqlash» they were not one: the message
   * went out, the run walked straight on, and the save block read
   * `{{message.text}}` — which still held whatever the customer had said
   * *before* the question. The value stored was the previous answer, every
   * time, and the only way to find out was to read the contact record.
   *
   * `hasButtons` is deliberately false. A question with a keyboard is a
   * «Xabar» with buttons: the branches are the answer, and there is nothing to
   * type or to keep. «Orqaga» stays, because leaving a question unanswered is
   * a thing a customer must always be able to do.
   */
  question: {
    hasIncomingTransition: true,
    type: "question",
    kindLabel: "Savol",
    paletteLabel: "Savol berish",
    icon: "question",
    color: "#7BD88F",
    height: 66,
    bodyFieldLabel: "Savol matni",
    defaultTitle: "Savol",
    defaultText: "Ismingizni yozing:",
    hasButtons: false,
    hasMedia: false,
    hasContent: false,
    hasAnswerType: true,
    hasSaveAnswer: true,
    hasBackRowOnly: true,
    hasDelay: false,
    hasFlowLink: false,
    hasTriggerConfig: false,
    hasCondition: false,
    supportsMarkdown: true,
    hasTagAction: false,
    defaultSaveAnswerAs: "mijoz_ismi",
    ports: singleOutPort,
  },
  followup: {
    hasIncomingTransition: true,
    type: "followup",
    kindLabel: "Eslatma",
    paletteLabel: "Kechiktirilgan eslatma",
    icon: "bell-ringing",
    color: "#EB97C0",
    height: 66,
    bodyFieldLabel: "Eslatma matni",
    defaultTitle: "Eslatma",
    defaultText: "Hali javob kutyapmiz 🙂 Savolingiz bo'lsa yozing.",
    hasButtons: false,
    hasMedia: false,
    hasContent: false,
    hasAnswerType: false,
    // Same minutes field as Kutish, a wholly different meaning: this one is
    // how long the customer has to answer, not how long the flow stands still.
    hasDelay: true,
    defaultMinutes: 60,
    delayLabel: "Javobsiz qolsa (daqiqa)",
    delayHint:
      "Oqim shu blokda to'xtamaydi — darhol davom etadi. Eslatma shu vaqt ichida mijozdan hech narsa kelmasa yuboriladi.",
    hasFlowLink: false,
    hasTriggerConfig: false,
    hasCondition: false,
    supportsMarkdown: true,
    hasTagAction: false,
    ports: singleOutPort,
  },
  language: {
    hasIncomingTransition: true,
    type: "language",
    kindLabel: "Til",
    paletteLabel: "Til tanlash",
    icon: "globe-hemisphere-west",
    color: "#8FA7EC",
    height: 66,
    bodyFieldLabel: "Savol",
    defaultTitle: "Til tanlash",
    defaultText: "Tilni tanlang / Выберите язык:",
    hasButtons: false,
    hasMedia: false,
    hasContent: false,
    hasAnswerType: false,
    hasDelay: false,
    hasFlowLink: false,
    hasTriggerConfig: false,
    hasCondition: false,
    supportsMarkdown: false,
    hasTagAction: false,
    hasLanguage: true,
    // One exit: every language continues the same way. What changes is the
    // `mijoz_tili` the rest of the flow reads, not the branch it takes.
    ports: singleOutPort,
  },
  condition: {
    type: "condition",
    kindLabel: "Shart",
    paletteLabel: "Shart",
    icon: "git-branch",
    color: "#A9C978",
    height: 84,
    bodyFieldLabel: "Mantiqiy ifoda",
    defaultTitle: "Shart",
    defaultText: "o'zgaruvchi = qiymat",
    hasButtons: false,
    hasMedia: false,
    hasContent: false,
    hasAnswerType: false,
    hasDelay: false,
    hasFlowLink: false,
    hasTriggerConfig: false,
    hasCondition: true,
    supportsMarkdown: false,
    hasTagAction: false,
    // Both exits leave the right edge, "Ha" on top — the order the two words
    // are read in, so the branch beside each one is where it is expected.
    ports: (node, _width, height) =>
      branchPorts(node, height, { id: "yes", label: "Ha" }, { id: "no", label: "Yo'q" }),
  },
  delay: {
    type: "delay",
    kindLabel: "Kutish",
    paletteLabel: "Kutish",
    icon: "clock",
    color: "#94A6BE",
    height: 66,
    bodyFieldLabel: "Matn",
    defaultTitle: "Kutish",
    defaultText: "Keyingi blokgacha pauza",
    hasButtons: false,
    hasMedia: false,
    hasContent: false,
    hasAnswerType: false,
    hasDelay: true,
    hasFlowLink: false,
    hasTriggerConfig: false,
    hasCondition: false,
    supportsMarkdown: false,
    hasTagAction: false,
    ports: singleOutPort,
  },
  tag: {
    type: "tag",
    kindLabel: "Ma'lumotni saqlash",
    paletteLabel: "Ma'lumotni saqlash",
    icon: "tag",
    color: "#7BCB92",
    height: 66,
    bodyFieldLabel: "Matn",
    defaultTitle: "Teg qo'yish",
    defaultText: "tag = yangi",
    hasButtons: false,
    hasMedia: false,
    hasContent: false,
    hasAnswerType: false,
    hasDelay: false,
    hasFlowLink: false,
    hasTriggerConfig: false,
    hasCondition: false,
    supportsMarkdown: false,
    hasTagAction: true,
    ports: singleOutPort,
  },
  tablerow: {
    type: "tablerow",
    kindLabel: "Ma'lumot yozish",
    paletteLabel: "Ma'lumot yozish",
    icon: "table",
    // Violet, and deliberately not the green «Ma'lumotni saqlash» wears: the
    // two are neighbours in the palette and a reader scanning a canvas for
    // "where does this flow record things" must not have to read both labels.
    color: "#9C8CE0",
    // The same 66 the other blocks that send nothing take. It writes a row and
    // walks on, so its card carries a name and a line of settings summary.
    height: 66,
    bodyFieldLabel: "Izoh",
    defaultTitle: "Ma'lumot yozish",
    defaultText: "Javoblarni ma'lumotga yozadi",
    hasButtons: false,
    hasMedia: false,
    hasContent: false,
    hasAnswerType: false,
    hasDelay: false,
    hasFlowLink: false,
    hasTriggerConfig: false,
    hasCondition: false,
    supportsMarkdown: false,
    hasTagAction: false,
    hasTableWrite: true,
    ports: singleOutPort,
  },
  tableread: {
    type: "tableread",
    kindLabel: "Ma'lumot o'qish",
    paletteLabel: "Ma'lumot o'qish",
    icon: "table",
    // The same violet as its opposite number: the pair is one idea read two
    // ways, and a canvas should show that before either label is read.
    color: "#9C8CE0",
    // 84, like every other branching block. Below 82 `branchPorts` starts
    // clamping the pair down and the upper caption lands under the card's own
    // controls — see the port geometry note in the block guide.
    height: 84,
    bodyFieldLabel: "Izoh",
    defaultTitle: "Ma'lumot o'qish",
    defaultText: "Ma'lumot tanlanmagan",
    hasButtons: false,
    hasMedia: false,
    hasContent: false,
    hasAnswerType: false,
    hasDelay: false,
    hasFlowLink: false,
    hasTriggerConfig: false,
    hasCondition: false,
    supportsMarkdown: false,
    hasTagAction: false,
    hasTableRead: true,
    ports: (node, _width, height) =>
      branchPorts(node, height, { id: "yes", label: "Topildi" }, { id: "no", label: "Yo'q" }),
  },
  ai: {
    hasIncomingTransition: true,
    type: "ai",
    kindLabel: "AI",
    paletteLabel: "AI javob",
    icon: "sparkle",
    color: "#B89DEC",
    height: 66,
    bodyFieldLabel: "AI ko'rsatmasi (prompt)",
    defaultTitle: "AI javob",
    defaultText: "Mijoz savoliga qisqa javob ber.",
    hasButtons: false,
    hasMedia: false,
    hasContent: false,
    hasAnswerType: false,
    hasDelay: false,
    hasFlowLink: false,
    hasTriggerConfig: false,
    hasCondition: false,
    supportsMarkdown: false,
    hasTagAction: false,
    hasAiConfig: true,
    ports: singleOutPort,
  },
  http: {
    type: "http",
    kindLabel: "HTTP",
    paletteLabel: "HTTP so'rov",
    icon: "globe-hemisphere-west",
    color: "#5FC3D6",
    height: 66,
    bodyFieldLabel: "So'rov",
    defaultTitle: "HTTP so'rov",
    defaultText: "POST https://api.example.uz/lead",
    hasButtons: false,
    hasMedia: false,
    hasContent: false,
    hasAnswerType: false,
    hasDelay: false,
    hasFlowLink: false,
    hasTriggerConfig: false,
    hasCondition: false,
    supportsMarkdown: false,
    hasTagAction: false,
    ports: singleOutPort,
  },
  flowlink: {
    type: "flowlink",
    kindLabel: "Oqimga o'tish",
    paletteLabel: "Oqimlar",
    icon: "arrow-elbow-down-right",
    color: "#CE95DB",
    height: 66,
    bodyFieldLabel: "Matn",
    defaultTitle: "Oqimga o'tish",
    defaultText: "Boshqa oqimni tanlang",
    hasButtons: false,
    hasMedia: false,
    hasContent: false,
    hasAnswerType: false,
    hasDelay: false,
    hasFlowLink: true,
    hasTriggerConfig: false,
    hasCondition: false,
    supportsMarkdown: false,
    hasTagAction: false,
    ports: singleOutPort,
  },
  /*
   * The full stop. `/start` says where a conversation begins and this says
   * where it is over — the two are the only blocks on the canvas whose whole
   * content is a position in the flow.
   *
   * It is not a Xabar with its exit left unwired, which is how an ending was
   * drawn before it existed: an unwired exit is also what a half-built branch
   * looks like, so a reviewer reading somebody else's canvas could not tell an
   * ending from unfinished work. Nothing here changes what the bot does — the
   * runtime finishes a run either way — only what the drawing says.
   */
  end: {
    type: "end",
    kindLabel: "Tugatish",
    paletteLabel: "Suhbatni tugatish",
    icon: "check-circle",
    // The quietest tone on the canvas. Nothing runs after this block, so it has
    // the least to say to somebody scanning the graph for what happens next.
    color: "#94A2AF",
    height: 66,
    // No body field: the block sends nothing, and a text box on it would read
    // as a goodbye message that never goes out. `text` is what the card
    // explains itself with, exactly as on `/start`.
    bodyFieldLabel: null,
    // It used to promise an after-flow menu, driven by a bot setting
    // («oqim tugagach menyu»). That safety net is gone — the settings screen
    // that configured it went first and `engine/fallback.py` followed — so the
    // sentence described a menu no customer had been shown for some time. The
    // hint on the one block whose entire subject is what happens next is the
    // worst place in the product to be out of date.
    hint:
      "Suhbat shu blokda tugaydi — undan keyin hech narsa ishlamaydi. Mijoz keyin yozgan xabarga bot faqat " +
      "boshqa oqimning triggeri uni ushlasa javob beradi; ushlamasa, bot jim qoladi va xabar «Suhbatlar»ga tushadi.",
    defaultTitle: "Tugatish",
    defaultText: "Suhbat shu blokda tugaydi",
    hasButtons: false,
    hasMedia: false,
    hasContent: false,
    hasAnswerType: false,
    hasDelay: false,
    hasFlowLink: false,
    hasTriggerConfig: false,
    hasCondition: false,
    supportsMarkdown: false,
    hasTagAction: false,
    ports: noPorts,
  },
};

export function getNodeDefinition(type: NodeType): NodeTypeDefinition {
  return NODE_TYPE_DEFINITIONS[type];
}

/**
 * The block's own height plus its keyboard rows. The text area above the rows
 * keeps the type's base height whatever the keyboard does, so adding buttons
 * grows the card downward instead of squeezing its text.
 */
export function nodeHeight(node: FlowNode): number {
  return NODE_TYPE_DEFINITIONS[node.type].height + buttonRowsHeight(node);
}

/**
 * A block's exits. `main` names the labels: it is the bot's own language, and
 * it defaults to the studio's for the callers that only want port ids and
 * offsets — geometry and routing never read a label, so making them carry a
 * language would be asking every one of them about a fact they do not have.
 */
export function getNodePorts(node: FlowNode, main: BotLanguage = DEFAULT_LANGUAGE): NodePort[] {
  return NODE_TYPE_DEFINITIONS[node.type].ports(node, nodeWidth(node), nodeHeight(node), main);
}

/**
 * Whether a block continues out of an exit of its own — the `out` port every
 * ordinary block publishes and the list views wire the next step to.
 *
 * False for two different reasons, and both mean "nothing may be appended
 * here": a Shart continues out of its named branches instead, and a Tugatish
 * does not continue at all. Anything that rewires an `out` edge asks this
 * first, because an edge leaving a port the block never published is one no
 * walker follows and no anchor can be found for.
 */
export function hasOutPort(node: FlowNode): boolean {
  return getNodePorts(node).some((port) => port.kind === "out");
}

/**
 * How wide the card is drawn. Most blocks take the fixed NODE_WIDTH; a
 * `fitContent` block is measured from its own title and clamped to the width
 * bounds. Everything that reasons about card geometry (edge start points,
 * branch placement, fit-to-view) reads this rather than NODE_WIDTH.
 *
 * The title is all that is measured, because since the card was reduced to an
 * icon and a name it is all the card paints. It used to budget two clipped
 * lines for the trigger sentence as well, which now only made a Handler as
 * wide as a condition nobody can read on it.
 */
export function nodeWidth(node: FlowNode): number {
  const definition = NODE_TYPE_DEFINITIONS[node.type];
  if (!definition.fitContent) return NODE_WIDTH;

  const fitted = titleRowChrome(definition.hasTriggerConfig) + node.title.length * TITLE_CHAR_W + TITLE_SLACK;

  return Math.round(Math.min(MAX_NODE_WIDTH, Math.max(MIN_NODE_WIDTH, fitted)));
}

/**
 * Where an incoming edge lands: how far down the card's *left* edge, since the
 * flow runs rightward. Measured from the body's middle, the same place an exit
 * leaves from — so two blocks of one type wired in a chain are joined by a
 * straight horizontal line rather than by a curve that dips for no reason.
 */
export function nodeInputDy(node: FlowNode): number {
  return bodyMiddle(node, nodeHeight(node));
}
