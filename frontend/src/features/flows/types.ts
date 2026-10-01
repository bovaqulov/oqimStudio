import type { StatusLabel } from "@/components/ui/types";
import type { LocalizedText } from "./localized-text";

export type ChannelKind = "tg" | "ub";

export const CHANNEL_LABEL: Record<ChannelKind, string> = {
  tg: "TG bot",
  ub: "Userbot",
};

/**
 * The block types a flow can be built from.
 *
 * This comment used to say that adding one meant a single entry in
 * `flow-builder/node-registry.tsx` and that nothing else branches on the
 * string. Three things were wrong with that: the file is `.ts`, the table
 * lives in `node-definitions.ts` (the registry re-exports it), and the claim
 * itself is false — roughly seven places must be edited and a dozen more may
 * need to be, only one of which the compiler catches.
 *
 * The one that costs real money if it is missed is the backend:
 * `engine.runner._HANDLERS` falls back to `_handle_message`, so a type the
 * runtime does not know is *sent to the customer* as a message carrying its
 * own body text. See `.claude/skills/oqim-blok/` for the checklist.
 */
export type NodeType =
  | "trigger"
  | "groupjoin"
  | "groupleave"
  | "joinrequest"
  | "channelpost"
  | "message"
  /**
   * Asks, waits, keeps. The block that closes the gap every other one left
   * open: «Xabar» sends and the run walks straight on, so an author who wrote
   * "ism va familiyangizni yozing" and put a «Javobni saqlash» block after it
   * saved the *previous* message — a real contact ended up named after the
   * button they had pressed. Nothing warned, because nothing was broken: no
   * block in the palette had ever claimed to wait.
   */
  | "question"
  | "condition"
  | "delay"
  | "tag"
  | "ai"
  | "http"
  | "flowlink"
  /**
   * The reminder that does *not* stop the flow: unlike Kutish, the run walks
   * straight past this block and the message goes out later, and only if the
   * customer has gone quiet in the meantime.
   */
  | "followup"
  /** Asks which language to be answered in and writes it to the contact. */
  | "language"
  /**
   * The `/start` block: the `dms` module's main flow opens with it, it answers
   * that one command and nothing else, and it is neither added nor removed by
   * hand. See `features/flow-builder/node-registry.ts`.
   */
  | "start"
  /**
   * The block a conversation ends on. It is the only type with no exit at all
   * — that is the whole of it — and the runtime finishes the run when it walks
   * into one (`apps/engine/runner.py`, `_handle_end`).
   *
   * A flow already ends where its last block runs out, so this adds no ending
   * the runtime did not have. What it adds is an ending the *author* can point
   * at: on a canvas of thirty blocks, "this branch is finished" and "this
   * branch is not wired up yet" look exactly alike, and only one of them is a
   * bug.
   */
  | "end"
  /**
   * Writes one row into a table (`apps/tables`).
   *
   * Not a setting on «Ma'lumotni saqlash», which is the first thing to ask.
   * That block writes a *fact about the person in front of it* — a tag, or an
   * answer kept on the contact — and it is read back one contact at a time.
   * This one writes a *record*: a booking, an order, a request. The owner reads
   * those as a list, sorts them, exports them, and hands the whole table to a
   * flow's text through `{{ table("navbat") }}`. One belongs to a contact and
   * the other belongs to the workspace, so they are not the same block with a
   * checkbox — they answer different questions and have different readers.
   */
  | "tablerow"
  /**
   * Finds one row and puts its columns into the run's variables.
   *
   * The other direction from `tablerow`, and a *branching* block rather than a
   * pass-through: a lookup that finds nothing is the case worth drawing. A
   * price list with no row for the code the customer typed is not an error —
   * it is a conversation that has to say something else — and a block with one
   * exit would leave the author writing a Shart underneath it to ask whether
   * the read they just did had worked.
   */
  | "tableread";

/**
 * Which row a «Ma'lumot o'qish» block looks for, and what it calls what it finds.
 *
 * `into` is a prefix and not a single name: a row has columns, so what comes
 * back is `{{qator.narx}}` and `{{qator.kod}}` rather than one value the author
 * would have to pick in advance. It is the same dotted lookup `{{http.status}}`
 * already uses — `sender._lookup` walks it — so nothing new has to be learned.
 */
