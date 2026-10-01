import { createAiConfig } from "@/features/flow-builder/lib/ai";
import type { FlowButton } from "@/features/flows";
import { choiceLabel, excerpt, readList, readNumber, readText } from "../lib/inputs";
import type { ActionRecipe, RecipeInput, RecipePreset, RecipeValues } from "../types";

/**
 * Action recipes shared by more than one module. What a module changes is which
 * of them it offers and which presets they carry — the block a "javob yuborish"
 * step compiles to is the same everywhere, so it is written once here.
 *
 * A recipe that only one module can offer (a Web App button, a group welcome)
 * lives in that module's own file instead.
 */

/* -------------------------------------------------------------------------- */
/* Reusable input specs                                                        */
/* -------------------------------------------------------------------------- */

export const VARIABLE_HINT = "{{mijoz_ismi}} kabi o'zgaruvchilarni yozsangiz, xabarda mijozning ismi chiqadi.";

export function messageInput(options?: {
  label?: string;
  hint?: string;
  placeholder?: string;
  presets?: RecipePreset[];
  default?: string;
}): RecipeInput {
  return {
    key: "text",
    kind: "textarea",
    label: options?.label ?? "Xabar matni",
    hint: options?.hint ?? VARIABLE_HINT,
    placeholder: options?.placeholder ?? "Masalan: Rahmat! Xabaringizni oldik, tez orada javob beramiz.",
    required: true,
    presets: options?.presets,
    default: options?.default ?? "",
  };
}

/**
 * Quick-reply library for the message field. The four answers every account
 * types by hand a hundred times — offered as one tap, editable afterwards like
 * any other text.
 */
export const REPLY_PRESETS: RecipePreset[] = [
  {
    label: "Rahmat, javob beramiz",
    value: "Rahmat, xabaringizni oldik! Eng qisqa vaqtda javob beramiz.",
  },
  {
    label: "Narx ro'yxati",
    value:
      "Narxlarimiz:\n• Boshlang'ich kurs — 690 000 so'm/oy\n• To'liq kurs — 1 200 000 so'm/oy\n\nQaysi biri qiziqtiradi?",
  },
  {
    label: "Ish vaqti",
    value: "Ish vaqtimiz: dushanba–juma, 09:00–18:00. Shu vaqtda qo'ng'iroq qilsangiz darhol javob beramiz.",
  },
  {
    label: "Manzil",
    value: "Manzil: Toshkent sh., Amir Temur ko'chasi 12-uy, 3-qavat. Mo'ljal — Metro «Buyuk Ipak Yo'li».",
  },
];

/** Button labels as a chip list — one label per row, empty means a plain message. */
const BUTTONS_INPUT: RecipeInput = {
  key: "buttons",
  kind: "keywords",
  label: "Tugmalar",
  hint: "Har bir tugma alohida qatorda. Bo'sh qoldirsangiz oddiy xabar yuboriladi.",
  placeholder: "Narxlar",
  default: [],
};

/**
 * The same field where the buttons are the point of the step.
 *
 * On a plain reply they are an extra, and the hint above says so. On a menu
 * they are the whole thing: a "Menyu ko'rsatish" with no buttons builds a
 * message with nothing to tap, which the wizard used to accept without a word
 * and hand over as a finished flow.
 */
const REQUIRED_BUTTONS_INPUT: RecipeInput = {
  ...BUTTONS_INPUT,
  required: true,
  hint: "Har bir tugma alohida qatorda. Menyu uchun kamida bitta tugma kerak.",
};

/** The labels turned into callback buttons — the kind whose branch the canvas can route. */
function callbackButtons(values: RecipeValues): FlowButton[] {
  return readList(values, "buttons").map((label, index) => ({
    id: `b${index + 1}`,
    label,
    kind: "callback" as const,
  }));
}

/* -------------------------------------------------------------------------- */
/* Actions                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * "Avtomatik javob yuborish" — the action nine flows out of ten open with.
 * `withButtons` is off where Telegram would refuse the keyboard (the `business`
 * module sends as the account owner, and such a message carries no
 * `reply_markup`), so the step never asks a question whose answer is ignored.
 */
