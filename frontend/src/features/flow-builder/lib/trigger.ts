import type { IconName } from "@/components/ui/Icon";
import type {
  BusinessMatchKind,
  BusinessMediaKind,
  BusinessScheduleConfig,
  BusinessSignal,
  BusinessTriggerConfig,
  DmsTriggerConfig,
  DmsTriggerKind,
  FlowNode,
} from "@/features/flows";

/**
 * Keys line up with real Telegram Bot API signals — see https://core.telegram.org/bots/api#message
 *
 * `plainMessage` marks the kinds that are only a filter over a plain `message`
 * update. Those are exactly the ones "Istalgan xabar" already covers, so the
 * flag is what tells the UI which chips to lock. Signals that arrive as their
 * own update type (callback_query, message_reaction, my_chat_member) stay
 * independent of it.
 */
export interface TriggerKindMeta {
  key: DmsTriggerKind;
  label: string;
  api: string;
  plainMessage?: boolean;
  /**
   * Belongs to the module's main flow and is not offered anywhere else — see
   * `FlowRecord.isMain`. Still listed here so a block that already carries it
   * reads correctly rather than showing a blank condition.
   */
  reserved?: boolean;
}

export const CONDITION_KINDS: TriggerKindMeta[] = [
  {
    key: "start",
    label: "/start",
    api: "message.text = '/start', entities: bot_command",
    plainMessage: true,
    reserved: true,
  },
  { key: "command", label: "Buyruq", api: "message.entities: bot_command", plainMessage: true },
  { key: "keyword", label: "Kalit so'z", api: "message.text ichida qidiruv", plainMessage: true },
  { key: "any", label: "Istalgan xabar", api: "message" },
  { key: "callback", label: "Tugma bosilishi", api: "callback_query" },
];

export const MEDIA_KINDS: TriggerKindMeta[] = [
  { key: "photo", label: "Rasm", api: "message.photo", plainMessage: true },
  { key: "document", label: "Hujjat", api: "message.document", plainMessage: true },
  { key: "audio", label: "Audio", api: "message.audio", plainMessage: true },
  { key: "voice", label: "Ovozli xabar", api: "message.voice", plainMessage: true },
  { key: "video", label: "Video", api: "message.video", plainMessage: true },
  { key: "location", label: "Lokatsiya", api: "message.location", plainMessage: true },
  { key: "contact", label: "Kontakt", api: "message.contact", plainMessage: true },
];

export const EVENT_KINDS: TriggerKindMeta[] = [
  { key: "reaction", label: "Reaksiya", api: "message_reaction" },
  { key: "payment", label: "To'lov", api: "message.successful_payment", plainMessage: true },
  { key: "webapp", label: "Web App ma'lumoti", api: "message.web_app_data", plainMessage: true },
];

export const STATUS_KINDS: TriggerKindMeta[] = [
  { key: "blocked", label: "Bot bloklandi", api: "my_chat_member: status → kicked" },
  { key: "unblocked", label: "Bot blokdan chiqarildi", api: "my_chat_member: status → member" },
];

/** Canonical order — the card lists badges this way, whatever order the chips were clicked in. */
const ALL_KINDS: TriggerKindMeta[] = [...CONDITION_KINDS, ...MEDIA_KINDS, ...EVENT_KINDS, ...STATUS_KINDS];

const KIND_META = new Map<DmsTriggerKind, TriggerKindMeta>(ALL_KINDS.map((meta) => [meta.key, meta]));

export function triggerKindMeta(kind: DmsTriggerKind): TriggerKindMeta {
  return KIND_META.get(kind) ?? { key: kind, label: kind, api: kind };
}

/**
 * What an unconfigured Handler fires on, in the `dms` module. A command rather
 * than "/start": that one answers the module's main flow and is never handed
 * out to a block the author just dropped on the canvas.
 */
export const DEFAULT_DMS_KINDS: DmsTriggerKind[] = ["command"];

/** Every kind that "Istalgan xabar" makes redundant. */
export const SUBSUMED_BY_ANY = new Set<DmsTriggerKind>(
  ALL_KINDS.filter((item) => item.plainMessage).map((item) => item.key),
);

/* -------------------------------------------------------------------------- */
/* Families                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * One Handler answers one *kind* of entry: commands, keywords, media, and so
 * on. Families are what the inspector picks between, and what "Ajratish"
 * splits a mixed block along — a flow reads far better as four small Handlers
 * ("Buyruqlar", "Kalit so'zlar", "Media", "Zaxira") than as one block holding
 * every condition at once.
 *
 * The family is derived from the selected kinds rather than stored, so no
 * saved flow needs migrating and the two can never fall out of step.
 */
export type TriggerFamily = "command" | "keyword" | "media" | "event" | "status" | "any";