export interface TableReadConfig {
  /** `Table.handle` in the same workspace. */
  handle: string;
  /** Which column is compared. Empty means "take the newest row". */
  column: string;
  /** What it is compared against — ordinary block text, so `{{…}}` works. */
  value: string;
  /** Prefix the found row is written under. Defaults to `qator`. */
  into: string;
}

/**
 * Which table a «Ma'lumot yozish» block appends to, and what it puts in it.
 *
 * `handle` and not an id: a handle is what the author already writes inside
 * `{{ table("navbat") }}`, so the two halves of the feature are named the same
 * way in the one place an author looks at both. A table renamed out from under
 * a flow is a warning, the same as a library function that moved — never a
 * silent write into nothing.
 */
export interface TableWriteConfig {
  /** `Table.handle` in the same workspace. Empty until the author picks one. */
  handle: string;
  /**
   * Column key → what is written into it. The value is ordinary block text, so
   * `{{ism}}` and `{{ money(jami) }}` both work and are resolved by the same
   * renderer every other field uses.
   */
  values: Record<string, string>;
}

/**
 * What fires a "Handler" block in the `dms` module. `kinds` is a multi-select
 * over both trigger conditions (start/command/keyword/any) and incoming
 * content types (photo/document/…) — a real Telegram message can match more
 * than one at once (e.g. a photo sent as a reply to /start).
 */
export type DmsTriggerKind =
  | "start"
  | "command"
  | "keyword"
  | "any"
  | "callback"
  | "photo"
  | "document"
  | "audio"
  | "voice"
  | "video"
  | "location"
  | "contact"
  | "reaction"
  | "payment"
  | "webapp"
  | "blocked"
  | "unblocked";

/**
 * How `DmsTriggerConfig.keywords` is compared against the incoming message text.
 * "contains" is the everyday case and the default; "regex" is the escape hatch
 * and the only mode that reads `keywordFlags`.
 */
export type KeywordMatch = "exact" | "contains" | "regex";

/**
 * A `{{ funksiya(...) }}` naming something the bot's script library does not
 * declare. Worked out by the backend on the save that caused it, because the
 * library is the bot's and the graph is the flow's — the editor holds one of
 * the two and cannot answer the question alone.
 */
export interface ExpressionWarning {
  nodeId: string;
  /** The function that is missing, without its brackets. */
  function: string;
  /** Already a sentence, in the author's language. */
  message: string;
}

export interface DmsTriggerConfig {
  kinds: DmsTriggerKind[];
  /** Used when `kinds` includes "command" — the command name *without* its leading "/", e.g. "menu". */
  command?: string;
  /** Used when `kinds` includes "keyword" — one term (or one regex pattern) per line. */
  keywords?: string;
  /** How `keywords` is matched; defaults to "contains" when unset. */
  keywordMatch?: KeywordMatch;
  /** Regex mode only — the RegExp flag string, e.g. "im". */
  keywordFlags?: string;
}

/* -------------------------------------------------------------------------- */
/* Business                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The Bot API update a business Handler answers: `business_message`, a new
 * message from a client to the connected account.
 *
 * It used to be a choice of five updates. The other four — edits, deletions,
 * callbacks, connection changes — carried no message to route on, so the layer
 * they were picked in is gone and every Handler now starts from a real
 * incoming message. The field stays so a stored graph still says which update
 * it subscribes to. See https://core.telegram.org/bots/api#update
 */
export type BusinessSignal = "new";

/**
 * What a business Handler looks for *inside* the message it received. A
 * `business_message` carries the same `Message` a bot chat would, so the same
 * command/keyword/content filters apply — the update type alone is far too
 * coarse to route a real inbox with.
 */
export type BusinessMatchKind = "any" | "keyword" | "command" | "media";

/** Content types a business Handler can narrow incoming messages down to. */
export type BusinessMediaKind = "photo" | "video" | "voice" | "audio" | "document" | "location" | "contact";

/**
 * How the working-hours window is read. "always" is an unscheduled Handler —
 * the window fields are kept while it is off so switching back restores them.
 */
export type BusinessScheduleMode = "always" | "inside" | "outside";

