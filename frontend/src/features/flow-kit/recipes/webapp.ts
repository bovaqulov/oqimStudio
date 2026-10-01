import { readText } from "../lib/inputs";
import type { ActionRecipe, ModuleKit, TriggerRecipe } from "../types";
import { delayAction, notifyAction, replyAction, tagAction } from "./common";

/**
 * The `webapp` module's kit — what happens when the Mini App sends something back.
 *
 * The kit has **one** trigger, and that is not a gap: which surface an update
 * belongs to is derived from the update itself
 * (`apps/engine/events.py::module_key`), and the only update that says "web
 * app" is `message.web_app_data`. So a flow filed under this module can be
 * opened by a Mini App submission and by nothing else.
 *
 * It used to offer two more. "Ilovani ochish buyrug'i" built a `command`
 * handler here and "To'lov muvaffaqiyatli bo'lganda" a `payment` one — both of
 * which arrive as ordinary private-chat messages, are therefore `dms`, and so
 * matched no trigger in this module ever. Both flows built cleanly, switched on
 * cleanly and answered nothing. They are gone rather than moved, because both
 * already exist in the «Bot ichida» kit where they do fire.
 *
 * The button that *opens* the app is the other half and lives there too — see
 * [[openAppAction]], which this module exports into `dmsKit`.
 */

const dataTrigger: TriggerRecipe = {
  key: "webapp_data",
  label: "Ilovadan ma'lumot kelganda",
  description: "Mijoz mini-ilovadagi formani to'ldirib yuborganda.",
  icon: "database",
  inputs: [],
  summary: () => "Mini-ilovadan ma'lumot kelganda",
  build: () => [
    {
      type: "trigger",
      title: "Web App ma'lumoti",
      text: "Ilovadan ma'lumot kelganda",
      dmsTrigger: { kinds: ["webapp"] },
    },
  ],
};

/**
 * The one action that belongs to «Bot ichida» rather than to this module.
 *
 * Exported because it is the Web App module's other half: the message a
 * customer taps to open the app is an ordinary conversation, so it is built in
 * the `dms` kit — but it is written here, beside the trigger that catches what
 * the app sends back, so the pair is read together.
 *
 * The address is left blank on purpose. `sender._mini_app_url` reads an empty
 * Web App button as "this bot's own Mini App" and fills in the URL the module
 * serves, which is the only configuration where the round trip is already
 * wired end to end. A field for it would invite an author to paste something
 * that opens but cannot answer.
 *
 * `buttonMode` is not set either: a Web App button pins its block to a reply
 * keyboard on both sides (`buttons.ts::isMiniAppKind`,
 * `sender.REPLY_PINNED_KINDS`), because `sendData` — the only way a Mini App
 * reaches the bot — "is only available for Mini Apps launched via a Keyboard
 * button".
 */
export const openAppAction: ActionRecipe = {
  key: "open_app",
  label: "Mini ilovani ochish tugmasi",
  description: "Formani Telegram ichida ochadigan tugma bilan xabar yuboradi.",
  icon: "browser",
  inputs: [
    {
      key: "text",
      kind: "textarea",
      label: "Xabar matni",
      placeholder: "Formani to'ldiring — bir necha savol, bir ekran.",
      required: true,
      default: "Formani to'ldiring — bir necha savol, bir ekran 👇",
    },
    {
      key: "button",
      kind: "text",
      label: "Tugma yozuvi",
      placeholder: "Formani ochish",
      required: true,
      default: "Formani ochish",
    },
  ],
  summary: (values) => `«${readText(values, "button") || "Ochish"}» tugmasi bilan mini ilovani ochadi`,
  build: (values) => [
    {
      type: "message",
      title: "Ilovani ochish",
      text: readText(values, "text"),
      buttons: [
        {
          id: "b1",
          label: readText(values, "button") || "Ochish",
          kind: "webapp",
          value: "",
        },
      ],
    },
  ],
};

export const webappKit: ModuleKit = {
  moduleKey: "webapp",
  eventNoun: "Ilova ma'lumoti",
  triggerQuestion: "Oqim qachon ishga tushsin?",
  actionQuestion: "Ma'lumot kelgach nima bo'lsin?",
  triggers: [dataTrigger],
  actions: [
    replyAction({ withButtons: true }),
    tagAction({ presets: ["anketa_toldirdi", "xaridor"] }),
    notifyAction(),
    delayAction(),
  ],
  templates: [
    {
      key: "form-received",
      name: "Forma kelganda tasdiqlash",
      description: "Ilovadan javoblar kelganda mijozga tasdiq yozadi va jamoaga xabar beradi.",
      outcome: "Mijoz javob oladi, sotuvchi esa to'ldirilgan formani ko'radi.",
      icon: "check",
      tags: ["hamma uchun"],
      recommended: true,
      trigger: { recipe: "webapp_data", values: {} },
      actions: [
        {
          recipe: "reply",
          values: {
            // No placeholder here on purpose. A Mini App submission arrives as
            // an opaque string this product cannot read: `events.parse_update`
            // keeps it on the event and nothing turns it into context, because
            // the Bot API says of that field that "a bad client can send
            // arbitrary data in it" and there is no signed record to check it
            // against any more. A template that printed `{{webapp.summary}}`
            // would put braces on a customer's screen.
            text: "Rahmat! Ma'lumotlaringiz qabul qilindi — tez orada bog'lanamiz.",
          },
        },
        { recipe: "notify", values: { channel: "group", target: "@sunrise_buyurtma" } },
        { recipe: "tag", values: { tag: "anketa_toldirdi" } },
      ],
    },
    {
      key: "form-to-operator",
      name: "Forma kelganda operatorga uzatish",
      description: "Javoblarni yozib beradi va suhbatni jonli operatorga qoldiradi.",
      outcome: "Operator suhbatni to'ldirilgan forma bilan ochadi.",
      icon: "headset",
      tags: ["qo'llab-quvvatlash"],
      trigger: { recipe: "webapp_data", values: {} },
      actions: [
        { recipe: "reply", values: { text: "Ma'lumotlaringizni oldik — hozir operator ulanadi." } },
        { recipe: "handoff", values: { queue: "Sotuv" } },
      ],
    },
  ],
};
