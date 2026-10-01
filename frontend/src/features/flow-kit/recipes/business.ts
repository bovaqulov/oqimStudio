import { BUSINESS_MEDIA_KINDS, BUSINESS_TIMEZONES } from "@/features/flow-builder/lib/trigger";
import type { BusinessMediaKind, BusinessScheduleMode, BusinessTriggerConfig } from "@/features/flows";
import {
  choiceLabel,
  describeDays,
  describeTerms,
  formatTimeRange,
  readDays,
  readList,
  readText,
  readTimeRange,
  WEEKDAY_CHOICES,
} from "../lib/inputs";
import type { ModuleKit, RecipeInput, RecipeValues, TriggerRecipe } from "../types";
import { aiAction, delayAction, notifyAction, replyAction, tagAction } from "./common";

/**
 * The `business` module's kit: what a personal Telegram account can react to,
 * and what the bot may do about it.
 *
 * Everything here answers one Bot API update — `business_message`, a client
 * writing to the connected account — so a trigger is never a choice of *event*
 * but of *which* messages to claim: the hours they arrived in, a keyword, a
 * command, an attachment, or being the first message of a new customer.
 */

/* -------------------------------------------------------------------------- */
/* Shared trigger inputs                                                      */
/* -------------------------------------------------------------------------- */

const DAYS_INPUT: RecipeInput = {
  key: "days",
  kind: "days",
  label: "Ish kunlari",
  hint: "Ish vaqti qaysi kunlarga tegishli.",
  required: true,
  default: ["1", "2", "3", "4", "5"],
};

const HOURS_INPUT: RecipeInput = {
  key: "hours",
  kind: "time-range",
  label: "Ish vaqti",
  hint: "Tugash vaqti boshlanishdan oldin bo'lsa, oraliq yarim tundan o'tadi (tungi smena).",
  required: true,
  default: "09:00-18:00",
};

const TIMEZONE_INPUT: RecipeInput = {
  key: "timezone",
  kind: "choice",
  label: "Vaqt mintaqasi",
  hint: "Ish vaqti shu mintaqa bo'yicha o'lchanadi — kim qarayotganidan qat'i nazar.",
  choices: BUSINESS_TIMEZONES.map((zone) => ({ value: zone.value, label: zone.label })),
  default: "Asia/Tashkent",
};

const SCHEDULE_INPUTS = [DAYS_INPUT, HOURS_INPUT, TIMEZONE_INPUT];

/** The window the author drew, as the trigger layer's own config shape. */
function scheduleFrom(values: RecipeValues, mode: BusinessScheduleMode) {
  const range = readTimeRange(values, "hours");
  return {
    mode,
    days: readDays(values, "days"),
    from: range.from,
    to: range.to,
    timezone: readText(values, "timezone") || "Asia/Tashkent",
  };
}

function businessConfig(config: Partial<BusinessTriggerConfig>): BusinessTriggerConfig {
  return { messageTypes: ["new"], match: "any", ...config };
}

/* -------------------------------------------------------------------------- */
/* Triggers                                                                    */
/* -------------------------------------------------------------------------- */

/** The two halves of the day, built from one description so they can never disagree. */
function scheduleTrigger(mode: "outside" | "inside"): TriggerRecipe {
  const outside = mode === "outside";
  return {
    key: outside ? "after_hours" : "working_hours",
    label: outside ? "Ish vaqtidan tashqari" : "Ish vaqti ichida",
    description: outside
      ? "Ish kuni tugagach, dam olish kunlari yoki tunda kelgan xabar."
      : "Faqat ish vaqtida kelgan xabar — tashqarida boshqa oqim javob beradi.",
    icon: outside ? "moon" : "sun",
    inputs: SCHEDULE_INPUTS,
    summary: (values) => {
      const days = readDays(values, "days");
      // With no weekday ticked the window matches nothing, and the line read
      // "Kun tanlanmagan 09:00–18:00 dan tashqarida…" — a missing answer glued in
      // front of a real-looking schedule. It now says only what is missing.
      if (!days.length) return "Ish kunlari tanlanmagan";
      const window = `${describeDays(days)} ${formatTimeRange(readTimeRange(values, "hours"))}`;
      return outside ? `${window} dan tashqarida xabar kelganda` : `${window} oralig'ida xabar kelganda`;
    },
    build: (values) => [
      {
        type: "trigger",
        title: outside ? "Ish vaqtidan tashqari" : "Ish vaqti ichida",
        text: outside ? "Ish vaqtidan tashqarida kelgan xabar" : "Ish vaqtida kelgan xabar",
        business: businessConfig({ schedule: scheduleFrom(values, mode) }),
      },
    ],
  };
}