export interface BusinessScheduleConfig {
  mode: BusinessScheduleMode;
  /** ISO weekdays the window applies on: 1 = Monday … 7 = Sunday. */
  days: number[];
  /** "HH:MM", 24-hour. `to` earlier than `from` means the window crosses midnight. */
  from: string;
  to: string;
  /** IANA zone the window is read in — the account's office hours, not the viewer's. */
  timezone: string;
}

/**
 * What fires a "Handler" block in the `business` module. Every one of them
 * answers an incoming client message — from any chat of the connected account
 * — and two independent layers narrow it down: what is inside the message
 * (`match` + its detail fields) and when it arrived (`schedule`).
 *
 * Everything past `messageTypes` is optional so a graph saved before those
 * layers existed still loads — `features/flow-builder/lib/trigger.ts` supplies
 * the default for each one.
 */
export interface BusinessTriggerConfig {
  /**
   * Historical name — the `BusinessSignal` this Handler subscribes to, not a
   * message content type. Always `["new"]`; kept as a field so the stored
   * shape stays readable to whoever consumes the graph.
   */
  messageTypes: BusinessSignal[];
  /** Defaults to "any" — every message the connected account receives. */
  match?: BusinessMatchKind;
  /** Used when `match` is "command" — the name *without* its leading "/". */
  command?: string;
  /** Used when `match` is "keyword" — one term (or one regex pattern) per line. */
  keywords?: string;
  keywordMatch?: KeywordMatch;
  /** Regex mode only — the RegExp flag string, e.g. "im". */
  keywordFlags?: string;
  /** Used when `match` is "media". */
  mediaKinds?: BusinessMediaKind[];
  schedule?: BusinessScheduleConfig;
}

/** Attached media on an outgoing message — reframes the body field as a Bot API `caption`. */
export type MediaKind = "photo" | "video" | "audio" | "voice" | "document";

/** Mirrors Telegram's `Chat.type` — see https://core.telegram.org/bots/api#chat */
export type ChatType = "private" | "group" | "supergroup" | "channel";

/**
 * What a "Xabar" block sends. Each kind maps to one Bot API `send*` method
 * (see `features/flow-builder/lib/message-content.ts` for the mapping and the
 * per-kind constraints — not every kind accepts a caption or a keyboard).
 */
export type MessageContentKind =
  | "text"
  | "photo"
  | "video"
  | "audio"
  | "voice"
  | "document"
  | "animation"
  | "location"
  | "contact"
  | "poll"
  | "invoice"
  | "album"
  | "copy";

export interface PollOption {
  id: string;
  /** What the row says — translatable, like every other thing a customer reads. */
  text: LocalizedText;
}

/** `sendPoll` — a quiz poll additionally needs exactly one option flagged correct. */
export interface PollConfig {
  question: LocalizedText;
  options: PollOption[];
  isAnonymous: boolean;
  isQuiz: boolean;
  allowsMultipleAnswers: boolean;
  /** Only meaningful when `isQuiz` — the `PollOption.id` that scores as correct. */
  correctOptionId?: string;
}

/**
 * `sendLocation`, or `sendVenue` once `title`/`address` are filled in.
 *
 * The two venue fields are plain strings while everything else a customer reads
 * is a [[LocalizedText]], and deliberately so for now: `apps/engine/sender.py`
 * puts them into the `sendVenue` payload as they are stored, without going
 * through `render_text`, so a map saved here would reach Telegram as a map.
 * They can be widened the moment that call is rendered like the rest.
 */
export interface LocationConfig {
  latitude: string;
  longitude: string;
  title?: string;
  address?: string;
}

/** `sendContact` — `phoneNumber` and `firstName` are the Bot API's required pair. */
export interface ContactConfig {
  phoneNumber: string;
  firstName: string;
  lastName?: string;
}

/**
 * `sendInvoice`. `amount` is held as a human-readable decimal string and is
 * converted to the Bot API's smallest-currency-unit integer at send time.
 */
export interface InvoiceConfig {
  title: string;
  description: string;
  currency: string;
  amount: string;
  payload?: string;
  /**
   * What the way-out row under the Pay button says. An invoice carries one
   * whatever the author does — a customer who changes their mind with nothing
   * to tap leaves the run parked forever — and this renames it.
   */
  cancelLabel?: string;
  /**
   * Which connected payment provider takes this invoice. Unset means the bot's
   * only connected provider (or none — the block then cannot be sent).
   */
  providerId?: string;
}