export interface TriggerFamilyMeta {
  key: TriggerFamily;
  label: string;
  /** Title given to a block that this family is split out into. */
  blockTitle: string;
  hint: string;
  icon: IconName;
  kinds: DmsTriggerKind[];
  /** Selected when the user switches a Handler to this family. */
  defaultKinds: DmsTriggerKind[];
  /**
   * Kept out of the picker, not out of the product. A hidden family's kinds
   * still match in the runtime and still render their own tab on a Handler
   * that already uses them — deleting the row instead would make every such
   * saved flow fall back to "Buyruqlar" and misdraw its config. Only *new*
   * Handlers can no longer choose it.
   *
   * Nothing sets it today. «Hodisalar» and «Bot holati» were hidden here while
   * the new-flow wizard went on offering both — "Tugma bosilganda" and "Bot
   * bloklanganda" — so a flow built there opened in an editor that could show
   * its condition and never offer it again, and the two halves of the product
   * disagreed about how many ways a flow can start. `DIRECT_KINDS` in
   * `apps/flows/services.py` matches all ten, so there was nothing behind the
   * hiding but the picker's own width. The field stays for the next family
   * that genuinely is not ready.
   */
  hidden?: boolean;
}

export const TRIGGER_FAMILIES: TriggerFamilyMeta[] = [
  {
    key: "command",
    label: "Buyruqlar",
    blockTitle: "Buyruqlar",
    // /start is not one of them any more — it is the main flow's own block.
    hint: "Mijoz yozadigan bot buyrug'i — /menyu, /narx va hokazo.",
    icon: "code",
    kinds: ["start", "command"],
    defaultKinds: ["command"],
  },
  {
    key: "keyword",
    label: "Kalit so'zlar",
    blockTitle: "Kalit so'zlar",
    hint: "Xabar matni bo'yicha qidiruv — aniq, ichida yoki regex.",
    icon: "text-aa",
    kinds: ["keyword"],
    defaultKinds: ["keyword"],
  },
  {
    key: "media",
    label: "Media",
    blockTitle: "Media",
    hint: "Kelgan xabar tarkibi: rasm, video, hujjat va boshqalar.",
    icon: "images",
    kinds: ["photo", "document", "audio", "voice", "video", "location", "contact"],
    defaultKinds: ["photo"],
  },
  {
    key: "event",
    label: "Hodisalar",
    blockTitle: "Hodisalar",
    hint: "Tugma bosilishi, reaksiya, to'lov, Web App ma'lumoti.",
    icon: "bell-ringing",
    kinds: ["callback", "reaction", "payment", "webapp"],
    defaultKinds: ["callback"],
  },
  {
    key: "status",
    label: "Bot holati",
    blockTitle: "Bot holati",
    hint: "Foydalanuvchi botni bloklaganda yoki blokdan chiqarganda.",
    icon: "robot",
    kinds: ["blocked", "unblocked"],
    defaultKinds: ["blocked"],
  },
  {
    key: "any",
    label: "Istalgan xabar",
    blockTitle: "Zaxira",
    hint: "Hech qaysi oqim ushlamagan xabarlar uchun zaxira.",
    icon: "chats-circle",
    kinds: ["any"],
    defaultKinds: ["any"],
  },
];

const FAMILY_OF_KIND = new Map<DmsTriggerKind, TriggerFamily>(
  TRIGGER_FAMILIES.flatMap((family) => family.kinds.map((kind) => [kind, family.key] as const)),
);

export function getTriggerFamily(key: TriggerFamily): TriggerFamilyMeta {
  return TRIGGER_FAMILIES.find((family) => family.key === key) ?? TRIGGER_FAMILIES[0]!;
}

export function familyOfKind(kind: DmsTriggerKind): TriggerFamily {
  return FAMILY_OF_KIND.get(kind) ?? "command";
}

/** The families a config spans, in `TRIGGER_FAMILIES` order. More than one means it is worth splitting. */
export function familiesOfKinds(kinds: DmsTriggerKind[]): TriggerFamily[] {
  const present = new Set(kinds.map(familyOfKind));
  return TRIGGER_FAMILIES.filter((family) => present.has(family.key)).map((family) => family.key);
}

export function dmsKinds(dms?: DmsTriggerConfig): DmsTriggerKind[] {
  return dms?.kinds?.length ? dms.kinds : DEFAULT_DMS_KINDS;
}

/**
 * The slice of a config that belongs to one family: its kinds, plus only the
 * detail fields those kinds actually read. Used both when the inspector
 * switches a Handler to another family (nothing of the old one lingers) and
 * when "Ajratish" cuts a mixed block into one block per family.
 */
export function triggerConfigForFamily(dms: DmsTriggerConfig | undefined, family: TriggerFamily): DmsTriggerConfig {
  const meta = getTriggerFamily(family);
  const kept = dmsKinds(dms).filter((kind) => meta.kinds.includes(kind));
  const config: DmsTriggerConfig = { kinds: kept.length ? kept : [...meta.defaultKinds] };
  if (config.kinds.includes("command") && dms?.command) config.command = dms.command;
  if (config.kinds.includes("keyword")) {
    if (dms?.keywords) config.keywords = dms.keywords;
    if (dms?.keywordMatch) config.keywordMatch = dms.keywordMatch;
    if (dms?.keywordFlags) config.keywordFlags = dms.keywordFlags;
  }
  return config;
}

/* -------------------------------------------------------------------------- */
/* Business (the `business` module's own trigger shape)                        */
/* -------------------------------------------------------------------------- */

