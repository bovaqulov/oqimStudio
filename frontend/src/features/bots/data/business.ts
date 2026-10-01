import type { IconName } from "@/components/ui/Icon";

/**
 * Telegram's `BusinessBotRights`, described in the owner's terms.
 *
 * A catalogue, not a store: every field here mirrors one the Bot API sends on a
 * `business_connection`, and the panel joins the two on `api` to say which
 * rights an account actually granted. Nothing in this file is editable by us —
 * the owner grants and revokes these in Telegram, under Settings → Business →
 * Chatbots — so what it holds is the vocabulary for reading them back, and the
 * one judgement the API does not carry: which of them are worth a warning.
 *
 * It used to hold a fixture connection and a list of invented chats as well.
 * Those were rendered against real bots that had never been attached to any
 * Business account, which is the bug that emptied this file down to the part
 * that is true.
 */

export interface BusinessRight {
  key: string;
  label: string;
  /**
   * The Bot API field this maps to — https://core.telegram.org/bots/api#businessbotrights
   *
   * **The Bot API's name, not MTProto's.** Every one of these used to be the
   * flag `account.updateConnectedBot` carries (`reply`, `view_gifts`,
   * `sell_gifts`) — the method an account owner's *own client* calls. What
   * arrives here is the object a `business_connection` update carries, whose
   * fields all begin `can_`. The two describe the same fourteen rights in
   * different words, so not one name matched and every connection in the
   * product rendered as «0/14 huquq» whatever the owner had granted.
   * `apps/bots/tests.py::BusinessConnectionRightsTests` pins this list against
   * `apps/bots/business.py::BUSINESS_RIGHT_FIELDS`.
   */
  api: string;
  /**
   * What granting it actually lets the bot do, in the owner's own words. The
   * API field name is precise and says nothing to the person deciding: "reply"
   * does not tell anyone that the bot will be writing as *them*.
   */
  about: string;
  /**
   * Acts on the owner's account in a way they cannot undo from the chat: it
   * deletes their messages, rewrites their profile or moves their Stars. Not a
   * different permission, just one worth a second look before granting.
   */
  sensitive?: boolean;
  /** Only on sensitive rights: the concrete thing that can go wrong. Shown in the warning tooltip. */
  risk?: string;
}

export interface BusinessRightGroup {
  key: string;
  title: string;
  icon: IconName;
  /** One line under the group title — what this whole set of rights is for. */
  summary: string;
  rights: BusinessRight[];
}