/**
 * How a file is handed to Telegram. The Bot API takes any of three forms:
 * an HTTPS URL it fetches itself, a `file_id` of something already on its
 * servers, or raw multipart bytes. The first two are plain strings; "upload"
 * is the slot for the third — it holds the picked file's name until an upload
 * endpoint fills `value` in.
 */
export type MediaSourceKind = "url" | "file_id" | "upload";

export interface MediaSource {
  kind: MediaSourceKind;
  /** URL or file_id. Empty while an "upload" is still waiting on the backend. */
  value: string;
  /** Name of the picked file, shown while an upload is pending. */
  fileName?: string;
}

/** Media-group entries mix freely among photo/video, but audio and document each have to stand alone. */
export type AlbumItemKind = "photo" | "video" | "audio" | "document";

export interface AlbumItem {
  id: string;
  kind: AlbumItemKind;
  /**
   * Telegram shows the album under the first item's caption, so in practice
   * only that one is read. Translatable like every other thing a customer
   * reads — see [[FlowNode.text]].
   */
  caption?: LocalizedText;
  source?: MediaSource;
}

/** Whether quick-reply buttons render as an `InlineKeyboardMarkup` or a `ReplyKeyboardMarkup`. */
export type ButtonMode = "inline" | "reply";

/** What a "Savol" block captures — free text, or a one-tap `request_contact`/`request_location` share. */
/**
 * What a "Savol" block expects back.
 *
 * The runtime enforces every one of these (see `apps/engine/validation.py`):
 * an answer that is not of the asked-for kind is refused with an explanation
 * and the question is put again, rather than being stored as if it fit.
 *
 * `contact` and `location` are answered by tapping Telegram's own share button;
 * `phone` accepts either the tap or a typed number, which is what most people
 * do.
 */
export type AnswerType = "text" | "phone" | "email" | "number" | "date" | "contact" | "location";

/** Telegram inline/reply button behavior — mirrors `InlineKeyboardButton`'s mutually exclusive action fields. */
/**
 * "request_contact" / "request_location" are the reply keyboard's own powers —
 * a row that hands over a Telegram-verified phone number or a live position in
 * one tap. They have no inline equivalent, the mirror image of the five kinds
 * that have no reply one.
 */
export type ButtonKind =
  | "callback"
  | "url"
  | "webapp"
  | "login"
  | "switch_inline"
  | "copy"
  | "request_contact"
  | "request_location";

/**
 * Bot API 9.4's `style` field, word for word: "Must be one of “danger” (red),
 * “success” (green) or “primary” (blue). If omitted, then an app-specific
 * style is used." Absent here means omitted there — the customer's own theme.
 */
export type ButtonStyle = "primary" | "success" | "danger";

export interface FlowButton {
  id: string;
  /** What the key says — see [[FlowNode.text]] on why this is not just a string. */
  label: LocalizedText;
  kind: ButtonKind;
  /** Telegram renders the button in this color; absent = the app's default. */
  style?: ButtonStyle;
  /** URL for "url"/"webapp"/"login"; query text for "switch_inline"; copied text for "copy". Unused for "callback". */
  value?: string;
  /**
   * Sits on the same keyboard row as the button before it, rather than opening
   * a row of its own. Telegram's keyboard is an array of rows; the editor keeps
   * the buttons flat and rebuilds those rows from this one flag, so ordering,
   * ids and the per-button ports stay untouched by layout. Absent means "new
   * row", which is how every keyboard authored before this existed reads.
   */
  sameRow?: boolean;
}

/** What a condition rule compares — the subset of an incoming update the editor can reason about today. */
export type ConditionField =
  | "message_text"
  | "command"
  | "user_username"
  | "user_first_name"
  | "chat_type"
  | "chat_title"
  | "media_type"
  | "business_connection_id"
  | "variable"
  | "datetime";

export type ConditionOperator =
  | "equals"
  | "not_equals"
  | "contains"
  | "not_contains"
  | "starts_with"
  | "ends_with"
  | "is_empty"
  | "is_not_empty"
  | "after"
  | "before";