/**
 * A business Handler answers one thing — a new message to the connected
 * account, from any of its chats — and two independent layers narrow it down,
 * each one a separate section of its inspector panel:
 *
 *  1. match    — what is inside the message
 *  2. schedule — whether it arrived inside the account's working hours
 *
 * Both are filters the runtime applies, which is why each has an accessor here
 * that supplies its default rather than a required field on the stored config.
 * A graph saved before a layer existed keeps working, and an untouched layer
 * stays out of the way.
 */

/**
 * The single Bot API update the module listens to. Not a choice any more — the
 * panel that offered five of them is gone, since the other four carried no
 * message the layers below could read — so this is a constant the summary and
 * the auto-title name it by rather than a list to pick from.
 */
export const BUSINESS_SIGNAL = {
  key: "new",
  label: "Yangi xabar",
  api: "business_message",
} as const satisfies { key: BusinessSignal; label: string; api: string };

/** The two layers, as addressable sections — what the summary line links to and the accordions group. */
export type BusinessSection = "match" | "schedule";

/* ----------------------------------- Match ---------------------------------- */

export interface BusinessMatchMeta {
  key: BusinessMatchKind;
  label: string;
  /** Title given to a Handler switched to this match kind while it still carries the default name. */
  blockTitle: string;
  hint: string;
  icon: IconName;
}

export const BUSINESS_MATCH_KINDS: BusinessMatchMeta[] = [
  {
    key: "any",
    label: "Hammasi",
    blockTitle: "Barcha xabarlar",
    hint: "Mijozdan kelgan har qanday xabar — zaxira oqim uchun.",
    icon: "chats-circle",
  },
  {
    key: "keyword",
    label: "Kalit so'z",
    blockTitle: "Kalit so'zlar",
    hint: "Xabar matni bo'yicha qidiruv — aniq, ichida yoki regex.",
    icon: "text-aa",
  },
  {
    key: "command",
    label: "Buyruq",
    blockTitle: "Buyruq",
    hint: "Mijoz «/» bilan boshlanadigan buyruq yozganda.",
    icon: "code",
  },
  {
    key: "media",
    label: "Media",
    blockTitle: "Media",
    hint: "Xabar tarkibi: rasm, video, ovozli xabar, hujjat va boshqalar.",
    icon: "images",
  },
];

export function getBusinessMatch(key: BusinessMatchKind): BusinessMatchMeta {
  return BUSINESS_MATCH_KINDS.find((meta) => meta.key === key) ?? BUSINESS_MATCH_KINDS[0]!;
}

export function businessMatch(business?: BusinessTriggerConfig): BusinessMatchKind {
  return business?.match ?? "any";
}

export const BUSINESS_MEDIA_KINDS: { key: BusinessMediaKind; label: string; api: string }[] = [
  { key: "photo", label: "Rasm", api: "message.photo" },
  { key: "video", label: "Video", api: "message.video" },
  { key: "voice", label: "Ovozli", api: "message.voice" },
  { key: "audio", label: "Audio", api: "message.audio" },
  { key: "document", label: "Hujjat", api: "message.document" },
  { key: "location", label: "Lokatsiya", api: "message.location" },
  { key: "contact", label: "Kontakt", api: "message.contact" },
];

export const DEFAULT_BUSINESS_MEDIA_KINDS: BusinessMediaKind[] = ["photo"];

export function businessMediaKinds(business?: BusinessTriggerConfig): BusinessMediaKind[] {
  return business?.mediaKinds?.length ? business.mediaKinds : DEFAULT_BUSINESS_MEDIA_KINDS;
}

function businessMediaLabel(key: BusinessMediaKind): string {
  return BUSINESS_MEDIA_KINDS.find((meta) => meta.key === key)?.label ?? key;
}

/** The command name without its leading slash, however it was typed. */
export function businessCommandName(business?: BusinessTriggerConfig): string {
  return (business?.command ?? "").replace(/^\/+/, "");
}

/**
 * Switching the match kind. The working-hours layer is untouched, and the
 * *other* kinds' detail fields are kept rather than dropped:
 * a keyword list typed out over five minutes must survive a look at what
 * "Buyruq" offers. Only the active kind is ever read — by the summary, the
 * conflict signatures and the runtime — so a parked list changes nothing while
 * it waits, and `businessMatchHoldsValue` is what tells the picker to mark it.
 */
export function businessConfigForMatch(
  business: BusinessTriggerConfig | undefined,
  match: BusinessMatchKind,
): BusinessTriggerConfig {
  const base = business ?? createBusinessTrigger();
  const next: BusinessTriggerConfig = { ...base, match };
  // The newly chosen kind starts from its default rather than from `undefined`,
  // so the fields below it are controlled from the first render.
  if (match === "command") next.command = base.command ?? "";
  if (match === "keyword") {
    next.keywords = base.keywords ?? "";
    next.keywordMatch = base.keywordMatch ?? "contains";
    next.keywordFlags = base.keywordFlags ?? "i";
  }
  if (match === "media") next.mediaKinds = [...businessMediaKinds(base)];
  return next;
}

/**
 * Whether a match kind still holds what was typed into it — asked of every
 * kind, chosen or not, so the picker can mark the ones a look elsewhere would
 * appear to have thrown away.
 */