export function replyAction(options?: {
  key?: string;
  label?: string;
  description?: string;
  withButtons?: boolean;
  /** The step is a menu: it is not finished until it has something to tap. */
  requireButtons?: boolean;
  presets?: RecipePreset[];
  messageLabel?: string;
  defaultText?: string;
}): ActionRecipe {
  return {
    key: options?.key ?? "reply",
    label: options?.label ?? "Avtomatik javob",
    description: options?.description ?? "Bot tayyor matnni darhol yuboradi.",
    icon: "chat-teardrop-text",
    inputs: [
      messageInput({
        label: options?.messageLabel,
        presets: options?.presets ?? REPLY_PRESETS,
        default: options?.defaultText,
      }),
      ...(options?.withButtons ? [options.requireButtons ? REQUIRED_BUTTONS_INPUT : BUTTONS_INPUT] : []),
    ],
    summary: (values) => {
      const text = readText(values, "text");
      // An unwritten message reads as "Xabar matni yozilmagan": the old line
      // quoted an empty excerpt («» xabarini yuboradi), which told the author the
      // step was finished while it was still waiting for the one thing it sends.
      if (!text) return "Xabar matni yozilmagan";
      const buttons = readList(values, "buttons");
      // Said in the summary as well as blocked by the button, because the
      // summary is what the review step reads back.
      if (options?.requireButtons && buttons.length === 0) return "Menyu uchun tugma qo'shilmagan";
      const line = `«${excerpt(text)}» xabarini yuboradi`;
      return buttons.length ? `${line} · ${buttons.length} ta tugma` : line;
    },
    build: (values) => {
      const buttons = callbackButtons(values);
      return [
        {
          type: "message",
          title: "Javob xabari",
          text: readText(values, "text"),
          ...(buttons.length ? { buttons, buttonMode: "inline" as const } : {}),
        },
      ];
    },
  };
}


/**
 * "Jamoaga bildirishnoma". Compiles to an HTTP block, which is what a
 * notification to somewhere outside this chat actually is — naming the endpoint
 * on the card keeps the flow honest about leaving Telegram.
 */
export function notifyAction(): ActionRecipe {
  const channel: RecipeInput = {
    key: "channel",
    kind: "choice",
    label: "Qayerga yuborilsin",
    choices: [
      { value: "group", label: "Telegram guruh", hint: "Xodimlar guruhiga xabar", icon: "users-three" },
      { value: "email", label: "Email", hint: "Pochta orqali", icon: "paper-plane-tilt" },
      { value: "webhook", label: "CRM yoki sayt", hint: "O'z tizimingizga havola orqali", icon: "globe-hemisphere-west" },
    ],
    default: "group",
  };

  return {
    key: "notify",
    label: "Jamoaga bildirishnoma",
    description: "Xodimlarga yangi murojaat haqida xabar boradi.",
    icon: "bell-ringing",
    inputs: [
      channel,
      {
        key: "target",
        kind: "text",
        label: "Manzil",
        hint: "Guruh uchun @username, email uchun pochta manzili, CRM uchun to'liq havola.",
        placeholder: "@sunrise_sotuv",
        required: true,
        default: "",
      },
    ],
    summary: (values) => {
      // A cleared choice has no label of its own, so the destination falls back
      // to the input's default rather than leaving the line to start with ": ".
      const where = choiceLabel(channel, readText(values, "channel") || String(channel.default));
      const target = readText(values, "target");
      // Without an address nothing can be sent, so an empty field reads as
      // "Telegram guruh: manzil yozilmagan". The old fallback spelled the word
      // "manzil" into the sentence, where it looked like a real destination.
      return target ? `${where} orqali ${target} ga xabar beradi` : `${where}: manzil yozilmagan`;
    },
    build: (values) => {
      const target = readText(values, "target");
      const kind = readText(values, "channel");
      const request =
        kind === "webhook"
          ? `POST ${target}`
          : kind === "email"
            ? `POST https://api.oqim.uz/notify/email · to=${target}`
            : `POST sendMessage · chat_id=${target}`;
      return [
        {
          type: "http",
          title: "Bildirishnoma",
          text: `${request}\nYangi murojaat: {{mijoz_ismi}} — {{message.text}}`,
        },
      ];
    },
  };
}

