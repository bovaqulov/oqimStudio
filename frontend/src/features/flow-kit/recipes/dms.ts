import { summarizeInvoice } from "@/features/flow-builder/lib/message-content";
import type { DmsTriggerKind, InvoiceConfig } from "@/features/flows";
import { choiceLabel, describeTerms, excerpt, readList, readNumber, readText } from "../lib/inputs";
import type { ActionRecipe, ModuleKit, RecipeInput, TriggerRecipe } from "../types";
import { aiAction, delayAction, notifyAction, replyAction, tagAction } from "./common";
// The Web App module's other half. It is written beside the trigger that
// catches what the Mini App sends back (`recipes/webapp.ts`) and offered here,
// because the message a customer taps to open the app is an ordinary
// conversation and «Bot ichida» is where conversations live.
import { openAppAction } from "./webapp";

/**
 * The `dms` module's kit — a customer talking to the bot itself. Unlike
 * `business`, the bot speaks in its own name here, so keyboards are deliverable
 * and every message action offers buttons.
 *
 * `/start` is missing from the triggers on purpose: it belongs to the module's
 * main flow, which ships with the module (see `FlowRecord.isMain`). A second
 * block answering it would race the module's own entry point.
 */

const commandTrigger: TriggerRecipe = {
  key: "command",
  label: "Buyruq yozilganda",
  description: "Menyudagi /narx, /manzil kabi buyruqqa javob beradi.",
  icon: "code",
  inputs: [
    {
      key: "command",
      kind: "text",
      label: "Buyruq nomi",
      hint: "«/» belgisisiz yozing.",
      placeholder: "narx",
      required: true,
      default: "",
    },
  ],
  // An empty field used to read "/buyruq buyrug'i yozilganda", which looked like
  // a real command named "buyruq" rather than a missing answer.
  summary: (values) => {
    const command = readText(values, "command").replace(/^\/+/, "");
    return command ? `/${command} buyrug'i yozilganda` : "Buyruq nomi yozilmagan";
  },
  build: (values) => [
    {
      type: "trigger",
      title: "Buyruq",
      text: "Buyruq yozilganda",
      dmsTrigger: { kinds: ["command"], command: readText(values, "command").replace(/^\/+/, "") },
    },
  ],
};

const keywordTrigger: TriggerRecipe = {
  key: "keyword",
  label: "Kalit so'z aytilganda",
  description: "Foydalanuvchi xabarida shu so'zlardan biri bo'lsa.",
  icon: "text-aa",
  inputs: [
    {
      key: "keywords",
      kind: "keywords",
      label: "Kalit so'zlar",
      hint: "Bittasi mos kelsa yetarli.",
      placeholder: "narx",
      required: true,
      default: [],
    },
  ],
  // `describeTerms([])` is an em dash, so an empty list rendered "Xabarda —
  // bo'lsa" — a sentence with a hole where the words should be.
  summary: (values) => {
    const keywords = readList(values, "keywords");
    return keywords.length ? `Xabarda ${describeTerms(keywords)} bo'lsa` : "Kalit so'z yozilmagan";
  },
  build: (values) => [
    {
      type: "trigger",
      title: "Kalit so'z",
      text: "Xabarda kalit so'z bo'lganda",
      dmsTrigger: {
        kinds: ["keyword"],
        keywords: readList(values, "keywords").join("\n"),
        keywordMatch: "contains",
        keywordFlags: "i",
      },
    },
  ],
};

const buttonTrigger: TriggerRecipe = {
  key: "callback",
  label: "Tugma bosilganda",
  description: "Oldingi xabardagi tugma bosilganda.",
  icon: "cursor-click",
  inputs: [],
  summary: () => "Botning tugmasi bosilganda",
  build: () => [
    {
      type: "trigger",
      title: "Tugma bosilishi",
      text: "Inline tugma bosilganda",
      dmsTrigger: { kinds: ["callback"] },
    },
  ],
};

const MEDIA_INPUT: RecipeInput = {
  key: "kinds",
  kind: "chips",
  label: "Xabar turi",
  required: true,
  choices: [
    { value: "photo", label: "Rasm" },
    { value: "document", label: "Hujjat" },
    { value: "voice", label: "Ovozli xabar" },
    { value: "video", label: "Video" },
    { value: "location", label: "Lokatsiya" },
    { value: "contact", label: "Kontakt" },
  ],
  default: ["photo"],
};

