import type { IconName } from "@/components/ui/Icon";
import type { StatusLabel, Tone } from "@/components/ui/types";
import type { ModuleKey } from "@/features/flows";

export type BotKind = "bot" | "userbot";

export interface BotActivityEntry {
  text: string;
  icon: IconName;
  when: string;
}

/**
 * A language a bot can be written in. Mirrors `LANGUAGES` in
 * `apps/common/i18n.py`, which is what the runtime narrows every send to.
 */
export type BotLanguage = "uz" | "ru" | "en";

/**
 * Which languages this bot answers in.
 *
 * `main` is the one every message is guaranteed to exist in: a block with no
 * translation for the language a customer is being spoken to falls back to it
 * rather than sending nothing (`apps/common/i18n.py::resolve_text`). `enabled`
 * is what the editor draws a `UZ | RU | EN` tab for on each text field, and it
 * always contains `main`.
 */
export interface BotLanguages {
  main: BotLanguage;
  enabled: BotLanguage[];
}

/**
 * What the workspace controls about how the bot presents itself. Mirrors the
 * fields Telegram exposes through @BotFather (`setMyName`, `setMyDescription`,
 * `setMyShortDescription`) plus the studio's own languages.
 *
 * `workingHours` was here — a switch, weekdays, two clock times, a timezone and
 * an away message, with an «Ish vaqti» section of the settings screen above
 * them — and nothing anywhere read one of them. Hours are answered one level
 * down instead, where two flows can answer the same hour differently: a
 * Business trigger carries its own schedule and `engine.matching` decides on
 * it, which is what «Ish vaqtidan tashqari avtojavob» is built on. See
 * `apps/bots/migrations/0010_drop_bot_working_hours.py`.
 */
export interface BotSettings {
  displayName: string;
  /** Telegram "What can this bot do?" — shown on the empty chat screen. */
  description: string;
  /** Telegram "About" — shown on the profile page. */
  shortDescription: string;
  /**
   * Kept in step with `languages.main` rather than edited on its own — one
   * screen asking the same question twice is a screen that can contradict
   * itself. Still written because bots stored before `languages` existed have
   * only this key.
   */
  language: string;
  /** Which languages this bot is written in — see `BotLanguages`. */
  languages: BotLanguages;
  /** Stands in for the profile photo until uploads are wired up. */
  avatarEmoji: string;
}

export interface Bot {
  id: string;
  /** Tenant this bot belongs to — every read is filtered by it. */
  workspaceId: string;
  projectId: string;
  /**
   * Which of the five surfaces this bot answers on.
   *
   * Not decoration: a module missing from this list is a module
   * `apps/engine/matching.py::find_trigger` refuses before it looks for a flow,
   * so an author can draw a whole groups flow, switch it on, and watch the bot
   * ignore the group. An empty list is the one exception — a freshly connected
   * bot answers `dms` whether or not anyone has opened this screen.
   */
  enabledModules: ModuleKey[];
  handle: string;
  kind: BotKind;
  status: StatusLabel;
  /**
   * Stopped from the panel: the bot starts no new conversation on any surface.
   *
   * `Bot.module_enabled` is where this lands, which is the same method
   * `engine/matching.py::find_trigger` asks before it looks for a flow — so the
   * runtime, the chat findings and this screen cannot disagree about it. A run
   * already parked on a question is still finished, and every message still
   * reaches «Suhbatlar»; the switch's own footer says both.
   */
  isPaused: boolean;
  updatedAt: string;
  tokenMasked: string;
  /**
   * The real Bot API token. Never sent to the browser with the page — the
   * settings screen asks for it through a server action when someone presses
   * "Ko'rsatish".
   */
  token: string;
  settings: BotSettings;
  webhookUrl: string;
  /** Telegram's own answer about the webhook — see `BotWebhook`. */
  webhook: BotWebhook;
  connectedAt: string;
  connectedBy: string;
  /**
   * What has been done to this bot, newest first — read on its Sozlamalar
   * screen. `metrics` used to sit beside it and is gone: an hour's counters
   * under the flow list, next to a link to `/analytics`, which answers the
   * same question over a range the reader chooses.
   */
  activity: BotActivityEntry[];
}

/**
 * What Telegram says about a bot's webhook, as opposed to what we asked for.
 *
 * `url` is where updates should go — computed from where this backend is right
 * now. `actualUrl` is where Telegram is really posting. The whole point of
 * keeping both is that they can disagree: a moved deployment, a new tunnel, or
 * a webhook someone set by hand leaves the bot silent while every stored flag
 * still says "connected".
 */
