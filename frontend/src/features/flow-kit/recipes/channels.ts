import type { ModuleKit, TriggerRecipe } from "../types";
import { aiAction, delayAction, notifyAction, replyAction } from "./common";

/**
 * The `channels` module's kit. A channel has no per-user reply to capture — only
 * posts and join requests exist — so the kit deliberately offers no question,
 * no tag and no operator handover: those are contact-scoped, and the module's
 * palette leaves them out for the same reason.
 */

const newPost: TriggerRecipe = {
  key: "new_post",
  label: "Yangi post joylanganda",
  description: "Kanalga post chiqqanda ishga tushadi.",
  icon: "megaphone",
  inputs: [],
  summary: () => "Kanalga yangi post joylanganda",
  build: () => [{ type: "channelpost", title: "Yangi post", text: "Kanalga yangi post joylanganda" }],
};

const joinRequest: TriggerRecipe = {
  key: "join_request",
  label: "Obuna so'rovi kelganda",
  description: "Yopiq kanalga qo'shilish so'rovi tushganda.",
  icon: "identification-badge",
  inputs: [],
  summary: () => "Kanalga obuna so'rovi kelganda",
  build: () => [{ type: "joinrequest", title: "Obuna so'rovi", text: "Kanalga qo'shilish so'rovi kelganda" }],
};

export const channelsKit: ModuleKit = {
  moduleKey: "channels",
  eventNoun: "Kanal hodisasi",
  triggerQuestion: "Kanalda nima bo'lganda ishga tushsin?",
  actionQuestion: "Keyin nima bo'lsin?",
  triggers: [newPost, joinRequest],
  actions: [
    /*
     * The step used to be called «Post ostiga komment» and to say it wrote the
     * first comment into the post's discussion. It does not, and nothing in the
     * runtime could: a `channel_post` update carries the *channel's* chat id
     * (`events.parse_update`), a run answers into `event.reply_to`, and
     * `sender.build_call` sets no `reply_to_message_id` and no
     * `message_thread_id` — there is no linked-chat lookup anywhere in the
     * engine. So what an author drew as a comment under their post went out as
     * a second post in the channel, which is a different thing on the reader's
     * screen and a different thing to write.
     *
     * The label is what moved, not the recipe. A comment in the discussion group
     * would need the runtime to learn about linked chats, and this is the module
     * the promise is made in, not the place it can be kept.
     */
    replyAction({
      label: "Kanalga qo'shimcha xabar",
      description: "Post chiqqach kanalning o'ziga yana bitta xabar joylaydi.",
      messageLabel: "Xabar matni",
      withButtons: true,
      presets: [
        { label: "Savol bering", value: "Savollaringiz bo'lsa — shu postga izoh qoldiring, hammasiga javob beramiz 👇" },
        { label: "Batafsil", value: "To'liq ma'lumot uchun botga /narx deb yozing." },
      ],
      defaultText: "Savollaringiz bo'lsa — shu postga izoh qoldiring, hammasiga javob beramiz 👇",
    }),
    delayAction({ label: "Kutish", default: 60 }),
    notifyAction(),
    aiAction(),
  ],
  templates: [
    {
      // The key is stored on every flow this template has already made
      // (`actions.originOf` writes `{kind: "template", key}`), so it stays what
      // it is even though the name above it no longer does — renaming it would
      // orphan those flows from the template they came from to fix a string
      // nobody reads.
      key: "first-comment",
      name: "Post ortidan chaqiruv",
      description: "Har bir yangi postdan keyin kanalga izoh qoldirishga chaqiruv yuboradi.",
      outcome: "Har bir post ortidan mijozga nima qilish kerakligi aytiladi.",
      icon: "chat-dots",
      tags: ["kanal", "hamma uchun"],
      recommended: true,
      trigger: { recipe: "new_post", values: {} },
      actions: [
        {
          recipe: "reply",
          values: {
            text: "Savollaringiz bo'lsa — shu postga izoh qoldiring, hammasiga javob beramiz 👇",
            buttons: ["Botga o'tish"],
          },
        },
      ],
    },
    {
      key: "post-notify",
      name: "Post chiqqanini jamoaga aytish",
      description: "Post joylangach xodimlar guruhiga xabar yuboradi.",
      outcome: "Jamoa yangi postni tarqatishni o'z vaqtida boshlaydi.",
      icon: "bell-ringing",
      tags: ["kanal", "jamoa"],
      trigger: { recipe: "new_post", values: {} },
      actions: [
        { recipe: "delay", values: { minutes: 5 } },
        { recipe: "notify", values: { channel: "group", target: "@sunrise_jamoa" } },
      ],
    },
    {
      key: "join-request-welcome",
      name: "Obuna so'roviga javob",
      description: "So'rov kelganda adminga xabar beradi.",
      outcome: "Yopiq kanal so'rovlari kutib qolmaydi.",
      icon: "identification-badge",
      tags: ["kanal", "moderatsiya"],
      trigger: { recipe: "join_request", values: {} },
      actions: [{ recipe: "notify", values: { channel: "group", target: "@sunrise_adminlar" } }],
    },
  ],
};