const KEYWORD_MATCH_INPUT: RecipeInput = {
  key: "match",
  kind: "choice",
  label: "Qanday solishtirilsin",
  choices: [
    { value: "contains", label: "Ichida bo'lsa", hint: "«narx» so'zi gap ichida kelsa ham ishlaydi" },
    { value: "exact", label: "Aynan shu bo'lsa", hint: "Xabar faqat shu so'zdan iborat bo'lsa" },
  ],
  default: "contains",
};

const keywordTrigger: TriggerRecipe = {
  key: "keyword",
  label: "Kalit so'z aytilganda",
  description: "Mijoz xabarida shu so'zlardan biri bo'lsa ishga tushadi.",
  icon: "text-aa",
  inputs: [
    {
      key: "keywords",
      kind: "keywords",
      label: "Kalit so'zlar",
      hint: "Har birini alohida qo'shing. Bittasi mos kelsa yetarli.",
      placeholder: "narx",
      required: true,
      default: [],
    },
    KEYWORD_MATCH_INPUT,
  ],
  // `describeTerms([])` is an em dash: an empty list rendered "Xabarda — bo'lsa".
  summary: (values) => {
    const keywords = readList(values, "keywords");
    return keywords.length ? `Xabarda ${describeTerms(keywords)} bo'lsa` : "Kalit so'z yozilmagan";
  },
  build: (values) => [
    {
      type: "trigger",
      title: "Kalit so'z",
      text: "Xabarda kalit so'z bo'lganda",
      business: businessConfig({
        match: "keyword",
        keywords: readList(values, "keywords").join("\n"),
        keywordMatch: readText(values, "match") === "exact" ? "exact" : "contains",
      }),
    },
  ],
};

const commandTrigger: TriggerRecipe = {
  key: "command",
  label: "Buyruq yozilganda",
  description: "Mijoz «/» bilan boshlanadigan buyruq yuborsa.",
  icon: "code",
  inputs: [
    {
      key: "command",
      kind: "text",
      label: "Buyruq nomi",
      hint: "«/» belgisisiz yozing — masalan narx.",
      placeholder: "narx",
      required: true,
      default: "",
    },
  ],
  // An empty field used to read "/buyruq yozilganda", which looked like a real
  // command rather than a question still open.
  summary: (values) => {
    const command = readText(values, "command").replace(/^\/+/, "");
    return command ? `/${command} yozilganda` : "Buyruq nomi yozilmagan";
  },
  build: (values) => [
    {
      type: "trigger",
      title: "Buyruq",
      text: "Buyruq yozilganda",
      business: businessConfig({ match: "command", command: readText(values, "command").replace(/^\/+/, "") }),
    },
  ],
};

const MEDIA_INPUT: RecipeInput = {
  key: "kinds",
  kind: "chips",
  label: "Xabar turi",
  hint: "Kamida bittasini tanlang.",
  required: true,
  choices: BUSINESS_MEDIA_KINDS.map((kind) => ({ value: kind.key, label: kind.label })),
  default: ["photo"],
};

const mediaTrigger: TriggerRecipe = {
  key: "media",
  label: "Rasm, fayl yoki ovoz kelganda",
  description: "Matn emas, biriktirilgan fayl kelganda ishga tushadi.",
  icon: "images",
  inputs: [MEDIA_INPUT],
  summary: (values) => {
    const kinds = readList(values, "kinds").map((kind) => choiceLabel(MEDIA_INPUT, kind));
    // Nothing ticked means nothing matches yet — said outright instead of the
    // generic "Media kelganda", which read like a finished trigger.
    return kinds.length ? `${kinds.join(", ")} kelganda` : "Xabar turi tanlanmagan";
  },
  build: (values) => [
    {
      type: "trigger",
      title: "Media xabar",
      text: "Rasm, fayl yoki ovozli xabar kelganda",
      business: businessConfig({
        match: "media",
        mediaKinds: readList(values, "kinds") as BusinessMediaKind[],
      }),
    },
  ],
};