export interface BotWebhook {
  url: string;
  actualUrl: string;
  /** Telegram is posting to `url`, and its last delivery did not fail. */
  registered: boolean;
  /** Telegram's `last_error_message`, or our own note that the address differs. */
  error: string;
  lastErrorAt: string;
  /** The same instant as an age — "2 soat oldin" answers "is this still happening?". */
  lastErrorAgo: string;
  /** Updates Telegram is holding back. Anything above zero is somebody unanswered. */
  pending: number;
  checkedAt: string;
}

/**
 * Whether the webhook address answered when the backend dialled it.
 *
 * `checked` is kept apart from `reachable` because "nobody dialled" and
 * "dialled and got nothing back" are different answers, and reporting the first
 * as the second is the same confident-but-wrong claim this check exists to
 * remove.
 */
export interface WebhookProbe {
  checked: boolean;
  reachable: boolean;
  /** Any HTTP status proves reachability — the endpoint refuses everything but Telegram's POSTs. */
  status: number | null;
  error: string;
}

/**
 * Telegram's answer to "where are you posting this bot's updates", plus our own
 * answer to "does that address answer at all". Both halves are needed: they can
 * each be fine while the other is not.
 */
export interface WebhookCheck {
  /** Telegram is posting to the expected address and its last delivery did not fail. */
  registered: boolean;
  actualUrl: string;
  expectedUrl: string;
  error: string;
  lastErrorAt: string;
  lastErrorAgo: string;
  pending: number;
  checkedAt: string;
  probe: WebhookProbe;
}

/**
 * Whether a bot can be created from inside the panel, and why not when it
 * cannot — answered by the backend rather than guessed here, because the real
 * answer lives on Telegram (`getMe().can_manage_bots`) and a copy in our own
 * environment is a copy that can disagree with it.
 *
 * `reason` is empty exactly when `enabled` is true:
 * - `plan_limit` — the workspace has no seat left. The odd one out in two
 *   ways: it closes the *token* half of the screen as well, since neither
 *   route ends in a bot the plan will hold, and it is the only one the reader
 *   can clear themselves. It is asked first for both of those reasons.
 * - `not_configured` — no manager bot is named in the environment.
 * - `telegram_required` — this account signed in with a password, so the
 *   update naming the new bot would have no id of theirs to match.
 * - `management_off` — the manager bot exists but @BotFather has not been told
 *   it may own other bots.
 */
export interface ManagedBotConfig {
  enabled: boolean;
  reason: "" | "plan_limit" | "not_configured" | "telegram_required" | "management_off";
  /**
   * The server's own sentence, when the refusal names facts only it holds —
   * which plan, which cap, how many are in use. Empty for the three reasons
   * that read the same to every workspace and are therefore worded here.
   *
   * It is the same string `POST /api/bots/` would refuse with, on purpose: a
   * second wording for one refusal is how a disabled button and a 402 start
   * disagreeing about what the plan says.
   */
  message: string;
  managerUsername: string;
}

/** An open attempt: the link to send the reader to, and how long it lasts. */
export interface BotCreateRequest {
  id: string;
  /** `t.me/newbot/<manager>/<username>?name=<name>` — Telegram's own screen. */
  url: string;
  expiresIn: number;
}

/** Where that attempt has got to. `ready` is the only one carrying a bot. */
export interface BotCreateStatus {
  status: "pending" | "ready" | "failed" | "expired";
  bot?: Bot;
  message?: string;
}

/**
 * A Telegram Business account that has attached this bot to its inbox.
 *
 * Everything here is Telegram's to say: the owner connects the bot in
 * Settings → Business → Chatbots and picks what it may do, and the panel that
 * shows this can only report the answer. `rights` is `BusinessBotRights`
 * exactly as it arrived — a map of the API's own field names to booleans, which
 * `data/business.ts` translates into the sentences an owner would recognise.
 */
export interface BusinessConnection {
  id: string;
  connectionId: string;
  /** The account's display name. Empty when Telegram sent none. */
  userName: string;
  /** Without the `@`, and empty for an account that has no username. */
  username: string;
  /**
   * `BusinessBotRights` as it arrived — the Bot API's `can_*` field names, not
   * the MTProto flags an owner's own client sends. `data/business.ts` joins the
   * two, and got it wrong for as long as it existed: see the note there.
   */
  rights: Record<string, boolean>;
  /** Telegram's own `is_enabled` — the owner can suspend the bot without removing it. */
  isEnabled: boolean;
  connectedAt: string;
  /** Everything standing between this bot and working on this account — see `apps/bots/business.py`. */
  problems: BusinessProblem[];
}

