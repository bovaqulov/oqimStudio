import type { IconName } from "@/components/ui/Icon";
import type { BotLanguage } from "@/features/bots/types";
import type {
  AlbumItem,
  AlbumItemKind,
  FlowNode,
  LanguageConfig,
  LanguageOption,
  MenuConfig,
  MessageContentKind,
  PollConfig,
  PollOption,
  RatingConfig,
  RatingScale,
  SubscriptionChannel,
  SubscriptionConfig,
  InvoiceConfig,} from "@/features/flows";
import { DEFAULT_LANGUAGE, resolveText } from "@/features/flows/localized-text";
import { formatMessageLink, parseMessageLink } from "./telegram-link";

/** Telegram's own limits — see https://core.telegram.org/bots/api#sendpoll and #sendmediagroup */
export const POLL_MIN_OPTIONS = 2;
export const POLL_MAX_OPTIONS = 12;
export const ALBUM_MIN_ITEMS = 2;
export const ALBUM_MAX_ITEMS = 10;

/** How the shared body field behaves for a given content kind. */
export type BodyRole =
  /** The body *is* the message (`sendMessage.text`). */
  | "text"
  /** The body rides along as `caption`. */
  | "caption"
  /** The kind carries no body at all — its own fields replace it. */
  | "none";

export interface MessageContentDefinition {
  kind: MessageContentKind;
  label: string;
  icon: IconName;
  /** The Bot API method this kind is delivered with. */
  api: string;
  bodyRole: BodyRole;
  /**
   * `sendMediaGroup` is the one method that accepts no `reply_markup` at all,
   * so an album hides the keyboard editor entirely.
   */
  supportsButtons: boolean;
  /**
   * `sendInvoice` only accepts an `InlineKeyboardMarkup` (and it must carry a
   * pay button), so the inline/reply switch is not offered for it.
   */
  inlineButtonsOnly: boolean;
  /** Carries a file, so the block needs a URL, a file_id, or an upload. */
  needsFile: boolean;
}

const DEFINITIONS: Record<MessageContentKind, MessageContentDefinition> = {
  text: {
    kind: "text",
    label: "Matn",
    icon: "text-aa",
    api: "sendMessage",
    bodyRole: "text",
    supportsButtons: true,
    needsFile: false,
    inlineButtonsOnly: false,
  },
  photo: {
    kind: "photo",
    label: "Rasm",
    icon: "image",
    api: "sendPhoto",
    bodyRole: "caption",
    supportsButtons: true,
    needsFile: true,
    inlineButtonsOnly: false,
  },
  video: {
    kind: "video",
    label: "Video",
    icon: "video-camera",
    api: "sendVideo",
    bodyRole: "caption",
    supportsButtons: true,
    needsFile: true,
    inlineButtonsOnly: false,
  },
  audio: {
    kind: "audio",
    label: "Audio",
    icon: "music-notes",
    api: "sendAudio",
    bodyRole: "caption",
    supportsButtons: true,
    needsFile: true,
    inlineButtonsOnly: false,
  },
  voice: {
    kind: "voice",
    label: "Ovozli xabar",
    icon: "microphone",
    api: "sendVoice",
    bodyRole: "caption",
    supportsButtons: true,
    needsFile: true,
    inlineButtonsOnly: false,
  },
  document: {
    kind: "document",
    label: "Fayl",
    icon: "file-text",
    api: "sendDocument",
    bodyRole: "caption",
    supportsButtons: true,
    needsFile: true,
    inlineButtonsOnly: false,
  },
  animation: {
    kind: "animation",
    label: "GIF",
    icon: "film-strip",
    api: "sendAnimation",
    bodyRole: "caption",
    supportsButtons: true,
    needsFile: true,
    inlineButtonsOnly: false,
  },
  location: {
    kind: "location",
    label: "Joylashuv",
    icon: "map-pin",
    api: "sendLocation / sendVenue",
    bodyRole: "none",
    supportsButtons: true,
    needsFile: false,
    inlineButtonsOnly: false,
  },
  contact: {
    kind: "contact",
    label: "Kontakt",
    icon: "address-book",
    api: "sendContact",
    bodyRole: "none",
    supportsButtons: true,
    needsFile: false,
    inlineButtonsOnly: false,
  },
  poll: {
    kind: "poll",
    label: "So'rovnoma",
    icon: "list-checks",
    api: "sendPoll",
    bodyRole: "none",
    supportsButtons: true,
    needsFile: false,
    inlineButtonsOnly: false,
  },
  invoice: {
    kind: "invoice",
    label: "To'lov",
    icon: "credit-card",
    api: "sendInvoice",
    bodyRole: "none",
    supportsButtons: true,
    needsFile: false,
    inlineButtonsOnly: true,
  },
  album: {
    kind: "album",
    label: "Media albom",
    icon: "images",
    api: "sendMediaGroup",
    bodyRole: "none",
    supportsButtons: false,
    needsFile: false,
    inlineButtonsOnly: false,
  },
  copy: {
    kind: "copy",
    label: "Xabar nusxasi",
    icon: "copy",
    api: "copyMessage",
    // The copied message brings its own content, so there is nothing to write here.
    bodyRole: "none",
    supportsButtons: true,
    needsFile: false,
    inlineButtonsOnly: false,
  },
};