const mediaTrigger: TriggerRecipe = {
  key: "media",
  label: "Fayl yoki media kelganda",
  description: "Matn emas, biriktirilgan fayl kelganda.",
  icon: "images",
  inputs: [MEDIA_INPUT],
  // Nothing ticked means the trigger matches nothing yet, so it says that
  // instead of the generic "Media kelganda", which read like a working trigger.
  summary: (values) => {
    const kinds = readList(values, "kinds").map((kind) => choiceLabel(MEDIA_INPUT, kind));
    return kinds.length ? `${kinds.join(", ")} kelganda` : "Xabar turi tanlanmagan";
  },
  build: (values) => [
    {
      type: "trigger",
      title: "Media xabar",
      text: "Fayl yoki media kelganda",
      dmsTrigger: { kinds: readList(values, "kinds") as DmsTriggerKind[] },
    },
  ],
};

const anyTrigger: TriggerRecipe = {
  key: "any",
  label: "Har qanday xabar",
  description: "Hech bir boshqa oqim javob bermagan xabarlar uchun zaxira.",
  icon: "chats-circle",
  inputs: [],
  summary: () => "Istalgan xabar kelganda",
  build: () => [
    {
      type: "trigger",
      title: "Zaxira handler",
      text: "Boshqa handler ushlamagan xabar",
      dmsTrigger: { kinds: ["any"] },
    },
  ],
};

const blockedTrigger: TriggerRecipe = {
  key: "blocked",
  label: "Bot bloklanganda",
  description: "Foydalanuvchi botni bloklaganda.",
  icon: "eye-slash",
  inputs: [],
  summary: () => "Foydalanuvchi botni bloklaganda",
  build: () => [
    {
      type: "trigger",
      title: "Bot bloklandi",
      text: "Foydalanuvchi botni bloklaganda",
      dmsTrigger: { kinds: ["blocked"] },
    },
  ],
};

/* -------------------------------------------------------------------------- */
/* Actions only this module can offer                                          */
/* -------------------------------------------------------------------------- */

/**
 * The currency as it is read in a sentence. What is stored is Telegram's own
 * code, and "690 000 XTR" on a summary line means nothing to a shop owner —
 * "690 000 so'm" and "Telegram Stars" do.
 */
const CURRENCY_WORDS: Record<string, string> = { UZS: "so'm", XTR: "Telegram Stars" };

/**
 * "Hisob yuborish" — `sendInvoice`, with Telegram's own Pay row in front of
 * whatever keyboard the block carries. Only a bot talking in its own name can
 * take money, which is why this recipe lives here and not in `common.ts`.
 *
 * The flow continues out of "To'landi". The "Bekor" exit is left open like
 * every other branch a recipe emits: what a customer who walked away from the
 * payment should get is a decision, and an edge invented here would make it
 * silently.
 */

/**
 * "Shart bo'yicha ajratish" — the one branch a no-code author actually draws:
 * "did they answer one of these?".
 *
 * Written against a variable rather than the raw message because the useful
 * answer is almost never the last thing typed — it is what an earlier "Savol
 * berish" step saved. Continues out of "Ha"; "Yo'q" stays open, so a template
 * that uses this puts it *after* everything every customer should get.
 */
const branchAction: ActionRecipe = {
  key: "branch",
  label: "Shart bo'yicha ajratish",
  description: "O'zgaruvchi sanab o'tilgan qiymatlardan biriga teng bo'lsa davom etadi.",
  icon: "git-branch",
  inputs: [
    {
      key: "variable",
      kind: "text",
      label: "Qaysi o'zgaruvchi",
      hint: "Oldingi «Savol berish» qadami saqlagan nom.",
      placeholder: "nps_baho",
      required: true,
      default: "",
    },
    {
      key: "values",
      kind: "keywords",
      label: "Qaysi qiymatlarda",
      hint: "Bittasi mos kelsa yetarli.",
      placeholder: "ha",
      required: true,
      default: [],
    },
  ],
  // Half-filled, this used to read "o'zgaruvchi — bo'lsa davom etadi": a
  // placeholder name next to the em dash `describeTerms([])` returns. Each
  // missing half now names itself.
  summary: (values) => {
    const variable = readText(values, "variable");
    if (!variable) return "Tekshiriladigan o'zgaruvchi yozilmagan";
    const options = readList(values, "values");
    if (!options.length) return `«${variable}» uchun qiymat yozilmagan`;
    return `${variable} ${describeTerms(options)} bo'lsa davom etadi`;
  },
  build: (values) => {
    const variable = readText(values, "variable") || "javob";
    const options = readList(values, "values");
    return [
      {
        type: "condition",
        title: "Shart",
        text: `${variable}: ${options.join(" / ") || "istalgan qiymat"}`,
        condition: {
          combinator: "OR",
          rules: options.map((option, index) => ({
            id: `r${index + 1}`,
            negate: false,
            field: "variable" as const,
            variableName: variable,
            operator: "equals" as const,
            value: option,
          })),
        },
        nextPort: "yes",
      },
    ];
  },
};