/**
 * One reason a bot is not working on a Business account, decided on the server.
 *
 * Only `bot_paused` and `module_off` have a control anywhere in this product.
 * The rest are the account owner's own decisions, taken in their Telegram under
 * Settings → Business → Chatbots — no Bot API method lets a bot grant itself a
 * right — so they are reported and never offered as a switch.
 */
export interface BusinessProblem {
  code: "bot_paused" | "module_off" | "suspended" | "cannot_reply" | "cannot_mark_read";
  tone: Extract<Tone, "danger" | "warning">;
  message: string;
}

/**
 * The one source file every Kod block in this bot is prepended with.
 *
 * A library and not an import graph: the runtime hands a script no module
 * loader, so the only way two flows can share a helper is for the same text to
 * be in front of both of them. `updatedAt` is an age rather than a date — the
 * question a shared file raises is "is this the version I wrote", and "" is a
 * bot whose library has never been saved.
 */
export interface BotScriptLibrary {
  source: string;
  updatedAt: string;
}

/** One Kod block, listed away from the graph it lives in. */
export interface BotScriptBlock {
  flowId: string;
  flowName: string;
  /** A block in a switched-off flow is code that never runs, and the row says so. */
  flowEnabled: boolean;
  nodeId: string;
  title: string;
  /** Where the block keeps its answer — what the blocks after it read as `{{hisob.jami}}`. */
  variable: string;
  lines: number;
  /**
   * The block's own code. Carried for the one line the row prints: the block
   * type's default title is "Kod", so a bot with eight of them has eight rows
   * reading "Kod" until somebody renamed them, and the first line of the script
   * is the only thing on hand that tells them apart.
   */
  source: string;
}

/** Everything the Kod section reads in one call — see `data/scripts-repository`. */
export interface BotScripts {
  library: BotScriptLibrary;
  blocks: BotScriptBlock[];
}

/**
 * A group or channel this bot is in — one row of «Guruh va kanallar».
 *
 * Mirrors `apps/bots/models.py::BotChat`, which is kept current by the
 * `my_chat_member` webhook rather than by anything on this screen: the bot
 * appears in a group the moment somebody adds it there. `status` and `rights`
 * are Telegram's own vocabulary, unchanged — translating an enumeration only
 * Telegram may extend would be a mapping to keep in step forever.
 */
export interface BotChat {
  id: string;
  /** Telegram's own id — negative for groups, `-100…` for supergroups and channels. */
  chatId: number;
  type: "group" | "supergroup" | "channel";
  title: string;
  /** Without the `@`, and empty for a private group. */
  username: string;
  inviteLink: string;
  /** `ChatMember.status` for the bot itself. */
  status: "creator" | "administrator" | "member" | "restricted" | "left" | "kicked";
  isAdministrator: boolean;
  /** False once the bot has left or been removed. The row stays either way. */
  isMember: boolean;
  /** Which of the bot's modules answers here — `groups` or `channels`. */
  moduleKey: ModuleKey;
  /** `ChatMemberAdministrator`'s booleans. An owner arrives with all of them set. */
  rights: Record<string, boolean>;
  /** Null until a refresh has read one, and kept when a later refresh fails. */
  memberCount: number | null;
  /** When that count was actually read — a number with no date is a claim, not a fact. */
  memberCountAt: string;
  /** Telegram's `join_by_request`: joining needs an administrator's nod. */
  joinByRequest: boolean;
  addedAt: string;
  leftAt: string;
  refreshedAt: string;
  /** Everything standing between this bot and working here — see `apps/bots/chats.py::chat_problems`. */
  problems: BotChatProblem[];
}

/**
 * One reason a bot is not working in a chat, decided on the server.
 *
 * On the server because the answer joins three things this screen does not own
 * — the bot's enabled modules, the rights Telegram granted, and whether the
 * last refresh even landed — and a second copy of that rule is how a chat comes
 * to read as healthy on one screen and broken on another.
 *
 * `danger` means the bot does nothing at all here; `warning` means one named
 * thing will not work.
 */
export interface BotChatProblem {
  code:
    | "removed"
    | "bot_paused"
    | "module_off"
    | "restricted"
    | "not_admin"
    | "cannot_post"
    | "cannot_delete"
    | "cannot_approve"
    | "stale";
  tone: Extract<Tone, "danger" | "warning">;
  message: string;
}
