import type { ModuleKit, TriggerRecipe } from "../types";
import { aiAction, delayAction, notifyAction, replyAction, tagAction } from "./common";

/**
 * The `groups` module's kit. A group has no private conversation to route, so
 * its triggers are the three membership events Telegram delivers — a member
 * joined, a member left, someone asked to join — rather than a message filter.
 * That is also why the module's palette has no "Handler" block at all (see
 * `MODULE_NODE_TYPES` in the node registry), and why every trigger here compiles
 * to its own dedicated block type.
 */

const memberJoined: TriggerRecipe = {
  key: "member_joined",
  label: "Yangi a'zo qo'shilganda",
  description: "Guruhga odam qo'shilganda ishga tushadi.",
  icon: "user-plus",
  inputs: [],
  summary: () => "Guruhga yangi a'zo qo'shilganda",
  build: () => [
    { type: "groupjoin", title: "Yangi a'zo qo'shildi", text: "Guruhga yangi a'zo qo'shilganda" },
  ],
};

const memberLeft: TriggerRecipe = {
  key: "member_left",
  label: "A'zo chiqib ketganda",
  description: "A'zo o'zi chiqqanda yoki chiqarilganda.",
  icon: "arrow-left",
  inputs: [],
  summary: () => "Guruhdan a'zo chiqib ketganda",
  build: () => [{ type: "groupleave", title: "A'zo chiqdi", text: "Guruhdan a'zo chiqqanda" }],
};

const joinRequest: TriggerRecipe = {
  key: "join_request",
  label: "Qo'shilish so'rovi kelganda",
  description: "Tasdiqlash talab qiladigan guruhga so'rov tushganda.",
  icon: "identification-badge",
  inputs: [],
  summary: () => "Guruhga qo'shilish so'rovi kelganda",
  build: () => [
    { type: "joinrequest", title: "Qo'shilish so'rovi", text: "Guruhga qo'shilish so'rovi kelganda" },
  ],
};

export const groupsKit: ModuleKit = {
  moduleKey: "groups",
  eventNoun: "Guruh hodisasi",
  triggerQuestion: "Guruhda nima bo'lganda ishga tushsin?",
  actionQuestion: "Bot nima qilsin?",
  triggers: [memberJoined, joinRequest, memberLeft],
  actions: [
    replyAction({
      label: "Guruhga xabar",
      description: "Guruhga xabar yozadi — qoidalar, salom yoki eslatma.",
      withButtons: true,
      presets: [
        {
          label: "Qoidalar",
          value:
            "Guruhga xush kelibsiz! Qoidalar oddiy:\n1. Reklama yo'q\n2. Hurmat bilan yozamiz\n3. Savolni bitta xabarda yozing",
        },
        { label: "Salom", value: "Xush kelibsiz, {{mijoz_ismi}}! Savolingiz bo'lsa shu yerga yozing." },
      ],
      defaultText: "Guruhga xush kelibsiz! Savolingiz bo'lsa shu yerga yozing.",
    }),
    delayAction({ label: "Kutish (keyin o'chirish uchun)", default: 1440 }),
    tagAction({ presets: ["yangi_azo", "faol", "ogohlantirilgan"] }),
    notifyAction(),
    aiAction(),
  ],
  templates: [
    {
      key: "welcome",
      name: "Yangi a'zoni kutib olish",
      description: "Qoidalar va foydali havolalarni yuboradi, a'zoga teg qo'yadi.",
      outcome: "Har bir yangi a'zo qoidalarni o'qigan holda qo'shiladi.",
      icon: "hand-waving",
      tags: ["guruh", "hamma uchun"],
      recommended: true,
      trigger: { recipe: "member_joined", values: {} },
      actions: [
        {
          recipe: "reply",
          values: {
            text: "Xush kelibsiz! Qoidalar:\n1. Reklama yo'q\n2. Hurmat bilan yozamiz\n3. Savolni bitta xabarda yozing",
            buttons: ["Qoidalar to'liq", "Savolim bor"],
          },
        },
        { recipe: "tag", values: { tag: "yangi_azo" } },
      ],
    },
    {
      key: "join-request",
      name: "Qo'shilish so'rovini kutib olish",
      description: "So'rov kelganda adminga xabar beradi va so'rovchiga tanishtiruv yozadi.",
      outcome: "So'rovlar javobsiz turib qolmaydi.",
      icon: "identification-badge",
      tags: ["guruh", "moderatsiya"],
      trigger: { recipe: "join_request", values: {} },
      actions: [
        { recipe: "notify", values: { channel: "group", target: "@sunrise_adminlar" } },
        {
          recipe: "reply",
          values: { text: "So'rovingiz qabul qilindi — admin tez orada tasdiqlaydi." },
        },
      ],
    },
    {
      key: "leave-note",
      name: "Ketgan a'zoni belgilash",
      description: "A'zo chiqib ketganda CRM tegini qo'yadi va jamoaga xabar beradi.",
      outcome: "Kim va qachon ketganini keyin tahlil qilasiz.",
      icon: "arrow-left",
      tags: ["guruh", "tahlil"],
      trigger: { recipe: "member_left", values: {} },
      actions: [
        { recipe: "tag", values: { tag: "guruhdan_ketdi" } },
        { recipe: "notify", values: { channel: "webhook", target: "https://api.oqim.uz/crm/left" } },
      ],
    },
  ],
};