export interface ConditionRule {
  id: string;
  /** Flips the rule's result — the builder's "NOT". */
  negate: boolean;
  field: ConditionField;
  /** Only used when `field` is "variable" — the tag/variable name being compared. */
  variableName?: string;
  operator: ConditionOperator;
  /** Unused when `operator` is "is_empty" / "is_not_empty". */
  value: string;
}

export type ConditionCombinator = "AND" | "OR";

export interface ConditionConfig {
  combinator: ConditionCombinator;
  rules: ConditionRule[];
}

/** What a "Ma'lumotni saqlash" block (type `tag`) does when the flow reaches it. */
export type TagAction = "add" | "remove" | "set_variable";

/**
 * Everything an «AI agent» block carries. Which agent answers, and nothing
 * else.
 *
 * Deliberately thin. The persona, the instructions, the model, the tools and
 * the budgets all live on the agent record, so two blocks pointing at the same
 * agent cannot disagree about who it is — which is exactly what a copy of the
 * config on each block would guarantee within a week.
 */
export interface AgentBlockConfig {
  /** Agent id from `features/agents`. Empty until the author picks one. */
  agentId: string;
}

/** Where an AI block grounds its answer. See `features/flow-builder/lib/ai.ts`. */
export type AiKnowledgeSource = "none" | "flow_context" | "knowledge_base" | "website";

/** What happens when the model fails, times out or is not confident enough. */
export type AiFallbackAction = "message" | "handoff" | "flow";

/**
 * Everything an "AI javob" block needs beyond its prompt: which model answers,
 * how freely, what it may read, and what happens when it cannot answer.
 */
export interface AiConfig {
  /** Model id from the catalogue in `features/flow-builder/lib/ai.ts`. */
  model: string;
  /** 0 = deterministik, 1 = erkin. */
  temperature: number;
  /** Upper bound on the answer's length, in tokens. */
  maxTokens: number;
  knowledgeSource: AiKnowledgeSource;
  /** Knowledge-base name or URL, depending on `knowledgeSource`. */
  knowledgeRef?: string;
  fallbackAction: AiFallbackAction;
  /** Used when `fallbackAction` is "message". */
  fallbackText?: string;
  /** Used when `fallbackAction` is "flow" — the target flow's id. */
  fallbackFlowId?: string;
  /** Hand the chat to an operator when the model's answer is low-confidence. */
  handoffOnLowConfidence?: boolean;
  /** Where the model's answer is kept, when it is worth keeping. See [[FlowNode.saveAnswerAs]]. */
  saveAnswerAs?: string;
  /**
   * How many earlier turns of the conversation are handed to the model along
   * with the prompt. Zero — the default — is a block that answers each message
   * on its own, which is right for a one-shot question and wrong for a chat.
   */
  historyDepth?: number;
}

/* -------------------------------------------------------------------------- */
/* Menu, subscription, rating, language                                        */
/* -------------------------------------------------------------------------- */

/**
 * The one row a "Menyu" block carries that is not a branch of the graph.
 *
 * "Bosh menyu" leads nowhere in *this* flow — it re-enters the bot at a
 * command instead (`cmd:<command>`, `engine.sender.COMMAND_PREFIX`). It shared
 * that mechanism with the bot's own safety-net menu until that menu was
 * removed; the prefix outlived it, because the Menyu block is where a home row
 * is drawn now. So it is a setting on the block rather than a button in the
 * list: a button in the list publishes a port, and a port no answer can ever
 * leave through is a lie drawn on the card.
 */
export interface MenuConfig {
  /** What the row says. Absent means the menu carries no home row at all. */
  homeLabel?: string;
  /** The command it re-enters the bot at, without its slash. "start" when unset. */
  homeCommand?: string;
}

/** One channel a subscription gate checks membership of. */
export interface SubscriptionChannel {
  id: string;
  /** "@kanal" for a public channel, or the numeric `-100…` id of a private one. */
  chatId: string;
  /** What the join row says. Falls back to `chatId`. */
  title?: string;
  /**
   * Invite link the join row opens. A `@username` needs none — `t.me/<name>`
   * is derived from it — but a private channel has no public address, so its
   * link is the one thing the author has to paste in.
   */
  inviteUrl?: string;
}

export interface SubscriptionConfig {
  channels: SubscriptionChannel[];
  /** Label of the row that runs the check again. */
  checkLabel?: string;
  /** Said when the check comes back short — they tapped, and are still not in. */
  retryText?: string;
}

