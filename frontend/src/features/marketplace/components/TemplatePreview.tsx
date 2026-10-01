"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";
import { ListGroup, ListRow } from "@/components/ui/List";
import { Modal } from "@/components/ui/Modal";
import { Textarea } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { showToast } from "@/components/ui/toast-store";
import { currencyLabel } from "@/features/analytics/format";
import { COMING_SOON_MODULES } from "@/features/bots/modules";
import { MainButton } from "@/lib/telegram/MainButton";
import { formatThousands } from "@/lib/utils/format";
import { MARKET_CATEGORY_LABEL, type MarketplaceTemplate, type TemplateReview } from "../data";
import { installTemplateAction, reviewTemplateAction } from "../actions";
import { StarRating } from "./StarRating";

/** Requirements naming a module that has not shipped yet — matched by the name the row shows. */
const COMING_SOON_REQUIREMENTS = new Set(COMING_SOON_MODULES.map((module) => module.name));

/**
 * What a template actually installs, before it is installed: the blocks it
 * lays down, what it needs from Telegram, and what other workspaces thought of
 * it. Installing blind and then unpicking a graph is the expensive path this
 * screen removes.
 *
 * The sheet's one action is "O'rnatish", and it sits on Telegram's own button —
 * so the footer that used to hold a grey "Yopish" beside a blue "O'rnatish" is
 * gone, and with it the second way out that the ✕ in the header already is.
 */
