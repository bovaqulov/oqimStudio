import type { IconName } from "@/components/ui/Icon";
import type { BotChat } from "../types";

/**
 * Telegram's `ChatMemberAdministrator` booleans, in the owner's terms.
 *
 * A catalogue, not a store — the same shape `data/business.ts` holds for
 * `BusinessBotRights`, and for the same reason: every field here mirrors one the
 * Bot API sends, nothing in it is ours to grant, and the panel joins the two on
 * `api` so a right Telegram has not heard of reads as not granted rather than
 * throwing.
 *
 * What the API field names do not say is the thing a person is deciding, so
 * `about` says it: `can_post_messages` is the difference between a channel flow
 * that publishes and one that fails on every send, and nothing in that name
 * tells anyone so.
 *
 * `scope` is why the list is not shown whole. Telegram marks four of these
 * "for channels only" and two "for groups and supergroups only", and a channel
 * row listing «Xabarlarni qadash — yo'q» would be reporting the absence of a
 * right that does not exist there.
 *
 * See https://core.telegram.org/bots/api#chatmemberadministrator
 */
export interface ChatRight {
  key: string;
  label: string;
  /** The `ChatMemberAdministrator` field this maps to. */
  api: string;
  /** What granting it lets the bot actually do here. */
  about: string;
  /** Which kind of chat the field exists on at all. */
  scope: "both" | "group" | "channel";
  /** A flow in this product stops working without it — shown ahead of the rest. */
  needed?: boolean;
}

export const CHAT_RIGHTS: ChatRight[] = [
  {
    key: "post_messages",
    label: "Post joylash",
    api: "can_post_messages",
    about: "Botning kanalga yozishi shu huquqqa bog'liq — usiz hech qanday post chiqmaydi.",
    scope: "channel",
    needed: true,
  },
  {
    key: "edit_messages",
    label: "Postlarni tahrirlash",
    api: "can_edit_messages",
    about: "Bot boshqalar joylagan postni tahrirlaydi va qadaydi.",
    scope: "channel",
  },
  {
    key: "delete_messages",
    label: "Xabarlarni o'chirish",
    api: "can_delete_messages",
    about: "Spam filtri va moderatsiya oqimlari shu huquq bilan ishlaydi.",
    scope: "both",
    needed: true,
  },
  {
    key: "restrict_members",
    label: "A'zolarni cheklash",
    api: "can_restrict_members",
    about: "Bot a'zoni jim qildira, chiqara yoki qaytara oladi.",
    scope: "group",
  },
  {
    key: "invite_users",
    label: "A'zo qo'shish",
    api: "can_invite_users",
    about: "Qo'shilish so'rovini tasdiqlash uchun Telegram aynan shu huquqni talab qiladi.",
    scope: "both",
  },
  {
    key: "pin_messages",
    label: "Xabarni qadash",
    api: "can_pin_messages",
    about: "Bot e'lonni guruh tepasiga qadaydi.",
    scope: "group",
  },
  {
    key: "manage_chat",
    label: "Chatni boshqarish",
    api: "can_manage_chat",
    about: "Yashirin a'zolarni ko'rish, sekin rejimni chetlab o'tish va statistikaga kirish.",
    scope: "both",
  },
  {
    key: "change_info",
    label: "Ma'lumotni o'zgartirish",
    api: "can_change_info",
    about: "Nom, rasm va tavsifni bot o'zgartira oladi.",
    scope: "both",
  },
  {
    key: "promote_members",
    label: "Admin tayinlash",
    api: "can_promote_members",
    about: "Bot o'z huquqlaridan bir qismini boshqa a'zoga bera oladi.",
    scope: "both",
  },
  {
    key: "manage_topics",
    label: "Mavzularni boshqarish",
    api: "can_manage_topics",
    about: "Forum guruhida mavzu ochish, nomlash va yopish.",
    scope: "group",
  },
];

/**
 * The rights worth showing for one chat, needed ones first.
 *
 * Ordered rather than filtered by grant: a right the bot does *not* have is the
 * answer this screen exists to give, so it stays on the list with an empty box
 * beside it.
 */
export function rightsFor(chat: BotChat): ChatRight[] {
  const wanted = chat.type === "channel" ? "channel" : "group";
  return CHAT_RIGHTS.filter((right) => right.scope === "both" || right.scope === wanted).sort(
    (a, b) => Number(b.needed ?? false) - Number(a.needed ?? false),
  );
}

/** How many of them Telegram actually granted, out of how many apply here. */
export function grantedCount(chat: BotChat): { granted: number; total: number } {
  const rights = rightsFor(chat);
  return { granted: rights.filter((right) => chat.rights[right.api] === true).length, total: rights.length };
}

/** What `ChatMember.status` says, as a person would say it. */
export const CHAT_STATUS_LABELS: Record<BotChat["status"], string> = {
  creator: "Egasi",
  administrator: "Administrator",
  member: "A'zo",
  restricted: "Cheklangan",
  left: "Chiqib ketgan",
  kicked: "Chiqarilgan",
};

/** The icon a chat of this type is drawn with — the module's own, so the two read as one thing. */
export function chatIcon(chat: BotChat): IconName {
  return chat.type === "channel" ? "megaphone" : "users-three";
}