export function businessMatchHoldsValue(business: BusinessTriggerConfig | undefined, match: BusinessMatchKind): boolean {
  if (!business) return false;
  if (match === "command") return businessCommandName(business).length > 0;
  if (match === "keyword") return keywordTerms(business.keywords).length > 0;
  if (match === "media") return (business.mediaKinds?.length ?? 0) > 0;
  return false;
}

/* --------------------------------- Schedule --------------------------------- */

/** ISO weekday numbering — 1 = Monday … 7 = Sunday, the order the picker paints. */
export const BUSINESS_WEEKDAYS: { value: number; short: string; label: string }[] = [
  { value: 1, short: "Du", label: "Dushanba" },
  { value: 2, short: "Se", label: "Seshanba" },
  { value: 3, short: "Ch", label: "Chorshanba" },
  { value: 4, short: "Pa", label: "Payshanba" },
  { value: 5, short: "Ju", label: "Juma" },
  { value: 6, short: "Sh", label: "Shanba" },
  { value: 7, short: "Ya", label: "Yakshanba" },
];

const WORKWEEK = [1, 2, 3, 4, 5];

/** Zones the studio's users actually keep office hours in, plus UTC as the neutral fallback. */
export const BUSINESS_TIMEZONES: { value: string; label: string }[] = [
  { value: "Asia/Tashkent", label: "Toshkent · UTC+5" },
  { value: "Asia/Almaty", label: "Almati · UTC+5" },
  { value: "Asia/Dubai", label: "Dubay · UTC+4" },
  { value: "Europe/Moscow", label: "Moskva · UTC+3" },
  { value: "Europe/Istanbul", label: "Istanbul · UTC+3" },
  { value: "Europe/London", label: "London · UTC+0/+1" },
  { value: "UTC", label: "UTC" },
];

export const DEFAULT_BUSINESS_SCHEDULE: BusinessScheduleConfig = {
  mode: "always",
  days: [...WORKWEEK],
  from: "09:00",
  to: "18:00",
  timezone: "Asia/Tashkent",
};

export function businessSchedule(business?: BusinessTriggerConfig): BusinessScheduleConfig {
  const saved = business?.schedule;
  if (!saved) return DEFAULT_BUSINESS_SCHEDULE;
  return {
    mode: saved.mode ?? "always",
    days: saved.days?.length ? saved.days : DEFAULT_BUSINESS_SCHEDULE.days,
    from: saved.from || DEFAULT_BUSINESS_SCHEDULE.from,
    to: saved.to || DEFAULT_BUSINESS_SCHEDULE.to,
    timezone: saved.timezone || DEFAULT_BUSINESS_SCHEDULE.timezone,
  };
}

/** Whether the window actually narrows anything — "always" keeps its fields but applies none of them. */
export function isBusinessScheduled(business?: BusinessTriggerConfig): boolean {
  return businessSchedule(business).mode !== "always";
}

/** Minutes since midnight for an "HH:MM" string; 0 for anything unparseable. */
export function minutesOfDay(time: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!match) return 0;
  return Math.min(23, Number(match[1])) * 60 + Math.min(59, Number(match[2]));
}

const WEEKDAY_INDEX: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/**
 * The weekday and wall-clock minute an instant lands on *in the window's own
 * zone*. The office is open 09:00 Tashkent time whoever is looking at the
 * editor, so the comparison can never be done against the viewer's clock.
 */
function zonedParts(at: Date, timezone: string): { weekday: number; minutes: number } {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      // h23 rather than hour12:false — the latter still reports midnight as "24" in some engines.
      hourCycle: "h23",
    }).formatToParts(at);
    const read = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
    return {
      weekday: WEEKDAY_INDEX[read("weekday")] ?? 1,
      minutes: Number(read("hour")) * 60 + Number(read("minute")),
    };
  } catch {
    // An unknown zone should not take the whole panel down with it.
    return { weekday: ((at.getDay() + 6) % 7) + 1, minutes: at.getHours() * 60 + at.getMinutes() };
  }
}

/**
 * Whether an instant falls inside the window itself, before the mode is
 * applied. A `to` earlier than `from` is a night shift: its tail past midnight
 * still belongs to the day the window opened on, which is why the wrap case
 * checks the previous day's selection rather than today's.
 */
export function isWithinBusinessWindow(schedule: BusinessScheduleConfig, at: Date): boolean {
  const { weekday, minutes } = zonedParts(at, schedule.timezone);
  const from = minutesOfDay(schedule.from);
  const to = minutesOfDay(schedule.to);
  if (from === to) return schedule.days.includes(weekday);
  if (from < to) return schedule.days.includes(weekday) && minutes >= from && minutes < to;
  const previousDay = weekday === 1 ? 7 : weekday - 1;
  return (
    (schedule.days.includes(weekday) && minutes >= from) || (schedule.days.includes(previousDay) && minutes < to)
  );
}

/** Whether a Handler carrying this window would fire on an update arriving at `at`. */
export function isBusinessHandlerOpenAt(schedule: BusinessScheduleConfig, at: Date): boolean {
  if (schedule.mode === "always") return true;
  const inside = isWithinBusinessWindow(schedule, at);
  return schedule.mode === "inside" ? inside : !inside;
}

function sameSet(days: number[], other: number[]): boolean {
  return days.length === other.length && other.every((day) => days.includes(day));
}