/**
 * What a "Baho" block offers. Five stars is the everyday rating; NPS is the
 * nought-to-ten question the score is actually defined on, which is why it is
 * a scale and not a "max" number the author can set to anything.
 */
export type RatingScale = "stars5" | "nps10";

export interface RatingConfig {
  scale: RatingScale;
  /** Name the score is written under, on the run and on the contact. */
  variable: string;
  /** Sent once a score arrives. Empty says nothing and moves on. */
  thanksText?: string;
}

/** One language a "Til" block offers. */
export interface LanguageOption {
  id: string;
  /** Stored on the contact as `mijoz_tili` — "uz", "ru", "en". */
  code: string;
  label: string;
}

export interface LanguageConfig {
  options: LanguageOption[];
}

/**
 * A "Kod" block's contents.
 *
 * The source is the *body* of a function rather than a whole one: it reads
 * `inputs` and ends with `return`. That shape is what lets somebody write four
 * useful lines without first meeting the word "module", and it is also what
 * lets the runtime build the module itself — the sandbox has `eval` switched
 * off, so the wrapping has to happen before the code gets there.
 */
export interface ScriptConfig {
  source: string;
  /**
   * Where the answer is kept, so the blocks after this one can read it.
   *
   * One name and not a spread of the returned object: a script that answers
   * `{ jami, chegirma }` writes `{{hisob.jami}}` and `{{hisob.chegirma}}`, and
   * the author can see at a glance which variables came from where. Spreading
   * would let one block quietly overwrite a question's answer.
   */
  variable: string;
}

/**
 * One of the two files the Script panel edits.
 *
 * `updatedAt` is already a sentence — "3 kun oldin" — and empty for a file
 * nobody has saved yet, which is a different thing from one saved and then
 * emptied. The panel prints the first as nothing at all rather than as a date
 * that would be a lie about a file that does not exist.
 */
export interface FlowScriptFile {
  source: string;
  updatedAt: string;
}

/**
 * A reserved function name the runtime calls, and whether this flow's file
 * declares it.
 *
 * Sent by the backend rather than listed here, because the list is the set of
 * moments the runtime *actually* calls — `apps/engine/hooks.py::HOOKS` — and a
 * panel that offered a fourth one out of its own memory would be teaching a
 * hook that never fires.
 */
export interface FlowScriptHook {
  name: string;
  /** One line, in the author's language: when it runs. */
  when: string;
  declared: boolean;
}

/** Every `{{ funksiya(...) }}` one block calls, and which of them are missing. */
export interface FlowExpressionUse {
  nodeId: string;
  /** The block's name as its card shows it. */
  title: string;
  functions: string[];
  /** Those the bot's library does not declare — a subset of `functions`. */
  missing: string[];
}

/** Everything the Script panel opens with, from one read. */
export interface FlowScripts {
  flow: FlowScriptFile;
  library: FlowScriptFile;
  hooks: FlowScriptHook[];
  expressions: FlowExpressionUse[];
}

/**
 * What one run of a Kod block answered — the shape the test panel renders.
 *
 * `kind` is a small closed vocabulary rather than a sentence, because the panel
 * has to decide a colour and a next step from it: `author` points at the code,
 * `timeout` and `memory` point at the limits, `runtime` points at a throw, and
 * `unavailable` means this deployment cannot run scripts at all.
 */
export interface ScriptRunResult {
  ok: boolean;
  value: unknown;
  logs: string[];
  error: string;
  kind: "" | "author" | "timeout" | "memory" | "runtime" | "unavailable" | "busy";
  durationMs: number;
  /**
   * Which of the two editors the fault came from, once a bot's shared library
   * is above the block (`engine/script/compose.py::locate`). Empty when there
   * is nothing to translate — no library, or a syntax error, which is caught
   * while the module compiles and so has no frame and no line at all.
   */
  where: "" | "library" | "block";
  /** 1-based, counted in whichever source `where` names — never in the two joined together. */
  line: number | null;
}