/** Selector order — plain text first, then attachments, then the structured kinds. */
export const CONTENT_KINDS: MessageContentKind[] = [
  "text",
  "photo",
  "video",
  "audio",
  "voice",
  "document",
  "animation",
  "location",
  "contact",
  "poll",
  "album",
  "copy",
];

/**
 * The one line an invoice block shows on its card: what is being sold and for
 * how much. Written into `node.text` as the fields change, so the canvas reads
 * a summary the same way it does for every other block.
 */
export function summarizeInvoice(invoice: InvoiceConfig | undefined): string {
  const title = invoice?.title?.trim() || "Mahsulot nomi kiritilmagan";
  const amount = invoice?.amount?.trim();
  return amount ? `${title} — ${amount} ${invoice?.currency ?? ""}`.trim() : title;
}

export function getContentDefinition(kind: MessageContentKind): MessageContentDefinition {
  return DEFINITIONS[kind];
}

/**
 * What the block actually sends.
 *
 * The invoice block has no content picker of its own — being an invoice is the
 * whole point of it — so it answers for itself rather than falling through to
 * "text", which is what would otherwise decide its preview, its issue list and
 * the keyboard it is allowed to carry. A message node with no explicit kind
 * predates the content selector and is plain text.
 */
/**
 * Block types that answer for themselves, whatever `contentKind` says.
 *
 * A block converted out of Xabar arrives still carrying that block's
 * `contentKind` — an album among them, which Telegram sends with no keyboard
 * at all. Every type here builds a keyboard that is the point of it, so an
 * album would make it the one thing it cannot be: a message nobody can tap.
 *
 * Mirrors `apps/engine/sender.py::TYPE_CONTENT_KINDS`, and the runtime is the
 * side that decides — `sender.content_kind` is what picks the Bot API method.
 * The table used to hold two of these six, so a Xabar turned into a
 * «Obuna tekshirish» was an album to the editor and a text message to the
 * runtime: the panel asked for a file, the validator demanded one, and what
 * went out had neither. `tests_vocabulary_contract` reads this table and fails
 * if the two drift again.
 */
const TYPE_CONTENT_KINDS: Partial<Record<FlowNode["type"], MessageContentKind>> = {
  language: "text",
  followup: "text",
};

export function nodeContentKind(node: FlowNode): MessageContentKind {
  return TYPE_CONTENT_KINDS[node.type] ?? node.contentKind ?? "text";
}

/* -------------------------------------------------------------------------- */
/* Menu, subscription, rating, language                                        */
/* -------------------------------------------------------------------------- */

/**
 * How many rows a menu is worth drawing.
 *
 * One button is not a menu — it is a message with a next step, which Xabar
 * already does. Above eight the keyboard is longer than the phone screen that
 * has to show it, and Telegram's own row limit is doing the rest of the work.
 */
export const MENU_MIN_BUTTONS = 2;
export const MENU_MAX_BUTTONS = 8;

/** What the home row says and where it lands when the author has not renamed it. */
export const MENU_HOME_LABEL = "🏠 Bosh menyu";
export const MENU_HOME_COMMAND = "start";
/** One click adds this; it is an ordinary button, so it branches like one. */
export const MENU_BACK_LABEL = "⬅️ Orqaga";