/** "Har kuni" / "Ish kunlari" / "Du–Ju" / "Du, Ch, Ju" — whichever reads shortest for the selection. */
export function summarizeBusinessDays(days: number[]): string {
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  if (!sorted.length) return "Kun tanlanmagan";
  if (sorted.length === 7) return "Har kuni";
  if (sameSet(sorted, WORKWEEK)) return "Ish kunlari";
  if (sameSet(sorted, [6, 7])) return "Dam olish";
  const short = (value: number) => BUSINESS_WEEKDAYS.find((day) => day.value === value)?.short ?? String(value);
  const contiguous = sorted.every((day, index) => index === 0 || day === sorted[index - 1]! + 1);
  if (contiguous && sorted.length > 2) return `${short(sorted[0]!)}–${short(sorted[sorted.length - 1]!)}`;
  return sorted.map(short).join(", ");
}

/** A window whose end is before its start runs past midnight into the next day. */
export function businessWindowCrossesMidnight(schedule: BusinessScheduleConfig): boolean {
  return minutesOfDay(schedule.to) < minutesOfDay(schedule.from);
}

/**
 * The two ways a window says something other than what it looks like, both of
 * them arrived at by typing rather than by choosing:
 *
 *  · start == end is the whole 24 hours, not an empty window — which makes
 *    "Tashqari" a Handler that can never fire, the single worst state this
 *    panel can be left in silently.
 *  · a window that ends before it starts is a night shift; the tail after
 *    midnight belongs to the day it opened on.
 */
export function businessWindowNote(schedule: BusinessScheduleConfig): { tone: "warn" | "info"; text: string } | null {
  if (schedule.mode === "always") return null;
  if (minutesOfDay(schedule.from) === minutesOfDay(schedule.to)) {
    return {
      tone: "warn",
      text:
        schedule.mode === "inside"
          ? "Boshlanish va tugash vaqti bir xil — oraliq butun sutkani qamrab oladi, ya'ni «Doim» bilan bir xil ishlaydi."
          : "Boshlanish va tugash vaqti bir xil — oraliq butun sutkani qamrab oladi, shuning uchun bu blok hech qachon ishga tushmaydi.",
    };
  }
  if (businessWindowCrossesMidnight(schedule)) {
    return {
      tone: "info",
      text: `Oraliq yarim tundan o'tadi — ${schedule.from} dan ertasi kuni ${schedule.to} gacha davom etadi.`,
    };
  }
  return null;
}

/* --------------------------------- Defaults --------------------------------- */

export function createBusinessTrigger(): BusinessTriggerConfig {
  return {
    messageTypes: [BUSINESS_SIGNAL.key],
    match: "any",
  };
}

/* -------------------------------------------------------------------------- */
/* Card summary                                                                */
/* -------------------------------------------------------------------------- */

/** One clause of a `dms` Handler's condition, as the card lists them. */
export interface TriggerBadge {
  key: string;
  label: string;
}

/** The keyword terms, one per line, blanks dropped. */
export function keywordTerms(keywords?: string): string[] {
  return (keywords ?? "")
    .split("\n")
    .map((term) => term.trim())
    .filter(Boolean);
}

/** The command name without its leading slash, however it was typed. */
export function commandName(dms?: DmsTriggerConfig): string {
  return (dms?.command ?? "").replace(/^\/+/, "");
}

/**
 * The badge text for one selected kind. Three of them carry the user's own
 * input — the badge shows that, not the generic chip label, because "/menu"
 * is what the block actually reacts to.
 */
function dmsBadgeLabel(meta: TriggerKindMeta, dms?: DmsTriggerConfig): string {
  if (meta.key === "command") {
    const command = commandName(dms);
    return command ? `/${command}` : meta.label;
  }
  if (meta.key === "keyword") {
    const terms = keywordTerms(dms?.keywords);
    if (!terms.length) return meta.label;
    return terms.length > 1 ? `«${terms[0]}» +${terms.length - 1}` : `«${terms[0]}»`;
  }
  return meta.label;
}

export function summarizeDmsTrigger(dms?: DmsTriggerConfig): TriggerBadge[] {
  const kinds = dmsKinds(dms);
  return ALL_KINDS.filter((meta) => kinds.includes(meta.key)).map((meta) => ({
    key: meta.key,
    label: dmsBadgeLabel(meta, dms),
  }));
}

/**
 * What the match layer is looking for, in the user's own words — «narx» rather
 * than "Kalit so'z", because the term is what the block actually reacts to.
 */
export function businessMatchLabel(business?: BusinessTriggerConfig): string {
  const match = businessMatch(business);
  if (match === "command") {
    const command = businessCommandName(business);
    return command ? `/${command}` : "Buyruq";
  }
  if (match === "keyword") {
    const terms = keywordTerms(business?.keywords);
    if (!terms.length) return "Kalit so'z";
    return terms.length > 1 ? `«${terms[0]}» +${terms.length - 1}` : `«${terms[0]}»`;
  }
  if (match === "media") {
    const kinds = businessMediaKinds(business);
    const first = businessMediaLabel(kinds[0]!);
    return kinds.length > 1 ? `${first} +${kinds.length - 1}` : first;
  }
  return "Istalgan xabar";
}