export function delayAction(options?: { label?: string; default?: number }): ActionRecipe {
  return {
    key: "delay",
    label: options?.label ?? "Kutish",
    description: "Keyingi qadamgacha belgilangan vaqt kutiladi.",
    icon: "clock",
    inputs: [
      {
        key: "minutes",
        kind: "number",
        label: "Qancha kutilsin",
        min: 1,
        max: 10_080,
        step: 5,
        unit: "daqiqa",
        default: options?.default ?? 30,
      },
    ],
    // A cleared number field parses as 0, and "0 daqiqa kutadi" described a pause
    // that does not exist — an unset delay now says so instead.
    summary: (values) => {
      const minutes = readNumber(values, "minutes", 30);
      return minutes >= 1 ? `${minutes} daqiqa kutadi` : "Kutish vaqti yozilmagan";
    },
    build: (values) => {
      const minutes = Math.max(1, readNumber(values, "minutes", 30));
      return [{ type: "delay", title: "Kutish", text: "Keyingi qadamgacha pauza", minutes }];
    },
  };
}

/** "Belgi qo'yish" — the CRM half of a flow: what the contact is known as afterwards. */
export function tagAction(options?: { presets?: string[] }): ActionRecipe {
  return {
    key: "tag",
    label: "Belgi qo'yish",
    description: "Mijozga teg qo'yadi — keyin shu teg bo'yicha ajratasiz.",
    icon: "tag",
    inputs: [
      {
        key: "tag",
        kind: "text",
        label: "Teg nomi",
        hint: options?.presets?.length ? `Masalan: ${options.presets.join(", ")}` : "Masalan: narx_soradi",
        placeholder: "narx_soradi",
        required: true,
        default: "",
      },
    ],
    // The old fallback quoted the word «teg» itself, which read as a tag actually
    // named "teg"; an empty field now names what is missing.
    summary: (values) => {
      const tag = readText(values, "tag");
      return tag ? `«${tag}» tegini qo'yadi` : "Teg nomi yozilmagan";
    },
    build: (values) => {
      const tag = readText(values, "tag") || "yangi";
      return [
        {
          type: "tag",
          title: "Teg qo'yish",
          text: `tag = ${tag}`,
          tagAction: "add",
          tagName: tag,
        },
      ];
    },
  };
}

/** "AI javob" — for the questions no keyword list will ever cover. */
export function aiAction(): ActionRecipe {
  return {
    key: "ai",
    label: "AI javob",
    description: "Sun'iy intellekt mijoz savoliga o'zi javob yozadi.",
    icon: "sparkle",
    inputs: [
      {
        key: "prompt",
        kind: "textarea",
        label: "AI ko'rsatmasi",
        hint: "Nima haqida va qanday uslubda javob berishini yozing.",
        placeholder: "Kurs dasturi va narxlar bo'yicha savollarga qisqa, o'zbekcha javob ber.",
        required: true,
        default: "Mijoz savoliga qisqa va aniq javob ber. Narx so'ralsa, narx ro'yxatini yubor.",
      },
      {
        key: "fallback",
        kind: "textarea",
        label: "Javob topilmasa",
        hint: "Model javob bera olmaganda mijoz shu xabarni ko'radi — bo'sh chiqmasligi uchun.",
        placeholder: "Kechirasiz, bu savolga javob topa olmadim. Operator tez orada bog'lanadi.",
        default: "Kechirasiz, bu savolga javob topa olmadim. «operator» deb yozsangiz, mutaxassisga ulayman.",
      },
    ],
    // "AI javob beradi: «»" claimed the model had been briefed with nothing; an
    // empty instruction now reads as the answer the step still needs.
    summary: (values) => {
      const prompt = readText(values, "prompt");
      return prompt ? `AI javob beradi: «${excerpt(prompt, 38)}»` : "AI ko'rsatmasi yozilmagan";
    },
    build: (values) => {
      const fallbackText = readText(values, "fallback");
      return [
        {
          type: "ai",
          title: "AI javob",
          text: readText(values, "prompt"),
          // The fallback is part of the block, not a separate step: it is what
          // the customer reads whenever the model cannot answer, and a flow
          // whose AI step can go silent is a bot that stops mid-sentence.
          ai: { ...createAiConfig(), ...(fallbackText ? { fallbackText } : {}) },
        },
      ];
    },
  };
}