/**
 * "Yangi mijoz birinchi marta yozganda". Telegram has no such filter — a
 * `business_message` looks the same on the first message and the hundredth — so
 * the recipe builds the test itself: claim every message, then gate on a
 * variable that only the flow's own second block ever sets.
 *
 * The gate's "Yo'q" exit is left open on purpose. What a returning customer
 * should get is a decision for the author, and an edge invented here would
 * answer it silently.
 */
const firstMessageTrigger: TriggerRecipe = {
  key: "first_message",
  label: "Yangi mijoz birinchi marta yozganda",
  description: "Faqat tanishmagan mijozga — ikkinchi xabarda bu oqim ishlamaydi.",
  icon: "hand-waving",
  inputs: [
    {
      key: "variable",
      kind: "text",
      label: "Eslab qolish uchun o'zgaruvchi",
      hint: "Bir marta salomlashilgani shu belgida saqlanadi. O'zgartirmasa ham bo'ladi.",
      placeholder: "salomlashildi",
      default: "salomlashildi",
    },
  ],
  summary: () => "Yangi mijoz birinchi xabarini yozganda",
  build: (values) => {
    const variable = readText(values, "variable") || "salomlashildi";
    return [
      {
        type: "trigger",
        title: "Yangi mijoz xabari",
        text: "Mijoz biznes akkauntga yozganda",
        business: businessConfig({}),
      },
      {
        type: "condition",
        title: "Birinchi xabarmi?",
        text: `${variable} bo'sh bo'lsa`,
        condition: {
          combinator: "AND",
          rules: [
            {
              id: "r1",
              negate: false,
              field: "variable",
              variableName: variable,
              operator: "is_empty",
              value: "",
            },
          ],
        },
        // The rest of the flow is the "yes" branch — a customer already greeted
        // falls out of "Yo'q", which the author wires where they want it.
        nextPort: "yes",
      },
      {
        type: "tag",
        title: "Salomlashilgan deb belgilash",
        text: `${variable} = ha`,
        tagAction: "set_variable",
        tagName: variable,
        tagValue: "ha",
      },
    ];
  },
};

const anyMessageTrigger: TriggerRecipe = {
  key: "any_message",
  label: "Har qanday xabar",
  description: "Boshqa hech bir oqim javob bermagan xabarlar uchun zaxira.",
  icon: "chats-circle",
  inputs: [],
  summary: () => "Mijozdan istalgan xabar kelganda",
  build: () => [
    {
      type: "trigger",
      title: "Barcha xabarlar",
      text: "Mijoz biznes akkauntga yozganda",
      business: businessConfig({}),
    },
  ],
};

/* -------------------------------------------------------------------------- */
/* Kit                                                                         */
/* -------------------------------------------------------------------------- */