/* -------------------------------------------------------------------------- */
/* Summary line                                                                */
/* -------------------------------------------------------------------------- */

/**
 * One clause of the Handler read as a sentence. Every layer contributes
 * exactly one, whether or not it was touched, so the line has a fixed shape
 * you can learn: content, then hours.
 *
 * `changed` is what separates a decision from a default. It drives the tone the
 * clause is painted in and which clauses survive onto the canvas card — an
 * untouched layer is true but not worth reading twice.
 */
export interface BusinessSummaryPart {
  key: string;
  section: BusinessSection;
  label: string;
  changed: boolean;
}

/** The whole Handler as clauses, in the order the runtime applies them. */
export function businessSummaryParts(business?: BusinessTriggerConfig): BusinessSummaryPart[] {
  const match = businessMatch(business);
  const parts: BusinessSummaryPart[] = [
    {
      key: "match",
      section: "match",
      label: match === "any" ? "istalgan tarkib" : `${businessMatchLabel(business)} bo'lsa`,
      changed: match !== "any",
    },
  ];

  const schedule = businessSchedule(business);
  const window = `${summarizeBusinessDays(schedule.days)} ${schedule.from}–${schedule.to}`;
  parts.push({
    key: "schedule",
    section: "schedule",
    label:
      schedule.mode === "always"
        ? "doim"
        : schedule.mode === "inside"
          ? `${window} oralig'ida`
          : `${window} dan tashqarida`,
    changed: schedule.mode !== "always",
  });

  return parts;
}

/** Only the layers the user actually moved — the chips the docked panel lists. */
export function businessChangedParts(business?: BusinessTriggerConfig): BusinessSummaryPart[] {
  return businessSummaryParts(business).filter((part) => part.changed);
}

function sentenceCase(text: string): string {
  return text ? text[0]!.toUpperCase() + text.slice(1) : text;
}

/**
 * The whole Handler as one sentence, for the inspector's summary line — the
 * update it answers, then the two layers in the order they are applied.
 */
export function describeBusinessTrigger(business?: BusinessTriggerConfig): string {
  const parts = businessSummaryParts(business);
  return `${BUSINESS_SIGNAL.label}: ${parts.map((part) => part.label).join(", ")} — shu holatda ishga tushadi.`;
}

/**
 * The same sentence with the untouched layers dropped. What the canvas card
 * paints: a configured Handler reads as prose, and one nobody has narrowed
 * falls back to the update it answers rather than reciting defaults nobody
 * chose.
 */
export function businessCardSummary(business?: BusinessTriggerConfig): string {
  const changed = businessChangedParts(business);
  return changed.length ? sentenceCase(changed.map((part) => part.label).join(", ")) : BUSINESS_SIGNAL.label;
}

/**
 * How many narrowing settings a section carries — the badge on its header, and
 * what a folded accordion has to keep visible so nothing hides behind it.
 */
export function businessSectionCount(business: BusinessTriggerConfig | undefined, section: BusinessSection): number {
  if (section === "match") return businessMatch(business) !== "any" ? 1 : 0;
  return businessSchedule(business).mode === "always" ? 0 : 1;
}

/**
 * The name a Handler would carry if nobody typed one — "Yangi xabar · /start".
 * Offered as the title field's placeholder rather than written into the node:
 * a generated name that quietly becomes a stored one is a name nobody can tell
 * they are allowed to change.
 */
export function businessAutoTitle(business?: BusinessTriggerConfig): string {
  if (businessMatch(business) === "any") return BUSINESS_SIGNAL.label;
  return `${BUSINESS_SIGNAL.label} · ${businessMatchLabel(business)}`;
}

/* -------------------------------------------------------------------------- */
/* Validation                                                                  */
/* -------------------------------------------------------------------------- */

export interface BusinessIssue {
  section: BusinessSection;
  /** An error is a configuration that cannot mean what it says; a warning still runs. */
  level: "error" | "warning";
  message: string;
}

/**
 * What is wrong with a Handler right now. Pure, so the docked panel, the
 * section header and the expanded editor all read the same list instead of
 * passing validation state between themselves.
 */
export function businessTriggerIssues(business?: BusinessTriggerConfig): BusinessIssue[] {
  const note = businessWindowNote(businessSchedule(business));
  return note?.tone === "warn" ? [{ section: "schedule", level: "warning", message: note.text }] : [];
}

/**
 * What a Handler card says it fires on, as the sentence the editor shows rather
 * than as tags. Two or three tags out of five could always be read as the whole
 * story; a clause that ends in "…" cannot, and the same words on the card and
 * in the editor mean one thing has to be learned instead of two.
 *
 * Which config a Handler carries follows from its module (see `NodeFields`),
 * and the node itself says which one it got, so this stays a pure function of
 * the node: the card and the card's measured width can never disagree. An
 * empty string is its own state — no config at all, which the card says rather
 * than claiming the default the editor would offer.
 */
export function triggerCardSummary(node: FlowNode): string {
  if (node.business) return businessCardSummary(node.business);
  if (!node.dmsTrigger) return "";
  return summarizeDmsTrigger(node.dmsTrigger)
    .map((badge) => badge.label)
    .join(" · ");
}

