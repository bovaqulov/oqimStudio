"use client";

import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/ui/Icon";
import type { AlbumItemKind, FlowNode, InvoiceConfig, MediaSource, MessageContentKind } from "@/features/flows";
import { resolveText } from "@/features/flows/localized-text";
import { useFlowEditorStore } from "../../store/useFlowEditorStore";
import { useTextLanguage } from "../Inspector/fields/TextLanguage";
import { answerShareButton, buttonKindMeta, effectiveButtonMode, toButtonRows } from "../../lib/buttons";
import { getContentDefinition, nodeContentKind } from "../../lib/message-content";
import { formatMessageLink, parseMessageLink } from "../../lib/telegram-link";
import { applySampleValues } from "../../lib/variables";
import { Markdown } from "./Markdown";
// Telegram's own colors, shared with the editor's test chat and the wizard's
// flow preview — see the file's own note on why they are raw values.
import { BUBBLE_BG, BUBBLE_TEXT, BUTTON_BG, BUTTON_STYLE_BG, CHAT_BG, LINK, META_TEXT } from "./telegram-colors";

const MEDIA_ICON: Partial<Record<MessageContentKind | "photo" | "video" | "audio" | "document", IconName>> = {
  photo: "image",
  video: "video-camera",
  audio: "music-notes",
  voice: "microphone",
  document: "file-text",
  animation: "film-strip",
};

/**
 * The price as the bubble prints it. Telegram shows a Stars amount as "⭐ 500"
 * rather than as a number with a currency code, and both the price line and the
 * pay button have to read the way the real invoice does.
 */
function invoicePrice(invoice: InvoiceConfig | undefined): string | null {
  const amount = invoice?.amount.trim();
  if (!amount) return null;
  return invoice?.currency === "XTR" ? `⭐ ${amount}` : `${amount} ${invoice?.currency ?? ""}`.trim();
}

/** The way out of an invoice, named by the author or by its default. */
function invoiceCancelLabel(invoice: InvoiceConfig | undefined): string {
  return invoice?.cancelLabel?.trim() || "Bekor qilish";
}

/**
 * Renders a block the way Telegram would show it to the end user. Reads
 * straight off the node, so it re-renders live as the editor is typed into.
 *
 * Every string it draws goes through `resolveText` in the language the fields
 * are being edited in, so the bubble shows the half of a translation the author
 * is looking at — and shows what would be sent in its place where they have not
 * written that half yet. Callers that hand over an already-resolved node (the
 * expanded editor does) pass plain strings, which resolve to themselves.
 */