export interface FlowNode {
  id: string;
  type: NodeType;
  x: number;
  y: number;
  title: string;
  /**
   * What the block says — the message body, or the one line a block with no
   * body of its own reads back on the card.
   *
   * One string, or one per language (see `features/flows/localized-text`).
   * Both shapes are live at once and always will be: a flow saved before
   * translations existed holds a bare string, and there is no migration that
   * could turn one into a translation, so a plain string is read as the bot's
   * own language. Never render it directly — `resolveText` is what turns it
   * into the string that goes out, and the one that goes on the canvas.
   */
  text: LocalizedText;
  channel: ChannelKind;
  scopes: string[];
  buttons?: FlowButton[];
  /**
   * The optional "Orqaga" row. Present means the block ends with one; the
   * value is its label, empty for the default wording.
   *
   * Not a `FlowButton`: it is not one of the author's keys but the block's own
   * way out, the same way an invoice carries "Bekor" and a question "O'tkazib
   * yuborish". That is also why its exit leaves the card's *left* edge — the
   * flow reads left to right, and the one exit that means "back" is the one
   * that should not point forward.
   */
  back?: LocalizedText;
  /**
   * The default for every connection *into* this block, overridden by any edge
   * that states its own. A block can be reached from ten places and configuring
   * the same intent ten times is how a graph drifts out of step with itself.
   */
  incomingTransition?: EdgeTransition;
  minutes?: number;
  /** Target flow id, used by "flowlink" nodes. */
  target?: string;
  /**
   * Which block of the target flow the jump lands on — the picker always names
   * one, since a flow run from its beginning re-sends a welcome the customer
   * has already read. Unset only on a graph saved before the block could be
   * chosen, which is entered at the start as it always was.
   */
  targetNodeId?: string;
  business?: BusinessTriggerConfig;
  dmsTrigger?: DmsTriggerConfig;
  /**
   * Manual override for which Handler wins when an update matches more than
   * one of them — lower runs first. Unset means the priority is derived from
   * the trigger itself (see `features/flow-builder/lib/trigger.ts`).
   */
  priority?: number;
  /** Attachment on a "Savol" block, which always keeps its text prompt. */
  media?: MediaKind;
  /** What a "Xabar" block sends; defaults to "text" when unset. */
  contentKind?: MessageContentKind;
  /** The file behind a photo/video/audio/voice/document/animation block. */
  mediaSource?: MediaSource;
  /** `t.me` link of the message a "copy" block re-sends via `copyMessage`. */
  copyLink?: string;
  poll?: PollConfig;
  location?: LocationConfig;
  contact?: ContactConfig;
  invoice?: InvoiceConfig;
  /** The "Bosh menyu" row of a "Menyu" block — see [[MenuConfig]]. */
  menu?: MenuConfig;
  /** Channels a "Kanalga obuna" block gates on. */
  subscription?: SubscriptionConfig;
  /** Scale and variable of a "Baho" block. */
  rating?: RatingConfig;
  /** The languages a "Til" block offers. */
  language?: LanguageConfig;
  album?: AlbumItem[];
  buttonMode?: ButtonMode;
  answerType?: AnswerType;
  condition?: ConditionConfig;
  tagAction?: TagAction;
  /** Model, grounding and fallback settings of an "AI javob" block. */
  ai?: AiConfig;
  /** Which agent answers, on an "AI agent" block. */
  agent?: AgentBlockConfig;
  /** The source and the result variable of a "Kod" block. */
  script?: ScriptConfig;
  /** Tag label ("add"/"remove") or variable name ("set_variable"). */
  tagName?: string;
  /** Only used when `tagAction` is "set_variable". */
  tagValue?: string;
  /** Set on a `tablerow` block — see [[TableWriteConfig]]. */
  tableWrite?: TableWriteConfig;
  /** Set on a `tableread` block — see [[TableReadConfig]]. */
  tableRead?: TableReadConfig;
  /**
   * Where a "Savol" block's answer is kept — the field the author fills in as
   * "Qayerga saqlash".
   *
   * Supersedes `tagName` on a question, which is where the same fact was
   * stored back when the block had no field of its own. The runtime reads this
   * one first and falls back to `tagName` (see `apps/engine/runner.py`,
   * `resume_with_reply`), so a flow saved either way keeps working and no
   * migration has to reach every graph.
   */
  saveAnswerAs?: string;
  /**
   * Said instead of the runtime's own wording when an answer is not
   * understood. The built-in messages name an example ("Masalan: +998 90 …");
   * an author who overrides one is taking that job on.
   */
  errorText?: string;
  /**
   * How many times a "Savol" re-asks before the conversation goes to a person.
   * Three when unset — enough for a typo and a second thought.
   */
  retryLimit?: number;
  /** The customer may leave this question unanswered and move on. */
  allowSkip?: boolean;
  /**
   * A regular expression the answer has to match, checked on top of
   * `answerType` rather than instead of it: the type still normalises what is
   * stored, and this narrows what is accepted.
   */
  pattern?: string;
}