/**
 * What this Handler will actually claim, where that is more than its author
 * meant. One sentence per problem, empty when the trigger is finished.
 *
 * The one that matters is an unwritten command. `matching.matches` on the
 * backend reads an empty `command` as "any command at all" — the same reading
 * an empty media list gets — so a «Buyruqlar» block nobody finished does not
 * sit quiet, it takes every command in the bot. An audit found exactly that in
 * a live clinic flow, and read it the other way round: the flow looked dead
 * because the block it answered with was not the one anybody expected.
 *
 * The index now sorts such a block as a catch-all so a written command still
 * wins (see `_dms_kind_priority`). This is the other half — saying so on the
 * card, before it is switched on.
 */
export function triggerIssues(node: FlowNode): string[] {
  const issues: string[] = [];
  const business = node.business;
  const dms = node.dmsTrigger;

  const command = ((business ? business.command : dms?.command) ?? "").trim();
  const keywords = ((business ? business.keywords : dms?.keywords) ?? "").trim();

  const wantsCommand = business ? businessMatch(business) === "command" : !!dms?.kinds.includes("command");
  const wantsKeyword = business ? businessMatch(business) === "keyword" : !!dms?.kinds.includes("keyword");

  if (wantsCommand && !command) {
    issues.push("Buyruq nomi yozilmagan — bu blok botdagi barcha buyruqlarni ushlaydi.");
  }
  if (wantsKeyword && !keywords) {
    issues.push("Kalit so'z yozilmagan — bu blok hech qachon ishga tushmaydi.");
  }
  return issues;
}

/* -------------------------------------------------------------------------- */
/* Priority                                                                    */
/* -------------------------------------------------------------------------- */

/** Matched the update exactly — an explicit command, an exact keyword, or its own update type. */
export const PRIORITY_EXACT = 1;
/** Matched part of the update — a keyword search, or a filter over the message's content type. */
export const PRIORITY_PARTIAL = 2;
/** The fallback that takes whatever no other Handler claimed. */
export const PRIORITY_CATCH_ALL = 3;

export const MIN_PRIORITY = 1;
export const MAX_PRIORITY = 99;

export const PRIORITY_LEVEL_LABEL: Record<number, string> = {
  [PRIORITY_EXACT]: "Aniq moslik",
  [PRIORITY_PARTIAL]: "Qisman moslik",
  [PRIORITY_CATCH_ALL]: "Zaxira (catch-all)",
};

/**
 * Kinds that carry their own Bot API update (callback_query, message_reaction,
 * my_chat_member…) are exact matches: nothing else in the flow can claim the
 * same update, so they belong at the top with "/start".
 */
const PARTIAL_KINDS = new Set<DmsTriggerKind>([
  "photo",
  "document",
  "audio",
  "voice",
  "video",
  "location",
  "contact",
]);

function kindPriority(kind: DmsTriggerKind, dms?: DmsTriggerConfig): number {
  if (kind === "any") return PRIORITY_CATCH_ALL;
  if (kind === "keyword") return (dms?.keywordMatch ?? "contains") === "exact" ? PRIORITY_EXACT : PRIORITY_PARTIAL;
  return PARTIAL_KINDS.has(kind) ? PRIORITY_PARTIAL : PRIORITY_EXACT;
}

/** The same ladder as `kindPriority`, read off the business Handler's match layer. */
function businessMatchPriority(business: BusinessTriggerConfig): number {
  switch (businessMatch(business)) {
    case "command":
      return PRIORITY_EXACT;
    case "keyword":
      return (business.keywordMatch ?? "contains") === "exact" ? PRIORITY_EXACT : PRIORITY_PARTIAL;
    case "media":
      return PRIORITY_PARTIAL;
    default:
      return PRIORITY_CATCH_ALL;
  }
}

/**
 * A business Handler's level, read off its match layer the same way a `dms`
 * one is read off its kinds.
 *
 * A working-hours window then moves the block one level closer to the front,
 * because a Handler that only claims part of the day is strictly more specific
 * than the same one without a window. That single rule is what makes the
 * everyday setup order itself correctly: an after-hours autoreply (catch-all,
 * outside 09:00–18:00 → #2) runs ahead of the plain catch-all (#3), and steps
 * aside for the «narx» keyword block (#2 → #1 with a window) all the same.
 */
function businessPriority(business: BusinessTriggerConfig): number {
  const base = businessMatchPriority(business);
  return isBusinessScheduled(business) ? Math.max(PRIORITY_EXACT, base - 1) : base;
}

/**
 * Where a Handler sits when several of them match the same update, derived
 * from what it listens to. A block holding conditions of different levels
 * takes the most specific one it has — it really can match that exactly — and
 * the inspector nudges it to be split so each half gets its own honest level.
 */
export function autoPriority(node: FlowNode): number {
  if (node.business) return businessPriority(node.business);
  const dms = node.dmsTrigger;
  return dmsKinds(dms).reduce((best, kind) => Math.min(best, kindPriority(kind, dms)), PRIORITY_CATCH_ALL);
}

/** The number the runtime sorts by: the user's override when set, the derived level otherwise. */
export function effectivePriority(node: FlowNode): number {
  return node.priority ?? autoPriority(node);
}