export function TelegramPreview({ node }: { node: FlowNode }) {
  const botIdentity = useFlowEditorStore((state) => state.botIdentity);
  const { language, main } = useTextLanguage();
  const kind = nodeContentKind(node);
  const definition = getContentDefinition(kind);
  const mode = effectiveButtonMode(node);
  const share = answerShareButton(node);
  const rows = definition.supportsButtons ? toButtonRows(node.buttons ?? []) : [];
  const inlineRows = mode === "reply" ? [] : rows;
  const replyRows = mode === "reply" ? rows : [];
  const caption = applySampleValues(resolveText(node.text, language, main));
  // An invoice keyboard is not the author's alone: Telegram refuses one without
  // a pay button in the first row, and the runtime appends the block's own
  // `cancelled` exit under it — sent whether or not that branch is wired, so a
  // customer who changes their mind is never left with nothing to tap.
  const isInvoice = kind === "invoice";
  const payPrice = isInvoice ? invoicePrice(node.invoice) : null;

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-[14px] border border-neutral-800" style={{ background: CHAT_BG }}>
      <div
        className="flex flex-none items-center gap-2 border-b px-3 py-2"
        style={{ borderColor: "#0b1119", background: "#17212b" }}
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent-700 text-[13px] font-semibold text-white">
          {botIdentity.avatarEmoji || botIdentity.name.slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0">
          {/* The bot being edited, not a name from a demo: a preview that shows
              somebody else's bot is a preview of somebody else's chat. */}
          <div className="truncate text-[12px] font-medium text-white">{botIdentity.name}</div>
          <div className="text-[10px]" style={{ color: META_TEXT }}>
            bot
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        <div className="max-w-[300px]">
          <div className="overflow-hidden rounded-[12px] rounded-bl-[4px]" style={{ background: BUBBLE_BG }}>
            <ContentBody node={node} caption={caption} />
            {(isInvoice || inlineRows.length > 0) && (
              <div className="flex flex-col gap-[2px] p-[3px] pt-0">
                {isInvoice && (
                  <>
                    <div className="flex gap-[2px]">
                      <InlineButton>
                        <span className="min-w-0 truncate font-medium uppercase">
                          To&apos;lash{payPrice ? ` · ${payPrice}` : ""}
                        </span>
                      </InlineButton>
                    </div>
                    <div className="flex gap-[2px]">
                      <InlineButton>
                        <span className="min-w-0 truncate">{invoiceCancelLabel(node.invoice)}</span>
                      </InlineButton>
                    </div>
                  </>
                )}
                {inlineRows.map((row) => (
                  <div key={row[0]?.id} className="flex gap-[2px]">
                    {row.map((button) => (
                      <InlineButton key={button.id} styleTone={button.style}>
                        <Icon name={buttonKindMeta(button.kind).icon} size={11} className="flex-none" />
                        <span className="min-w-0 truncate">{resolveText(button.label, language, main) || "Tugma"}</span>
                      </InlineButton>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {(share || replyRows.length > 0) && (
        <div
          className="flex flex-none flex-col gap-1 border-t p-2"
          style={{ borderColor: "#0b1119", background: "#17212b" }}
        >
          {/* The question's own row — Telegram's request_contact / request_location. */}
          {share && (
            <span
              className="flex items-center justify-center gap-1 rounded-[7px] px-2 py-[7px] text-center text-[12px] text-white"
              style={{ background: BUTTON_BG }}
            >
              <Icon name={share.icon} size={11} className="flex-none" />
              <span className="min-w-0 truncate">{share.label}</span>
            </span>
          )}
          {replyRows.map((row) => (
            <div key={row[0]?.id} className="flex gap-1">
              {row.map((button) => (
                <span
                  key={button.id}
                  className="min-w-0 flex-1 truncate rounded-[7px] px-2 py-[7px] text-center text-[12px] text-white"
                  style={{ background: button.style ? BUTTON_STYLE_BG[button.style] : BUTTON_BG }}
                >
                  {resolveText(button.label, language, main) || "Tugma"}
                </span>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** One key of an inline keyboard, as Telegram paints it under the bubble. */
function InlineButton({ children, styleTone }: { children: ReactNode; styleTone?: string }) {
  const painted = styleTone ? BUTTON_STYLE_BG[styleTone] : undefined;
  return (
    <span
      className="flex min-w-0 flex-1 items-center justify-center gap-1 rounded-[7px] px-2 py-[7px] text-center text-[12px]"
      style={painted ? { background: painted, color: "#fff" } : { background: BUTTON_BG, color: LINK }}
    >
      {children}
    </span>
  );
}

function ContentBody({ node, caption }: { node: FlowNode; caption: string }) {
  const kind = nodeContentKind(node);

  switch (kind) {
    case "poll":
      return <PollBody node={node} />;
    case "location":
      return <LocationBody node={node} />;
    case "contact":
      return <ContactBody node={node} />;
    case "invoice":
      return <InvoiceBody node={node} />;
    case "album":
      return <AlbumBody node={node} />;
    case "copy":
      return <CopyBody node={node} />;
    case "text":
      return (
        <div className="px-[10px] py-[7px]">
          <BubbleText text={caption} placeholder="Xabar matni bo'sh" />
          <Meta />
        </div>
      );
    default:
      return (
        <>
          <MediaPlaceholder kind={kind} source={node.mediaSource} />
          <div className="px-[10px] py-[7px]">
            {caption.trim() && <BubbleText text={caption} placeholder="" />}
            <Meta />
          </div>
        </>
      );
  }
}

function BubbleText({ text, placeholder }: { text: string; placeholder: string }) {
  const value = text.trim();
  return (
    <div
      className="text-[13px] leading-[1.35] whitespace-pre-wrap"
      style={{ color: value ? BUBBLE_TEXT : META_TEXT, fontStyle: value ? undefined : "italic" }}
    >
      {value ? <Markdown text={value} /> : placeholder}
    </div>
  );
}

function Meta() {
  return (
    <div className="mt-[2px] text-right text-[10px]" style={{ color: META_TEXT }}>
      14:32
    </div>
  );
}

/** True for kinds a browser can actually display from a URL, so the preview shows the real thing. */
function isViewableImage(kind: MessageContentKind | AlbumItemKind): boolean {
  return kind === "photo" || kind === "animation";
}

function MediaPlaceholder({ kind, source }: { kind: MessageContentKind; source?: MediaSource }) {
  const url = source?.kind === "url" ? source.value.trim() : "";

  if (url && isViewableImage(kind)) {
    return (
      // Plain <img>: the URL is arbitrary user input, which next/image cannot
      // serve without whitelisting every possible remote host up front.
      // eslint-disable-next-line @next/next/no-img-element
      <img src={url} alt="" style={{ maxHeight: 220, width: "100%", objectFit: "cover", display: "block" }} />
    );
  }

  return (
    <div
      className="flex flex-col items-center justify-center gap-1 px-3 text-center"
      style={{ height: 150, background: "#0d1b28", color: META_TEXT }}
    >
      <Icon name={MEDIA_ICON[kind] ?? "image"} size={24} />
      <span className="text-[10px]">{getContentDefinition(kind).label}</span>
      {source?.fileName && <span className="truncate text-[9.5px] opacity-80">{source.fileName}</span>}
      {url && <span className="max-w-full truncate text-[9.5px] opacity-80">{url}</span>}
    </div>
  );
}

function PollBody({ node }: { node: FlowNode }) {
  const { language, main } = useTextLanguage();
  const poll = node.poll;
  const options = poll?.options
    .map((option) => ({ id: option.id, text: resolveText(option.text, language, main).trim() }))
    .filter((option) => option.text) ?? [];
  const question = resolveText(poll?.question, language, main).trim();
  return (
    <div className="px-[10px] py-[8px]">
      <div className="text-[13px] font-medium" style={{ color: question ? BUBBLE_TEXT : META_TEXT }}>
        {question || "So'rovnoma savoli"}
      </div>
      <div className="mt-[2px] text-[10.5px]" style={{ color: META_TEXT }}>
        {poll?.isAnonymous === false ? "Ochiq" : "Anonim"} {poll?.isQuiz ? "viktorina" : "so'rovnoma"}
      </div>
      <div className="mt-2 flex flex-col gap-2">
        {(options.length ? options : [{ id: "ph1", text: "Variant 1" }, { id: "ph2", text: "Variant 2" }]).map(
          (option) => (
            <div key={option.id} className="flex items-center gap-2">
              <span
                className="h-[15px] w-[15px] flex-none rounded-full border"
                style={{ borderColor: options.length ? LINK : META_TEXT }}
              />
              <span className="text-[12.5px]" style={{ color: options.length ? BUBBLE_TEXT : META_TEXT }}>
                {option.text}
              </span>
            </div>
          ),
        )}
      </div>
      <div className="mt-2 text-[10.5px]" style={{ color: META_TEXT }}>
        0 ovoz
      </div>
      <Meta />
    </div>
  );
}

function LocationBody({ node }: { node: FlowNode }) {
  const location = node.location;
  const hasVenue = !!location?.title?.trim();
  return (
    <>
      <div
        className="relative flex items-center justify-center"
        style={{ height: 140, background: "#1b3a2e", color: "#8fd9ae" }}
      >
        <Icon name="map-pin" size={26} />
      </div>
      {hasVenue && (
        <div className="px-[10px] py-[7px]">
          <div className="text-[13px] font-medium" style={{ color: BUBBLE_TEXT }}>
            {location?.title}
          </div>
          {location?.address?.trim() && (
            <div className="text-[11.5px]" style={{ color: META_TEXT }}>
              {location.address}
            </div>
          )}
        </div>
      )}
      <div className="px-[10px] pb-[7px]">
        {!hasVenue && (
          <div className="text-[11px]" style={{ color: META_TEXT }}>
            {location?.latitude && location?.longitude
              ? `${location.latitude}, ${location.longitude}`
              : "Koordinata kiritilmagan"}
          </div>
        )}
        <Meta />
      </div>
    </>
  );
}

function ContactBody({ node }: { node: FlowNode }) {
  const contact = node.contact;
  const name = [contact?.firstName, contact?.lastName].filter(Boolean).join(" ").trim();
  return (
    <div className="px-[10px] py-[8px]">
      <div className="flex items-center gap-2">
        <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-accent-700 text-[13px] font-semibold text-white">
          {name ? name.charAt(0).toUpperCase() : "?"}
        </span>
        <div className="min-w-0">
          <div className="truncate text-[13px] font-medium" style={{ color: name ? BUBBLE_TEXT : META_TEXT }}>
            {name || "Ism kiritilmagan"}
          </div>
          <div className="truncate text-[11.5px]" style={{ color: META_TEXT }}>
            {applySampleValues(contact?.phoneNumber ?? "") || "Telefon yo'q"}
          </div>
        </div>
      </div>
      <Meta />
    </div>
  );
}

function InvoiceBody({ node }: { node: FlowNode }) {
  const invoice = node.invoice;
  return (
    <div className="px-[10px] py-[8px]">
      <div className="text-[13px] font-medium" style={{ color: invoice?.title.trim() ? BUBBLE_TEXT : META_TEXT }}>
        {invoice?.title.trim() || "To'lov nomi"}
      </div>
      <div className="mt-[3px] text-[12px] leading-[1.35]" style={{ color: META_TEXT }}>
        {invoice?.description.trim() || "Tavsif kiritilmagan"}
      </div>
      {/* The pay button lives on the keyboard below, where Telegram puts it —
          the bubble itself only carries the price. */}
      <div className="mt-[6px] text-[13px] font-semibold" style={{ color: BUBBLE_TEXT }}>
        {invoicePrice(invoice) ?? "Summa kiritilmagan"}
      </div>
      <Meta />
    </div>
  );
}

/**
 * A copied message's content lives on Telegram's servers, so the preview can
 * only name the source rather than reproduce it — and says so, instead of
 * implying it knows what will arrive.
 */
function CopyBody({ node }: { node: FlowNode }) {
  const link = node.copyLink?.trim() ? parseMessageLink(node.copyLink) : null;
  return (
    <div className="px-[10px] py-[8px]">
      <div className="flex items-center gap-1.5" style={{ color: META_TEXT }}>
        <Icon name="copy" size={12} />
        <span className="text-[10.5px]">Xabar nusxasi</span>
      </div>
      {link ? (
        <>
          <div className="mt-1 font-mono text-[12px]" style={{ color: BUBBLE_TEXT }}>
            {formatMessageLink(link)}
          </div>
          <div className="mt-[3px] text-[10.5px] leading-relaxed" style={{ color: META_TEXT }}>
            Asl xabar mazmuni shu yerda ko&apos;rinadi — u Telegram serverida saqlanadi.
          </div>
        </>
      ) : (
        <div className="mt-1 text-[12px] italic" style={{ color: META_TEXT }}>
          Xabar havolasi kiritilmagan
        </div>
      )}
      <Meta />
    </div>
  );
}

function AlbumBody({ node }: { node: FlowNode }) {
  const { language, main } = useTextLanguage();
  const items = node.album ?? [];
  // Telegram shows the album under the first item's caption, so that is the one
  // the preview draws — the rest ride along on items nothing is written under.
  const caption = applySampleValues(resolveText(items[0]?.caption, language, main));
  return (
    <>
      {items.length === 0 ? (
        <div className="flex items-center justify-center" style={{ height: 120, background: "#0d1b28", color: META_TEXT }}>
          <span className="text-[11px]">Albom bo&apos;sh</span>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-[2px]">
          {items.map((item, index) => {
            const url = item.source?.kind === "url" ? item.source.value.trim() : "";
            // A lone trailing item spans the row, the way Telegram lays albums out.
            const span = items.length % 2 === 1 && index === items.length - 1 ? "span 2" : undefined;
            return (
              <div
                key={item.id}
                className="flex flex-col items-center justify-center gap-0.5 overflow-hidden"
                style={{ height: 88, background: "#0d1b28", color: META_TEXT, gridColumn: span }}
              >
                {url && isViewableImage(item.kind) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={url} alt="" style={{ height: "100%", width: "100%", objectFit: "cover" }} />
                ) : (
                  <>
                    <Icon name={MEDIA_ICON[item.kind] ?? "image"} size={18} />
                    <span className="text-[9px]">{index + 1}</span>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
      <div className="px-[10px] py-[7px]">
        {caption.trim() && <BubbleText text={caption} placeholder="" />}
        <Meta />
      </div>
    </>
  );
}