/**
 * What happens to the message already on screen when the next block is
 * delivered — see `apps/engine/transitions.py`, which is the authority and
 * whose matrix `flow-builder/lib/transitions` mirrors.
 *
 * A property of the connection rather than of either block, because "keep the
 * menu and send under it" and "replace the menu in place" are two different
 * things to say about the same pair, and which one is meant depends on how the
 * reader got there.
 */
export type EdgeTransition = "keep" | "clearButtons" | "edit" | "delete";

export interface FlowEdge {
  id: string;
  from: string;
  port: string;
  to: string;
  /**
   * Unset means "nobody said": the block's own [[FlowNode.incomingTransition]]
   * decides, and failing that a Menyu replaces the screen while everything else
   * keeps it. Left optional rather than defaulted so a graph saved before this
   * existed is not rewritten on load.
   */
  transition?: EdgeTransition;
  /**
   * Seconds to hold a `delete` back for. Zero — the default — removes the old
   * message *before* the new one is sent, so the reader never sees both; any
   * other value sends first and takes the old one away behind it, which is what
   * to reach for when the message being replaced is worth finishing.
   *
   * Ignored by every other transition. Capped at an hour, past which the
   * 48-hour wall on `deleteMessage` is the real limit anyway.
   */
  deleteAfterSeconds?: number;
}

export type ModuleKey = "business" | "groups" | "channels" | "dms" | "webapp";

export interface FlowStat {
  label: string;
  value: string;
}

/**
 * How a flow came into being. Kept because it is the one thing the author
 * cannot read off the graph later: a flow built from "Ish vaqtidan tashqari
 * avtojavob" looks like any other six blocks once it is on the canvas, and
 * knowing which template it started from is what makes it safe to re-apply the
 * template's later improvements — or to recognise a flow nobody customised.
 */
export interface FlowOrigin {
  kind: "template" | "wizard" | "blank";
  /** The `FlowTemplate.key` this was stamped from, when `kind` is "template". */
  key?: string;
  /** Card-ready label: "Shablon · Ish vaqtidan tashqari avtojavob". */
  label: string;
}

/**
 * Which editor a flow opens in.
 *
 * A view setting, not a shape: one graph underneath either way, no conversion
 * in either direction, so switching can never cost an author their work.
 * "simple" is a top-to-bottom list of steps; "pro" is the canvas.
 */
export type FlowLayoutMode = "simple" | "pro";

export interface FlowRecord {
  /** Which editor this flow opens in. See [[FlowLayoutMode]]. */
  layoutMode?: FlowLayoutMode;
  id: string;
  name: string;
  description: string;
  /** Tenant this flow belongs to — every read is filtered by it. */
  workspaceId: string;
  projectId: string;
  botId: string;
  moduleKey: ModuleKey;
  status: StatusLabel;
  stats: FlowStat[];
  updatedAt: string;
  /**
   * Whether the runtime hands updates to this flow at all. Separate from
   * `status`, which is a label: a flow can be a finished draft nobody switched
   * on. Absent on records written before the switch existed — read it through
   * `isFlowEnabled`, never directly.
   */
  enabled?: boolean;
  /** How many times the flow has been entered — the one number its card shows. */
  runs?: number;
  origin?: FlowOrigin;
  nodes: FlowNode[];
  edges: FlowEdge[];
  /**
   * The `dms` module's main flow: one per bot, created with the module rather
   * than by hand, and the only flow a `/start` Handler lives in — every other
   * flow answers a command of its own and runs whether or not anything links
   * to it. Never set on the other modules, which have no such entry point.
   */
  isMain?: boolean;
}

export type FlowSummary = Omit<FlowRecord, "nodes" | "edges">;