export const businessKit: ModuleKit = {
  moduleKey: "business",
  eventNoun: "Mijoz xabari",
  triggerQuestion: "Bot qachon ishga tushsin?",
  actionQuestion: "Shu paytda nima qilsin?",
  triggers: [
    scheduleTrigger("outside"),
    keywordTrigger,
    firstMessageTrigger,
    mediaTrigger,
    commandTrigger,
    scheduleTrigger("inside"),
    anyMessageTrigger,
  ],
  /*
   * No keyboards in this module: a reply sent over a business connection goes
   * out as the account owner's own message, and Telegram accepts no
   * `reply_markup` there. The quick-reply library lives on the message field
   * instead, which is what an account without buttons actually needs.
   */
  actions: [
    replyAction(),
    notifyAction(),
    tagAction({ presets: ["narx_soradi", "issiq_lead", "kutilmoqda"] }),
    delayAction(),
    aiAction(),
  ],
  templates: [
    {
      key: "after-hours",
      name: "Ish vaqtidan tashqari avtojavob",
      description: "Ish kuni tugagach kelgan xabarga darhol javob yozadi va jamoani ogohlantiradi.",
      outcome: "Mijoz javobsiz qolmaydi — kechqurun yozgan odam ertalab kutilayotganini biladi.",
      icon: "moon",
      tags: ["qo'llab-quvvatlash", "hamma uchun"],
      recommended: true,
      trigger: {
        recipe: "after_hours",
        values: { days: ["1", "2", "3", "4", "5"], hours: "09:00-18:00", timezone: "Asia/Tashkent" },
      },
      actions: [
        {
          recipe: "reply",
          values: {
            text: "Rahmat, xabaringizni oldik! Hozir ish vaqtimiz tugagan — ertalab 09:00 dan keyin birinchi navbatda javob beramiz.",
          },
        },
        {
          recipe: "tag",
          values: { tag: "kechqurun_yozgan" },
        },
      ],
    },
    {
      key: "greeting",
      name: "Salomlashish xabari",
      description: "Yangi mijoz birinchi marta yozganda tanishtiruv xabarini yuboradi.",
      outcome: "Har bir yangi murojaat bir xil, chiroyli salom bilan boshlanadi.",
      icon: "hand-waving",
      tags: ["hamma uchun", "sotuv"],
      recommended: true,
      trigger: { recipe: "first_message", values: { variable: "salomlashildi" } },
      actions: [
        {
          recipe: "reply",
          values: {
            text: "Assalomu alaykum, xush kelibsiz 👋\nQanday yordam bera olaman? Narx, jadval yoki manzil haqida so'rasangiz — darhol yuboraman.",
          },
        },
      ],
    },
    {
      key: "price-reply",
      name: "Narx so'ralganda javob",
      description: "«Narx», «qancha», «price» so'zlarini payqab, narx ro'yxatini yuboradi va mijozni belgilaydi.",
      outcome: "Eng ko'p beriladigan savolga qo'l tegmasdan javob boradi.",
      icon: "receipt",
      tags: ["sotuv", "o'quv markazi", "savdo"],
      recommended: true,
      trigger: {
        recipe: "keyword",
        values: { keywords: ["narx", "qancha", "price", "narxi"], match: "contains" },
      },
      actions: [
        {
          recipe: "reply",
          values: {
            text: "Narxlarimiz:\n• Boshlang'ich kurs — 690 000 so'm/oy\n• To'liq kurs — 1 200 000 so'm/oy\n• Individual — 2 400 000 so'm/oy\n\nQaysi biri qiziqtiradi? Batafsil aytib beraman.",
          },
        },
        { recipe: "tag", values: { tag: "narx_soradi" } },
      ],
    },
    {
      key: "operator-handoff",
      name: "Operatorga uzatish",
      description: "«Operator», «odam», «yordam» degan mijozni jonli xodimga uzatadi va botni jim qiladi.",
      outcome: "Jonli odam so'ragan mijoz bot bilan gaplashib qolmaydi.",
      icon: "headset",
      tags: ["qo'llab-quvvatlash", "hamma uchun"],
      trigger: {
        recipe: "keyword",
        values: { keywords: ["operator", "odam", "yordam", "menejer"], match: "contains" },
      },
      actions: [
        {
          recipe: "handoff",
          values: {
            queue: "Qo'llab-quvvatlash",
            pause: "yes",
            notice: "Hoziroq mutaxassisimizga ulayman, bir daqiqa kuting 🙏",
          },
        },
      ],
    },
    {
      key: "lead-capture",
      name: "Kontakt yig'ish",
      description: "Yangi mijozdan telefon raqamini so'raydi, saqlaydi va sotuv jamoasiga xabar beradi.",
      outcome: "Har bir murojaat CRM'ga tushadigan raqamga aylanadi.",
      icon: "address-book",
      tags: ["sotuv", "savdo", "HR"],
      trigger: { recipe: "first_message", values: { variable: "salomlashildi" } },
      actions: [
        {
          recipe: "reply",
          values: { text: "Assalomu alaykum! Xabaringiz uchun rahmat — bir necha savol bilan tanishib olaylik." },
        },
        {
          recipe: "ask",
          values: {
            question: "Sizga qulay bo'lgan telefon raqamingizni yuboring — mutaxassisimiz o'zi bog'lanadi.",
            answer: "contact",
            variable: "mijoz_telefoni",
          },
        },
        { recipe: "notify", values: { channel: "group", target: "@sunrise_sotuv" } },
      ],
    },
    {
      key: "media-received",
      name: "Rasm yoki fayl kelganda",
      description: "Skrinshot, chek yoki hujjat kelganda qabul qilinganini tasdiqlaydi va jamoaga yuboradi.",
      outcome: "Chek yuborgan mijoz «keldi» degan javobni kutib o'tirmaydi.",
      icon: "images",
      tags: ["qo'llab-quvvatlash", "savdo"],
      trigger: { recipe: "media", values: { kinds: ["photo", "document"] } },
      actions: [
        {
          recipe: "reply",
          values: { text: "Faylni oldik, rahmat! Tekshirib, 15 daqiqa ichida javob beramiz." },
        },
        { recipe: "notify", values: { channel: "group", target: "@sunrise_sotuv" } },
      ],
    },
  ],
};