/** All 14 rights `BusinessBotRights` can carry, grouped the way the owner thinks about them. */
export const BUSINESS_RIGHT_GROUPS: BusinessRightGroup[] = [
  {
    key: "messages",
    title: "Xabarlar",
    icon: "chat-teardrop-text",
    summary: "Botning mijoz bilan yozishuvi — avtomatik javoblar shu yerdan ishlaydi.",
    rights: [
      {
        key: "reply",
        label: "Javob yozish va tahrirlash",
        api: "can_reply",
        about: "Bot sizning nomingizdan xabar yozadi. Avtojavob va tez javoblar shusiz ishlamaydi.",
      },
      {
        key: "read_messages",
        label: "O'qilgan deb belgilash",
        api: "can_read_messages",
        about: "Bot javob bergan chatdagi xabarlarni o'qilgan holatiga o'tkazadi — o'qilmaganlar soni to'g'ri qoladi.",
      },
      {
        key: "delete_sent_messages",
        label: "Bot xabarlarini o'chirish",
        api: "can_delete_sent_messages",
        about: "Bot faqat o'zi yozgan xabarni o'chira oladi. Xato yuborilgan avtojavobni tozalash uchun kerak.",
      },
      {
        key: "delete_received_messages",
        label: "Kelgan xabarlarni o'chirish",
        api: "can_delete_all_messages",
        about: "Bot mijoz yuborgan xabarlarni ham o'chira oladi.",
        sensitive: true,
        risk: "Mijozning xabari yozishmadan butunlay yo'qoladi va uni qaytarib bo'lmaydi. Spam tozalashdan boshqa holatda kerak emas.",
      },
    ],
  },
  {
    key: "profile",
    title: "Profil",
    icon: "user-circle",
    summary: "Akkauntingiz ko'rinishi. Avtomatlashtirish uchun deyarli hech qachon kerak emas.",
    rights: [
      {
        key: "edit_name",
        label: "Ism va familiyani o'zgartirish",
        api: "can_edit_name",
        about: "Bot akkaunt ismini almashtira oladi — masalan ish vaqtida «(onlayn)» qo'shish uchun.",
        sensitive: true,
        risk: "Sizning shaxsiy ismingiz botning xatosi bilan o'zgarib qolishi mumkin — mijozlar buni darhol ko'radi.",
      },
      {
        key: "edit_bio",
        label: "Bio'ni o'zgartirish",
        api: "can_edit_bio",
        about: "Profil tavsifini yangilaydi — masalan ish vaqtini yozib qo'yish uchun.",
        sensitive: true,
        risk: "Qo'lda yozgan bio'ngiz avtomatik matn bilan almashib ketadi.",
      },
      {
        key: "edit_profile_photo",
        label: "Profil rasmini o'zgartirish",
        api: "can_edit_profile_photo",
        about: "Bot avatar rasmini almashtiradi.",
        sensitive: true,
        risk: "Eski rasm arxivga tushadi; shaxsiy akkauntda buni odatda hech kim xohlamaydi.",
      },
      {
        key: "edit_username",
        label: "Username'ni o'zgartirish",
        api: "can_edit_username",
        about: "Bot @username'ni almashtira oladi.",
        sensitive: true,
        risk: "Username o'zgarsa, eski havolalar va reklamalar ishlamay qoladi.",
      },
    ],
  },
  {
    key: "gifts",
    title: "Sovg'a va Stars",
    icon: "star",
    summary: "Telegram Stars balansi va sovg'alar. Pul bilan bog'liq — ehtiyot bo'ling.",
    rights: [
      {
        key: "view_gifts",
        label: "Sovg'a va Stars balansini ko'rish",
        api: "can_view_gifts_and_stars",
        about: "Bot balansni faqat o'qiydi. Hisobot va «balans qancha?» savoliga javob uchun yetarli.",
      },
      {
        key: "sell_gifts",
        label: "Sovg'ani Stars'ga aylantirish",
        api: "can_convert_gifts_to_stars",
        about: "Bot kelgan sovg'ani Stars'ga sotadi.",
        sensitive: true,
        risk: "Sovg'a qaytarib bo'lmaydigan tarzda sotiladi — kollektsion sovg'alar ham.",
      },
      {
        key: "change_gift_settings",
        label: "Sovg'a sozlamalarini o'zgartirish",
        api: "can_change_gift_settings",
        about: "Kim sovg'a yubora olishini va ular qanday ko'rinishini sozlaydi.",
      },
      {
        key: "transfer_and_upgrade_gifts",
        label: "Sovg'ani o'tkazish va upgrade",
        api: "can_transfer_and_upgrade_gifts",
        about: "Bot sovg'ani boshqa akkauntga o'tkaza oladi yoki NFT'ga aylantiradi.",
        sensitive: true,
        risk: "Sovg'a boshqa akkauntga ketsa, uni qaytarish imkoni yo'q.",
      },
      {
        key: "transfer_stars",
        label: "Stars'ni botga o'tkazish",
        api: "can_transfer_stars",
        about: "Bot akkauntdagi Stars'ni o'z hisobiga ko'chiradi.",
        sensitive: true,
        risk: "Bu — haqiqiy pul. Bot yoki uni boshqaradigan odam balansni to'liq yechib olishi mumkin.",
      },
    ],
  },
  {
    key: "stories",
    title: "Stories",
    icon: "images",
    summary: "Akkaunt nomidan story joylash — kontent avtomatlashtiruvi uchun.",
    rights: [
      {
        key: "manage_stories",
        label: "Stories joylash va tahrirlash",
        api: "can_manage_stories",
        about: "Bot sizning nomingizdan story joylaydi, tahrirlaydi va o'chiradi.",
        sensitive: true,
        risk: "Story hamma obunachilaringizga darhol ko'rinadi — noto'g'ri post e'lon qilingach, uni faqat o'chirish mumkin.",
      },
    ],
  },
];

export const BUSINESS_RIGHTS: BusinessRight[] = BUSINESS_RIGHT_GROUPS.flatMap((group) => group.rights);
export const BUSINESS_RIGHTS_TOTAL = BUSINESS_RIGHTS.length;

const SENSITIVE_KEYS = new Set(BUSINESS_RIGHTS.filter((right) => right.sensitive).map((right) => right.key));

/** Whether granting this one acts on the owner's account in a way they cannot undo. */
export function isSensitiveRight(key: string): boolean {
  return SENSITIVE_KEYS.has(key);
}