/** The home row as it is actually configured, or null when the menu has none. */
export function menuHomeRow(node: FlowNode): { label: string; command: string } | null {
  const menu: MenuConfig | undefined = node.menu;
  if (!menu?.homeLabel) return null;
  return {
    label: menu.homeLabel,
    command: (menu.homeCommand || MENU_HOME_COMMAND).replace(/^\//, ""),
  };
}

/**
 * What a question's "you may skip this" row says. Mirrors `sender.SKIP_LABEL`.
 *
 * The row is the block's own, like the invoice's «Bekor» and the «Orqaga»
 * under it — `allowSkip` puts it on the keyboard — but unlike either it
 * publishes no port on the card: declining leaves through the same `out` exit
 * an answer would, so there is nothing extra for an author to wire.
 */
export const SKIP_ROW_LABEL = "O'tkazib yuborish";

/** The check row's label when the author has not renamed it. */
export const SUBSCRIPTION_CHECK_LABEL = "✅ Obunani tekshirish";
/** Said when the check comes back short. */
export const SUBSCRIPTION_RETRY_TEXT = "Hali hammasiga obuna bo'lmadingiz. Obuna bo'ling va yana tekshiring.";

/** The block's channel gate, with everything a graph saved without one needs. */
export function nodeSubscription(node: FlowNode): SubscriptionConfig {
  return {
    channels: node.subscription?.channels ?? [],
    checkLabel: node.subscription?.checkLabel || SUBSCRIPTION_CHECK_LABEL,
    retryText: node.subscription?.retryText || SUBSCRIPTION_RETRY_TEXT,
  };
}

/**
 * Where the join row points. A public channel needs no link pasted in —
 * `@name` *is* its address — so the field is only ever filled in for the
 * private ones, which have no public address at all.
 */
export function channelInviteUrl(channel: SubscriptionChannel): string {
  const url = channel.inviteUrl?.trim();
  if (url) return url;
  const handle = channel.chatId.trim();
  return handle.startsWith("@") ? `https://t.me/${handle.slice(1)}` : "";
}

/** Name the score is stored under when the author has not chosen one. */
export const RATING_VARIABLE = "baho";

export const RATING_SCALE_OPTIONS: { value: RatingScale; label: string }[] = [
  { value: "stars5", label: "1–5 yulduz" },
  { value: "nps10", label: "NPS 0–10" },
];

export function nodeRating(node: FlowNode): RatingConfig {
  return {
    scale: node.rating?.scale ?? "stars5",
    variable: node.rating?.variable?.trim() || RATING_VARIABLE,
    thanksText: node.rating?.thanksText ?? "",
  };
}

/**
 * The scores a rating block offers, in the order they are drawn. NPS starts at
 * nought because that is what the question is defined on — a ten-point scale
 * beginning at one is a different measure wearing the same name.
 */
export function ratingScores(scale: RatingScale): number[] {
  return scale === "nps10"
    ? Array.from({ length: 11 }, (_, index) => index)
    : Array.from({ length: 5 }, (_, index) => index + 1);
}

/** What one score's button says. */
export function ratingButtonLabel(scale: RatingScale, score: number): string {
  return scale === "nps10" ? String(score) : `${score}⭐`;
}

/** The variable a language block writes. Fixed: the rest of the product reads this name. */
export const LANGUAGE_VARIABLE = "mijoz_tili";

/**
 * Every language a bot here can be written in, as the customer sees it named.
 * The studio's own labels are Uzbek ("Ruscha"); these are the endonyms, since
 * the person reading this row is looking for the word in their own language.
 */
export const LANGUAGE_LABELS: { code: string; label: string }[] = [
  { code: "uz", label: "🇺🇿 O'zbekcha" },
  { code: "ru", label: "🇷🇺 Русский" },
  { code: "en", label: "🇬🇧 English" },
];

/**
 * What a fresh language block offers: Uzbek and Russian, the pair a business
 * here actually answers in — and the pair a bot is enabled for by default, so
 * the block and the bot agree the moment it is added. English is one click
 * away, and switched on for the bot in the same click.
 */
export function createLanguageOptions(): LanguageOption[] {
  return LANGUAGE_LABELS.filter((option) => option.code !== "en").map((option) => ({ id: uid("lo"), ...option }));
}

/**
 * The languages this block offers. A block saved with none falls back to the
 * defaults rather than sending a message with an empty keyboard — a question
 * nobody can answer parks the run for good.
 */
export function nodeLanguages(node: FlowNode): LanguageConfig {
  const options = node.language?.options ?? [];
  return { options: options.length ? options : createLanguageOptions() };
}

export function createSubscriptionChannel(): SubscriptionChannel {
  return { id: uid("sc"), chatId: "" };
}

/**
 * The next language a block can offer — the first known one it is not already
 * carrying, filled in.
 *
 * `null` when all three are on the list, which is what disables the button.
 * It used to hand back a blank row: the author pressed "+ Til", got two empty
 * fields, and the block immediately warned them that every language needs a
 * code and a label — the panel scolding somebody for pressing its own button.
 * A free-typed code was the worse half of it, since only the codes in
 * `LANGUAGE_LABELS` mean anything to the runtime.
 */
export function nextLanguageOption(existing: LanguageOption[]): LanguageOption | null {
  const taken = new Set(existing.map((option) => option.code.trim().toLowerCase()));
  const next = LANGUAGE_LABELS.find((option) => !taken.has(option.code));
  return next ? { id: uid("lo"), ...next } : null;
}

export const ALBUM_ITEM_KIND_OPTIONS: { value: AlbumItemKind; label: string }[] = [
  { value: "photo", label: "Rasm" },
  { value: "video", label: "Video" },
  { value: "audio", label: "Audio" },
  { value: "document", label: "Fayl" },
];

export const INVOICE_CURRENCY_OPTIONS: { value: string; label: string }[] = [
  // Telegram Stars: `sendInvoice` with currency "XTR" and an empty
  // provider_token, so it needs no merchant account of its own.
  { value: "XTR", label: "XTR — Telegram Stars" },
  { value: "UZS", label: "UZS — so'm" },
  { value: "USD", label: "USD — dollar" },
  { value: "EUR", label: "EUR — evro" },
  { value: "RUB", label: "RUB — rubl" },
];

function uid(prefix: string): string {
  return `${prefix}${Date.now()}${Math.round(Math.random() * 1000)}`;
}

export function createPollOption(text = ""): PollOption {
  return { id: uid("po"), text };
}

export function createAlbumItem(kind: AlbumItemKind = "photo"): AlbumItem {
  return { id: uid("ai"), kind };
}

/** A fresh poll starts at Telegram's two-option minimum so the block is valid the moment it is added. */
export function createPollConfig(): PollConfig {
  return {
    question: "",
    options: [createPollOption(), createPollOption()],
    isAnonymous: true,
    isQuiz: false,
    allowsMultipleAnswers: false,
  };
}

/**
 * Blocking problems with the current content configuration, in the user's
 * language. Empty means the block is ready to send.
 *
 * "Empty" is asked of the string that would actually go out, not of one
 * language's half of it: a block written in Uzbek and not yet in Russian sends
 * the Uzbek, so it is a translation still to write rather than a broken block.
 */
export function contentIssues(node: FlowNode, main: BotLanguage = DEFAULT_LANGUAGE): string[] {
  const kind = nodeContentKind(node);
  const issues: string[] = [];

  if (kind === "text" && !resolveText(node.text, main, main).trim()) issues.push("Xabar matni bo'sh.");

  if (DEFINITIONS[kind].needsFile) {
    const source = node.mediaSource;
    if (!source || (source.kind !== "upload" && !source.value.trim())) {
      // The kind's own name carries "what is missing" on its own: the template
      // that put "… uchun fayl" after it read as "Fayl uchun fayl
      // biriktirilmagan" on the one block where the two words are the same.
      issues.push(`${DEFINITIONS[kind].label} biriktirilmagan.`);
    } else if (source.kind === "upload" && !source.value.trim()) {
      issues.push(`"${source.fileName ?? "Fayl"}" hali yuklanmagan.`);
    }
  }

  if (kind === "poll") {
    const poll = node.poll;
    if (!resolveText(poll?.question, main, main).trim()) issues.push("So'rovnoma savoli kiritilmagan.");
    const filled = poll?.options.filter((option) => resolveText(option.text, main, main).trim()) ?? [];
    if (filled.length < POLL_MIN_OPTIONS) issues.push(`Kamida ${POLL_MIN_OPTIONS} ta variant to'ldirilishi kerak.`);
    if (poll?.isQuiz && !poll.correctOptionId) issues.push("Viktorina uchun to'g'ri javobni belgilang.");
  }

  if (kind === "location") {
    if (!node.location?.latitude.trim() || !node.location?.longitude.trim()) {
      issues.push("Kenglik va uzunlik kiritilishi shart.");
    }
  }

  if (kind === "contact") {
    if (!node.contact?.phoneNumber.trim()) issues.push("Telefon raqami kiritilmagan.");
    if (!node.contact?.firstName.trim()) issues.push("Kontakt ismi kiritilmagan.");
  }

  if (kind === "invoice") {
    if (!node.invoice?.title.trim()) issues.push("To'lov nomi kiritilmagan.");
    if (!node.invoice?.description.trim()) issues.push("To'lov tavsifi kiritilmagan.");
    if (!node.invoice?.amount.trim()) issues.push("To'lov summasi kiritilmagan.");
  }

  if (kind === "copy") {
    if (!node.copyLink?.trim()) issues.push("Xabar havolasi kiritilmagan.");
    else if (!parseMessageLink(node.copyLink)) issues.push("Havola t.me xabar havolasiga o'xshamaydi.");
  }

  if (kind === "album") {
    const count = node.album?.length ?? 0;
    if (count < ALBUM_MIN_ITEMS) issues.push(`Albomda kamida ${ALBUM_MIN_ITEMS} ta element bo'lishi kerak.`);
    const kinds = new Set((node.album ?? []).map((item) => item.kind));
    if (kinds.has("audio") && kinds.size > 1) issues.push("Audio boshqa media turlari bilan aralashtirilmaydi.");
    if (kinds.has("document") && kinds.size > 1) issues.push("Fayl boshqa media turlari bilan aralashtirilmaydi.");
  }

  return issues;
}

/**
 * One-line canvas summary for kinds whose body field is empty by design.
 *
 * `main` is the bot's own language — the card is drawn where nobody has picked
 * one to read in, so it reads back the string the bot sends by default.
 */
export function summarizeContent(node: FlowNode, main: BotLanguage = DEFAULT_LANGUAGE): string {
  const kind = nodeContentKind(node);
  switch (kind) {
    case "poll": {
      const question = resolveText(node.poll?.question, main, main).trim();
      const count = node.poll?.options.filter((option) => resolveText(option.text, main, main).trim()).length ?? 0;
      const mode = node.poll?.isQuiz ? "Viktorina" : "So'rovnoma";
      return question ? `${mode}: ${question} · ${count} variant` : `${mode} sozlanmagan`;
    }
    case "location": {
      const { latitude, longitude, title } = node.location ?? { latitude: "", longitude: "" };
      if (title?.trim()) return `📍 ${title}`;
      return latitude && longitude ? `📍 ${latitude}, ${longitude}` : "Joylashuv sozlanmagan";
    }
    case "contact": {
      const name = [node.contact?.firstName, node.contact?.lastName].filter(Boolean).join(" ").trim();
      const phone = node.contact?.phoneNumber?.trim();
      return name || phone ? `${name}${name && phone ? " · " : ""}${phone ?? ""}` : "Kontakt sozlanmagan";
    }
    case "invoice": {
      const title = node.invoice?.title.trim();
      const amount = node.invoice?.amount.trim();
      if (!title) return "To'lov sozlanmagan";
      return amount ? `${title} — ${amount} ${node.invoice?.currency ?? ""}`.trim() : title;
    }
    case "album": {
      const count = node.album?.length ?? 0;
      return count ? `${count} ta element` : "Albom bo'sh";
    }
    case "copy": {
      const link = node.copyLink ? parseMessageLink(node.copyLink) : null;
      return link ? `Nusxa: ${formatMessageLink(link)}` : "Xabar havolasi kiritilmagan";
    }
    default:
      return resolveText(node.text, main, main);
  }
}
