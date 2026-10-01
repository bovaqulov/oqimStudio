import type { IconName } from "@/components/ui/Icon";
import type { ModuleKey } from "@/features/flows";

export interface ModuleDefinition {
  key: ModuleKey;
  name: string;
  icon: IconName;
  description: string;
  /** Modules with no shipped automation yet render the "soon" notice instead of a flow list. */
  comingSoon?: boolean;
  /** What this module needs before its first flow can run, shown when it has none. */
  setupHint: string;
}

/**
 * The five surfaces a bot can automate. Static across every bot — registration
 * order is the tab order, and `dms` is first because it is where a bot opens:
 * the tab that is already selected should not read as the fourth of five.
 *
 * Two of them are shipped, `dms` and `business`. The other three carry
 * `comingSoon`, which leaves the tab visible and unclickable rather than
 * removing it — the surface is coming, and a row whose length changes as
 * modules land tells the reader nothing about where they are.
 *
 * `groups` and `channels` are not waiting on the runtime and never were:
 * `apps/engine/matching.py` has routed `join`, `leave`, `join_request` and
 * `channel_post` for as long as the modules have existed, every block in their
 * palettes is handled, and both kits ship triggers, actions and templates
 * (`features/flow-kit/recipes`). They came off the flag once on the strength of
 * that, together with the chat registry at `/bots/<id>/chats` that tells an
 * author whether the bot is in the room and an administrator there. They are
 * back on it deliberately: the runtime answering is not the same as the surface
 * being finished, and two finished surfaces are worth more than five announced
 * ones. Nothing below the flag was undone, so putting it back is a decision
 * about what to show and not a decision to rebuild.
 *
 * `webapp` is the one that is genuinely short a half. A module needs somewhere
 * for its updates to come *from*: a Mini App has no page here, no way to prove
 * who opened it and no way to hand anything back. The runtime half exists —
 * `events.parse_update` reads `web_app_data`, `matching` routes it, `sender`
 * draws a `web_app` button at an address the author supplies — so an author who
 * hosts their own Mini App elsewhere is not blocked by this flag. What the flag
 * says is that *this product* serves none.
 *
 * A flow already filed under a flagged module is hidden, not deleted: the panel
 * fetches nothing for a `comingSoon` module and the tab does not open, so those
 * flows come back with the flag.
 */
export const MODULE_DEFINITIONS: ModuleDefinition[] = [
  {
    key: "dms",
    name: "Bot ichida",
    icon: "chat-circle",
    description:
      "Foydalanuvchi bot bilan 1:1 yozishmasi: asosiy menyu, anketa, buyurtma qabuli va sotuv voronkalari.",
    setupHint: "Bot tokeni ulangan bo'lsa bo'lim darhol ishlaydi — birinchi oqimni yarating.",
  },
  {
    key: "business",
    name: "Business",
    icon: "user-circle",
    description:
      "Telegram Business orqali shaxsiy akkauntingizga kelgan xabarlarni bot qabul qiladi: ish vaqtidan tashqari avtojavob, tez javoblar va mijozni operatorga uzatish shu yerda sozlanadi.",
    setupHint: "Telegram → Settings → Business → Chatbots bo'limida shu botni ulang.",
  },
  {
    key: "groups",
    name: "Guruh",
    icon: "users-three",
    comingSoon: true,
    description:
      "Guruhdagi xabarlar va a'zolar ustidan nazorat: yangi a'zoni kutib olish, qoidalarni eslatish, so'rovlarga javob va guruhga avtomatik xabar.",
    setupHint: "Botni guruhga admin qilib qo'shing — qaysi guruhlarda ekani «Guruhlar» bo'limida ko'rinadi.",
  },
  {
    key: "channels",
    name: "Kanal",
    icon: "megaphone",
    comingSoon: true,
    description:
      "Kanal posti chiqqanda oqim ishga tushadi: kanalga xabar yozish, jamoaga bildirishnoma va obuna so'roviga javob.",
    setupHint: "Botni kanalga «Post joylash» huquqi bilan admin qiling — usiz hech nima yubora olmaydi.",
  },
  {
    key: "webapp",
    name: "Web App",
    icon: "browser",
    comingSoon: true,
    description:
      "Telegram ichida ochiladigan mini-ilova. Oqim tomoni tayyor — ilovaning o'zi hali yo'q.",
    setupHint:
      "O'z Mini ilovangiz bo'lsa, «Bot ichida» oqimidagi xabarga «Web App» turidagi tugma qo'shib manzilini yozing.",
  },
];

/** The modules an author can build on today — the tab bar still lists the rest, marked "Tez orada". */
export const AVAILABLE_MODULES = MODULE_DEFINITIONS.filter((module) => !module.comingSoon);

/**
 * The surfaces that are announced but not shipped yet.
 *
 * The line that used to stand here said un-flagging one was "the only edit
 * needed". It is the last edit and not the first, and the two that came off
 * this list and went back on are why: what a flag costs before it comes off is
 * whatever the surface needs in order to receive an update at all, and then
 * whatever it needs before a reader can finish the job the tab offers.
 */
export const COMING_SOON_MODULES = MODULE_DEFINITIONS.filter((module) => module.comingSoon);

/**
 * Where a bot opens. The `dms` module is not one tab among five: it is the
 * conversation every bot has from the moment its token is connected, so the
 * bot's own page *is* that module's page — see `moduleHref`.
 */
export const DEFAULT_MODULE_KEY: ModuleKey = "dms";

/**
 * The module a string from outside names, or the default.
 *
 * Both callers are the JSON import: a `moduleKey` copied out of an uploaded
 * file, and the same key coming back as a form field. Neither is trustworthy,
 * and a flow filed under a module the studio does not run yet is a flow that
 * lands where the screen shows a "tez orada" notice instead of a list — created,
 * invisible, and impossible to explain.
 */
export function toAvailableModuleKey(value: string): ModuleKey {
  return AVAILABLE_MODULES.some((module) => module.key === value) ? (value as ModuleKey) : DEFAULT_MODULE_KEY;
}

/**
 * Where a module lives.
 *
 * The default module answers on the bot's own URL rather than on a second one
 * of its own: opening a bot used to land on a page of connection facts with the
 * flows one more click away, and the flows are what the owner came for.
 * `/bots/<id>/modules/dms` still renders the same screen — a link somebody
 * saved keeps working.
 */
export function moduleHref(botId: string, key: ModuleKey): string {
  return key === DEFAULT_MODULE_KEY ? `/bots/${botId}` : `/bots/${botId}/modules/${key}`;
}

/** Module names as a reader would say them: "Bot ichida, Business". */
export function moduleNames(modules: ModuleDefinition[]): string {
  return modules.map((module) => module.name).join(", ");
}

export function getModuleDefinition(key: ModuleKey): ModuleDefinition {
  const found = MODULE_DEFINITIONS.find((module) => module.key === key);
  if (!found) throw new Error(`Unknown module key: ${key}`);
  return found;
}