export function isPriorityOverridden(node: FlowNode): boolean {
  return node.priority !== undefined;
}

export interface HandlerOrderEntry {
  id: string;
  title: string;
  priority: number;
  overridden: boolean;
}

/**
 * Every Handler in the flow in the order the runtime will try them. A priority
 * number is a position in a queue, and a number on its own cannot show a
 * position — this is the queue it belongs to, so "#2" can be read as "after the
 * /start block, before the catch-all".
 *
 * Ties keep their canvas order: two Handlers on the same level are genuinely
 * unordered, and inventing a tiebreak here would make the list claim otherwise.
 */
export function handlerOrder(nodes: FlowNode[]): HandlerOrderEntry[] {
  return nodes
    .filter(isHandlerNode)
    .map((node, index) => ({
      id: node.id,
      title: node.title.trim() || "Boshlanish sharti",
      priority: effectivePriority(node),
      overridden: isPriorityOverridden(node),
      index,
    }))
    .sort((a, b) => a.priority - b.priority || a.index - b.index)
    .map(({ index: _index, ...entry }) => entry);
}

/* -------------------------------------------------------------------------- */
/* Conflicts                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * A signature is one concrete thing a Handler answers — "/start", the keyword
 * «narx», an incoming photo. Two Handlers that share one are racing for the
 * same update, which is what the canvas warns about.
 */
/** One entry per concrete thing the match layer claims — a keyword list claims each term separately. */
function businessMatchSignatures(business: BusinessTriggerConfig): { id: string; label: string }[] {
  switch (businessMatch(business)) {
    case "command": {
      const command = businessCommandName(business);
      // An empty command name claims nothing yet, so it races nobody.
      return command ? [{ id: `cmd:${command.toLowerCase()}`, label: `/${command}` }] : [];
    }
    case "keyword": {
      const mode = business.keywordMatch ?? "contains";
      return keywordTerms(business.keywords).map((term) => ({
        id: `kw:${mode}:${term.toLowerCase()}`,
        label: `«${term}»`,
      }));
    }
    case "media":
      return businessMediaKinds(business).map((kind) => ({ id: `media:${kind}`, label: businessMediaLabel(kind) }));
    default:
      return [{ id: "any", label: "Istalgan xabar" }];
  }
}

/**
 * The scope a signature is claimed *within*. Two Handlers watching different
 * halves of the day never race each other however alike their match layers
 * look — folding the window into the id is what keeps the warning about real
 * collisions instead of about a normal inbox setup.
 */
function businessScopeSignature(business: BusinessTriggerConfig): string {
  const schedule = businessSchedule(business);
  return schedule.mode === "always"
    ? "always"
    : `${schedule.mode}:${[...schedule.days].sort((a, b) => a - b).join("")}:${schedule.from}-${schedule.to}:${schedule.timezone}`;
}

function triggerSignatures(node: FlowNode): { id: string; label: string }[] {
  if (node.business) {
    const business = node.business;
    const scope = businessScopeSignature(business);
    return businessMatchSignatures(business).map((match) => ({
      id: `biz:${match.id}:${scope}`,
      label: match.label,
    }));
  }

  const dms = node.dmsTrigger;
  const signatures: { id: string; label: string }[] = [];
  for (const kind of dmsKinds(dms)) {
    if (kind === "start") {
      signatures.push({ id: "cmd:start", label: "/start" });
    } else if (kind === "command") {
      const command = commandName(dms);
      if (command) signatures.push({ id: `cmd:${command.toLowerCase()}`, label: `/${command}` });
    } else if (kind === "keyword") {
      const match = dms?.keywordMatch ?? "contains";
      for (const term of keywordTerms(dms?.keywords)) {
        signatures.push({ id: `kw:${match}:${term.toLowerCase()}`, label: `«${term}»` });
      }
    } else {
      signatures.push({ id: `kind:${kind}`, label: triggerKindMeta(kind).label });
    }
  }
  return signatures;
}

export function isHandlerNode(node: FlowNode): boolean {
  return node.type === "trigger";
}

/**
 * Handlers in this flow that answer the exact same thing, keyed by node id.
 * Overlap alone is not a conflict — a specific Handler is *supposed* to sit in
 * front of a catch-all, and the priority levels say which wins. Two blocks
 * claiming the identical signature is the case no priority can settle, so that
 * is what gets flagged.
 */
export function findTriggerConflicts(nodes: FlowNode[]): Map<string, string[]> {
  const owners = new Map<string, { nodeId: string; label: string }[]>();
  for (const node of nodes) {
    if (!isHandlerNode(node)) continue;
    for (const signature of triggerSignatures(node)) {
      const list = owners.get(signature.id) ?? [];
      list.push({ nodeId: node.id, label: signature.label });
      owners.set(signature.id, list);
    }
  }

  const conflicts = new Map<string, string[]>();
  for (const list of owners.values()) {
    if (list.length < 2) continue;
    for (const entry of list) {
      const reasons = conflicts.get(entry.nodeId) ?? [];
      reasons.push(`${entry.label} — ${list.length} ta handlerda takrorlangan`);
      conflicts.set(entry.nodeId, reasons);
    }
  }
  return conflicts;
}