export const dmsKit: ModuleKit = {
  moduleKey: "dms",
  eventNoun: "Foydalanuvchi xabari",
  triggerQuestion: "Oqim qachon ishga tushsin?",
  actionQuestion: "Bot nima qilsin?",
  triggers: [commandTrigger, keywordTrigger, buttonTrigger, mediaTrigger, blockedTrigger, anyTrigger],
  actions: [
    replyAction({ withButtons: true }),
    replyAction({
      key: "menu",
      label: "Menyu ko'rsatish",
      description: "Tugmalar bilan menyu yuboradi — mijoz yozmasdan tanlaydi.",
      messageLabel: "Menyu matni",
      withButtons: true,
      requireButtons: true,
      presets: [
        { label: "Asosiy menyu", value: "Kerakli bo'limni tanlang 👇" },
        { label: "Kurslar", value: "Qaysi kurs qiziqtiradi?" },
      ],
      defaultText: "Kerakli bo'limni tanlang 👇",
    }),
    notifyAction(),
    tagAction({ presets: ["yangi_lead", "obunachi", "mijoz"] }),
    branchAction,
    openAppAction,
    delayAction(),
    aiAction(),
  ],
  /*
   * The eight flows an ordinary account actually needs, each finished rather
   * than started: a customer can walk any of them end to end without the owner
   * editing a single block first.
   *
   * Two rules hold across all of them, because the runtime is what they have to
   * survive:
   *
   *  - **Every question names the kind of answer it wants.** The engine checks
   *    it (`apps/engine/validation.py`) and asks again when the answer does not
   *    fit, so a "telefon" question left on `text` is how "abc" ends up being
   *    somebody's phone number.
   *  - **A fork comes last.** A recipe can only wire one of a branch's two
   *    exits, so everything every customer must receive is sent *before* the
   *    fork, and the fork itself only adds the extra step for the case it names.
   */
  templates: [
    {
      key: "intake",
      name: "Anketa: mijoz ma'lumotlari",
      description: "Ism, telefon, qiziqish va qulay vaqtni so'rab, leadni belgilab qo'yadi.",
      outcome: "Har bir murojaat to'liq anketaga aylanadi — qo'lda yozib olish tugaydi.",
      icon: "address-book",
      tags: ["sotuv", "hamma uchun"],
      recommended: true,
      trigger: { recipe: "command", values: { command: "anketa" } },
      actions: [
        {
          recipe: "reply",
          values: {
            text: "Anketani birga to'ldiramiz — to'rtta qisqa savol, bir daqiqadan oshmaydi.",
            buttons: [],
          },
        },
        {
          recipe: "ask",
          values: { question: "Ismingiz va familiyangizni yozing.", answer: "text", variable: "mijoz_ismi" },
        },
        {
          recipe: "ask",
          values: {
            question: "Rahmat, {{mijoz_ismi}}! Telefon raqamingizni yuboring — pastdagi tugma bilan ham bo'ladi.",
            answer: "phone",
            variable: "mijoz_telefoni",
          },
        },
        {
          recipe: "ask",
          values: {
            question: "Qaysi xizmat yoki kurs qiziqtiradi? Bir jumlada yozsangiz kifoya.",
            answer: "text",
            variable: "mijoz_qiziqishi",
          },
        },
        {
          recipe: "ask",
          values: {
            question: "Siz bilan qachon bog'lanaylik? Masalan: bugun 15:00 dan keyin.",
            answer: "text",
            variable: "qulay_vaqt",
          },
        },
        { recipe: "tag", values: { tag: "yangi_lead" } },
        {
          recipe: "reply",
          values: {
            text: "Tayyor, {{mijoz_ismi}} 🙌\nQabul qildik:\n• Telefon: {{mijoz_telefoni}}\n• Qiziqish: {{mijoz_qiziqishi}}\n• Qulay vaqt: {{qulay_vaqt}}\n\nMenejerimiz shu vaqtda bog'lanadi. Savolingiz bo'lsa «operator» deb yozing.",
            buttons: [],
          },
        },
      ],
    },
    {
      key: "order",
      name: "Buyurtma qabul qilish",
      description: "Mahsulot, soni, manzil va telefonni so'raydi, so'ng to'lov uchun hisob yuboradi.",
      outcome: "Buyurtma ham, to'lov ham botning o'zida tugaydi.",
      icon: "shopping-cart",
      tags: ["savdo", "sotuv"],
      trigger: { recipe: "command", values: { command: "buyurtma" } },
      actions: [
        {
          recipe: "reply",
          values: {
            text: "Buyurtmani rasmiylashtiramiz. To'rtta savol — keyin to'lov uchun hisob yuboraman.",
            buttons: [],
          },
        },
        {
          recipe: "ask",
          values: {
            question: "Qaysi mahsulot yoki kursni buyurtma qilmoqchisiz?",
            answer: "text",
            variable: "buyurtma_nomi",
          },
        },
        {
          recipe: "ask",
          values: { question: "Nechta kerak? Faqat raqam yozing.", answer: "number", variable: "buyurtma_soni" },
        },
        {
          recipe: "ask",
          values: {
            question: "Yetkazib berish manzili — shahar, ko'cha va uy raqami.",
            answer: "text",
            variable: "yetkazish_manzili",
          },
        },
        {
          recipe: "ask",
          values: {
            question: "Kuryer bog'lanishi uchun telefon raqamingizni yuboring.",
            answer: "phone",
            variable: "mijoz_telefoni",
          },
        },
        { recipe: "tag", values: { tag: "buyurtma_berdi" } },
        {
          recipe: "reply",
          values: {
            text: "Buyurtmangiz qabul qilindi:\n• {{buyurtma_nomi}} — {{buyurtma_soni}} dona\n• Manzil: {{yetkazish_manzili}}\n• Telefon: {{mijoz_telefoni}}\n\nEndi to'lov uchun hisob yuboraman — «To'lash» tugmasini bosing.",
            buttons: [],
          },
        },
        {
          recipe: "invoice",
          values: {
            title: "Buyurtma uchun to'lov",
            description: "{{buyurtma_nomi}} — {{buyurtma_soni}} dona. To'lovdan keyin buyurtma yig'ishga beriladi.",
            amount: 690000,
            currency: "UZS",
          },
        },
        { recipe: "tag", values: { tag: "tolovi_otdi" } },
        {
          recipe: "reply",
          values: {
            text: "To'lov qabul qilindi, rahmat! 🎉\nBuyurtmangiz yig'ishga berildi — kuryer yo'lga chiqishidan oldin {{mijoz_telefoni}} raqamiga qo'ng'iroq qilamiz.",
            buttons: [],
          },
        },
      ],
    },
    {
      key: "ai-faq",
      name: "Savol-javob: AI javob beradi",
      description: "Hech bir kalit so'zga tushmagan savolga AI javob yozadi va operatorga yo'l ko'rsatadi.",
      outcome: "Har bir savol uchun alohida oqim yozib chiqishga hojat qolmaydi.",
      icon: "sparkle",
      tags: ["qo'llab-quvvatlash", "hamma uchun"],
      recommended: true,
      trigger: { recipe: "any", values: {} },
      actions: [
        {
          recipe: "ai",
          values: {
            prompt:
              "Sen o'quv markazining yordamchisisan. Kurslar, narxlar, jadval, manzil va to'lov bo'yicha savollarga qisqa — ko'pi bilan uch jumla — o'zbekcha javob ber. Aniq bilmagan narsangni o'ylab topma, operatorga uzatishni taklif qil.",
            fallback:
              "Bu savolga o'zim javob topa olmadim. «operator» deb yozsangiz, mutaxassisimizga ulayman — u aniq javob beradi.",
          },
        },
        {
          recipe: "reply",
          values: {
            text: "Yana savolingiz bo'lsa shu yerga yozavering. Jonli mutaxassis kerak bo'lsa — «operator» deb yozing.",
            buttons: [],
          },
        },
      ],
    },
    {
      key: "booking",
      name: "Navbatga yozilish",
      description: "Xizmat, sana, vaqt va telefonni so'rab, navbatni tasdiqlaydi.",
      outcome: "Navbat daftari o'rniga bot — o'tib ketgan sanani qabul qilmaydi.",
      icon: "calendar-blank",
      tags: ["xizmat", "o'quv markazi"],
      trigger: { recipe: "command", values: { command: "navbat" } },
      actions: [
        {
          recipe: "reply",
          values: { text: "Navbatga yozamiz — to'rtta savol, bir daqiqa vaqtingizni oladi.", buttons: [] },
        },
        {
          recipe: "ask",
          values: {
            question: "Qaysi xizmat yoki mutaxassisga yozilmoqchisiz?",
            answer: "text",
            variable: "navbat_xizmati",
          },
        },
        {
          recipe: "ask",
          values: {
            question: "Qaysi kunga? Sanani 25.08.2026 ko'rinishida yozing.",
            answer: "date",
            variable: "navbat_sanasi",
          },
        },
        {
          recipe: "ask",
          values: { question: "Qaysi vaqt qulay? Masalan: 15:00.", answer: "text", variable: "navbat_vaqti" },
        },
        {
          recipe: "ask",
          values: {
            question: "Eslatma yuborishimiz uchun telefon raqamingizni qoldiring.",
            answer: "phone",
            variable: "mijoz_telefoni",
          },
        },
        { recipe: "tag", values: { tag: "navbatga_yozildi" } },
        {
          recipe: "reply",
          values: {
            text: "Yozildingiz ✅\n• Xizmat: {{navbat_xizmati}}\n• Sana: {{navbat_sanasi}}\n• Vaqt: {{navbat_vaqti}}\n\nBir kun oldin eslatma yuboramiz. O'zgartirish kerak bo'lsa «operator» deb yozing.",
            buttons: [],
          },
        },
      ],
    },
    {
      key: "catalog",
      name: "Katalog va narxlar",
      description: "«Narx», «qancha», «katalog» so'zlariga narx ro'yxatini yuboradi va qiziqishni yozib oladi.",
      outcome: "Eng ko'p beriladigan savol javobsiz qolmaydi va lead bilan tugaydi.",
      icon: "receipt",
      tags: ["sotuv", "savdo", "o'quv markazi"],
      trigger: { recipe: "keyword", values: { keywords: ["narx", "narxi", "qancha", "katalog", "prays"] } },
      actions: [
        {
          recipe: "reply",
          values: {
            text: "Narxlarimiz 👇\n\n• Boshlang'ich kurs — 690 000 so'm/oy (haftada 3 dars)\n• To'liq kurs — 1 200 000 so'm/oy (haftada 5 dars + amaliyot)\n• Individual — 2 400 000 so'm/oy (shaxsiy jadval)\n\nBirinchi dars bepul. To'lov naqd, karta yoki bot orqali.",
            buttons: [],
          },
        },
        {
          recipe: "ask",
          values: {
            question: "Qaysi variant qiziqtiradi? Nomini yozing — batafsil aytib beraman.",
            answer: "text",
            variable: "tanlangan_xizmat",
          },
        },
        {
          recipe: "ask",
          values: {
            question: "Telefon raqamingizni qoldiring — bo'sh joy qolgani va chegirmalar haqida aytamiz.",
            answer: "phone",
            variable: "mijoz_telefoni",
          },
        },
        { recipe: "tag", values: { tag: "narx_soradi" } },
        {
          recipe: "reply",
          values: {
            text: "Rahmat! «{{tanlangan_xizmat}}» bo'yicha menejerimiz bugun {{mijoz_telefoni}} raqamiga bog'lanadi. Shu yerdan ham savol berishingiz mumkin.",
            buttons: [],
          },
        },
      ],
    },
    {
      key: "feedback",
      name: "Fikr-mulohaza va NPS",
      description: "1–10 baho va izohni so'raydi; past baho bergan mijozni darhol operatorga uzatadi.",
      outcome: "Norozi mijoz ketishdan oldin jonli odam bilan gaplashadi.",
      icon: "star",
      tags: ["qo'llab-quvvatlash", "hamma uchun"],
      trigger: { recipe: "command", values: { command: "fikr" } },
      actions: [
        {
          recipe: "reply",
          values: { text: "Fikringiz biz uchun muhim — ikkita savol, 20 soniya.", buttons: [] },
        },
        {
          recipe: "ask",
          values: {
            question: "Bizni 1 dan 10 gacha baholang. Faqat raqam yozing.",
            answer: "number",
            variable: "nps_baho",
          },
        },
        {
          recipe: "ask",
          values: { question: "Nima yoqdi yoki nimani yaxshilashimiz kerak?", answer: "text", variable: "nps_izoh" },
        },
        { recipe: "tag", values: { tag: "fikr_qoldirdi" } },
        {
          recipe: "reply",
          values: {
            text: "Rahmat! Bahoyingiz ({{nps_baho}}) va izohingiz jamoaga yetkazildi — har bir fikrni o'qib chiqamiz.",
            buttons: [],
          },
        },
        { recipe: "branch", values: { variable: "nps_baho", values: ["1", "2", "3", "4", "5", "6"] } },
        {
          recipe: "handoff",
          values: {
            queue: "Qo'llab-quvvatlash",
            notice: "Past baho uchun uzr so'raymiz. Hoziroq mutaxassisimizga ulayman — muammoni birga hal qilamiz.",
          },
        },
      ],
    },
    {
      key: "operator",
      name: "Operatorga uzatish",
      description: "«Operator», «odam», «yordam» deganda savolni yozib oladi va jonli xodim navbatiga qo'yadi.",
      outcome: "Bot javob bera olmaydigan savol odamga boradi — kontekst bilan.",
      icon: "headset",
      tags: ["qo'llab-quvvatlash", "hamma uchun"],
      recommended: true,
      trigger: {
        recipe: "keyword",
        values: { keywords: ["operator", "odam", "menejer", "yordam", "jonli"] },
      },
      actions: [
        {
          recipe: "ask",
          values: {
            question: "Albatta. Savolingizni bitta xabarda yozing — operatorga aynan shuni uzataman.",
            answer: "text",
            variable: "operator_savoli",
          },
        },
        { recipe: "tag", values: { tag: "operator_soradi" } },
        {
          recipe: "handoff",
          values: {
            queue: "Qo'llab-quvvatlash",
            notice: "Rahmat, savolingizni uzatdim. Mutaxassis bir necha daqiqada shu yerga javob beradi.",
          },
        },
      ],
    },
    {
      key: "subscribe",
      name: "Kanalga obuna va bonus",
      description: "Kanalga obunani so'raydi, tasdiqni oladi, bonus materialni yuboradi va obunachini belgilaydi.",
      outcome: "Bot kanalga obunachi to'playdi va bonusni o'zi tarqatadi.",
      icon: "megaphone",
      tags: ["kanal", "sotuv"],
      trigger: { recipe: "command", values: { command: "bonus" } },
      actions: [
        {
          recipe: "reply",
          values: {
            text: "Bonus material — «10 ta tayyor bot ssenariysi» qo'llanmasi 🎁\n\n1) Kanalimizga obuna bo'ling: https://t.me/oqimstudio\n2) So'ng shu yerga «tayyor» deb yozing.",
            buttons: [],
          },
        },
        {
          recipe: "ask",
          values: {
            question: "Obuna bo'ldingizmi? «tayyor» deb yozing.",
            answer: "text",
            variable: "obuna_javobi",
          },
        },
        {
          recipe: "reply",
          values: {
            text: "Mana bonus material 🎁\nhttps://oqim.uz/bonus/10-ssenariy\n\nKanalda har hafta yangi ssenariy chiqadi. Savolingiz bo'lsa «operator» deb yozing.",
            buttons: [],
          },
        },
        {
          recipe: "branch",
          values: { variable: "obuna_javobi", values: ["tayyor", "ha", "bo'ldi", "bo'ldim", "obuna", "done"] },
        },
        { recipe: "tag", values: { tag: "obunachi" } },
      ],
    },
  ],
};