export function TemplatePreview({
  template,
  bots,
  onClose,
}: {
  template: MarketplaceTemplate | null;
  /** Where an installed template can land — a flow always belongs to a bot. */
  bots: { id: string; name: string }[];
  onClose: () => void;
}) {
  const [rating, setRating] = useState(0);
  const [text, setText] = useState("");
  const [localReviews, setLocalReviews] = useState<TemplateReview[]>([]);
  const [botId, setBotId] = useState(bots[0]?.id ?? "");
  const [installing, startInstall] = useTransition();
  const [sending, startReview] = useTransition();
  const router = useRouter();

  if (!template) return null;

  /*
   * Captured after the guard, because the two callbacks below cannot see it.
   * `template` is a parameter, so the compiler treats it as a mutable binding,
   * and narrowing a mutable binding does not survive into a nested function:
   * the guard proves it is there for this render and proves nothing inside a
   * handler that runs later.
   */
  const chosen = template;

  const reviews = [...localReviews, ...template.reviews];
  // A template can ask for a surface the product has not shipped yet; saying so
  // next to the requirement beats an install that quietly does nothing.
  const blockedBy = template.requires.filter((requirement) => COMING_SOON_REQUIREMENTS.has(requirement));
  const average = reviews.length
    ? Math.round((reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length) * 10) / 10
    : 0;

  function submitReview() {
    if (!rating) {
      showToast("Avval yulduz bilan baho bering");
      return;
    }
    const id = chosen.id;
    const score = rating;
    const body = text.trim();
    startReview(async () => {
      const result = await reviewTemplateAction(id, score, body);
      if (!result.ok) {
        showToast(result.message ?? "Sharhni yuborib bo'lmadi", { tone: "danger" });
        return;
      }
      // Kept locally as well as posted: the sheet is open over a list the
      // server has already sent, and a verdict that vanishes until the page is
      // reloaded reads as one that was not saved.
      setLocalReviews((current) => [
        { id: `local-${Date.now()}`, author: "Siz", rating: score, text: body, when: "hozir" },
        ...current,
      ]);
      setRating(0);
      setText("");
      showToast("Sharhingiz yuborildi");
    });
  }

  return (
    <Modal open onClose={onClose} labelledBy="template-preview-title" className="max-w-[520px]">
      <div className="flex flex-none items-center gap-3 px-4 py-3">
        <span className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-[8px] bg-accent-700 text-white">
          <Icon name={template.icon} size={17} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span id="template-preview-title" className="t-headline truncate">
            {template.name}
          </span>
          <span className="t-footnote t-secondary flex min-w-0 items-center gap-1.5">
            <span className="truncate">{MARKET_CATEGORY_LABEL[template.category]}</span>
            {/* The one word that keeps the three numbers below from being read
                as a record of use. */}
            {template.isDemo && <Badge tone="warning">Namuna</Badge>}
          </span>
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Yopish"
          className="oq-press flex h-[30px] w-[30px] flex-none cursor-pointer items-center justify-center rounded-full bg-neutral-800 text-neutral-500"
        >
          <Icon name="x" size={16} />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto overscroll-contain px-4 pb-6">
        <p className="t-subhead t-secondary m-0 px-1">{template.description}</p>

        {/* The four numbers that used to be a 11px meta line under the title,
            where a price and an install count sat in the same grey. */}
        <ListGroup
          footer={
            template.isDemo
              ? "Namuna shablon: o'rnatishlar soni va sharhlar mahsulotni ko'rsatish uchun yozilgan, haqiqiy foydalanish emas."
              : undefined
          }
        >
          <ListRow
            label="Narx"
            value={
              template.price === 0
                ? "Bepul"
                : `${formatThousands(template.price)} ${currencyLabel(template.currency)}`
            }
          />
          <ListRow label="Muallif" value={template.author} />
          <ListRow label="O'rnatishlar" value={formatThousands(template.installs)} />
          {reviews.length > 0 && <ListRow label="Baho" value={`${average.toFixed(1)} · ${reviews.length} sharh`} />}
          <ListRow label="Yangilangan" value={template.updatedAt} />
        </ListGroup>

        <ListGroup title="Nima o'rnatiladi" inset="icon">
          {template.preview.map((step, index) => (
            <div key={step.title} className="oq-row">
              <span className="flex h-[29px] w-[29px] flex-none items-center justify-center rounded-[8px] bg-neutral-800 text-neutral-400">
                <Icon name={step.icon} size={17} />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="t-body">
                  {index + 1}. {step.title}
                </span>
                <span className="t-footnote t-secondary">{step.detail}</span>
              </span>
            </div>
          ))}
        </ListGroup>

        {/* The group's footer is the one sentence this sheet keeps, and only
            when there is something to warn about — it changes whether
            installing now is worth doing. It replaces a four-line grey
            paragraph that said it twice. */}
        <ListGroup
          title="Nima kerak"
          footer={blockedBy.length > 0 ? `${blockedBy.join(", ")} bo'limi chiqqach ishlaydi.` : undefined}
        >
          {template.requires.map((requirement) => (
            <ListRow
              key={requirement}
              label={requirement}
              value={COMING_SOON_REQUIREMENTS.has(requirement) ? "Tez orada" : undefined}
            />
          ))}
        </ListGroup>

        <ListGroup title={reviews.length > 0 ? `Sharhlar (${reviews.length})` : "Sharhlar"}>
          {reviews.length === 0 ? (
            <ListRow>
              <span className="t-body t-secondary">Hali sharh yo&apos;q</span>
            </ListRow>
          ) : (
            reviews.map((review) => (
              <div key={review.id} className="oq-row">
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex items-center gap-2">
                    <span className="t-headline truncate">{review.author}</span>
                    <StarRating value={review.rating} />
                    <span className="t-footnote t-tertiary ml-auto flex-none">{review.when}</span>
                  </span>
                  {review.text && <span className="t-footnote t-secondary">{review.text}</span>}
                </span>
              </div>
            ))
          )}
        </ListGroup>

        {/*
          Only for a workspace that installed it. A rating is the one thing on
          this sheet a reader cannot check for themselves, and the form used to
          be open to anybody who could open the sheet — so a template could be
          scored five stars by somebody who had never run it. The server holds
          the same rule; this is the half that stops the reader typing a
          paragraph before being told.
        */}
        {template.installed ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <span className="t-headline">Bahongiz</span>
              <StarRating value={rating} size={20} onSelect={setRating} />
            </div>
            <Textarea
              rows={2}
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="Sozlashsiz ishladi"
              aria-label="Sharh matni"
            />
            {/* Plain accent text: the one filled action on this sheet installs. */}
            <button
              type="button"
              onClick={submitReview}
              disabled={sending}
              className="oq-press t-body min-h-[44px] cursor-pointer self-start px-1 text-accent-400 disabled:cursor-progress disabled:opacity-60"
            >
              {sending ? "Yuborilmoqda…" : "Sharh qoldirish"}
            </button>
          </div>
        ) : (
          <p className="t-footnote t-secondary m-0 px-1">
            Baho va sharhni shablonni o&apos;rnatgan ish maydonlari qoldiradi.
          </p>
        )}
      </div>

      {/* Which bot it lands in. Only where the answer is not obvious — one bot
          is not a choice, and no bot is a reason the button cannot work, said
          on the button rather than after the tap. */}
      {bots.length > 1 && (
        <ListGroup title="Qaysi botga">
          <ListRow label="Bot">
            <Select value={botId} onChange={(event) => setBotId(event.target.value)}>
              {bots.map((bot) => (
                <option key={bot.id} value={bot.id}>
                  {bot.name}
                </option>
              ))}
            </Select>
          </ListRow>
        </ListGroup>
      )}

      {/*
       * The install, actually performed.
       *
       * This button used to show "…o'rnatilmoqda" and close the sheet without
       * calling anything at all — the action existed and nothing referenced
       * it — so every outcome looked the same: nothing happened and nothing
       * was said. Now each outcome has words, and the one that worked has a
       * way to the flow it made.
       */}
      <MainButton
        inline
        text={bots.length === 0 ? "Avval bot ulang" : "O'rnatish"}
        disabled={bots.length === 0 || installing}
        loading={installing}
        onClick={() => {
          const id = chosen.id;
          const name = template.name;
          startInstall(async () => {
            const result = await installTemplateAction(id, botId);
            if (!result.ok || !result.flowId) {
              showToast(result.message ?? "Shablonni o'rnatib bo'lmadi", { tone: "danger" });
              return;
            }
            const flowId = result.flowId;
            onClose();
            showToast(`«${name}» oqim sifatida o'rnatildi`, {
              action: { label: "Ochish", run: () => router.push(`/flows/${flowId}`) },
            });
          });
        }}
      />
    </Modal>
  );
}
