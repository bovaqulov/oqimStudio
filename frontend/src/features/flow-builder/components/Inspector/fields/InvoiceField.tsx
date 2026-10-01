"use client";

import Link from "next/link";
import { Input, Textarea } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import type { InvoiceConfig } from "@/features/flows";
import { INVOICE_CURRENCY_OPTIONS } from "../../../lib/message-content";
import { useFlowEditorStore } from "../../../store/useFlowEditorStore";
import { ADVANCED_SECTION_TITLE } from "./advanced-fields";
import { CollapsibleSection } from "./CollapsibleSection";
import { FieldHint } from "./FieldHint";
import { FieldLabel } from "./FieldLabel";

const EMPTY: InvoiceConfig = { title: "", description: "", currency: "UZS", amount: "" };

/** `sendInvoice`. The amount stays human-readable here and is scaled to the currency's smallest unit at send time. */
export function InvoiceField({
  value,
  onChange,
}: {
  value?: InvoiceConfig;
  onChange: (value: InvoiceConfig) => void;
}) {
  const invoice = value ?? EMPTY;
  // Only providers already connected to this bot — the editor never offers one
  // that would fail the moment a customer taps "To'lash".
  const providers = useFlowEditorStore((s) => s.paymentProviders);
  const botId = useFlowEditorStore((s) => s.botId);

  const selected = providers.find((provider) => provider.id === invoice.providerId) ?? providers[0];
  // With a provider chosen, the currency list is that provider's own — offering
  // UZS on a Stars connection would build an invoice Telegram rejects.
  const currencies = selected
    ? INVOICE_CURRENCY_OPTIONS.filter((option) => selected.currencies.includes(option.value))
    : INVOICE_CURRENCY_OPTIONS;
  const stars = invoice.currency === "XTR";

  // A closed drawer that hides *whether* anything is set is worse than the
  // fields it folded away, so the header says what is in there.
  const extrasSummary = [invoice.currency, invoice.cancelLabel?.trim() || null]
    .filter(Boolean)
    .join(" · ");

  function commit(patch: Partial<InvoiceConfig>) {
    onChange({ ...invoice, ...patch });
  }

  function chooseProvider(providerId: string) {
    const provider = providers.find((item) => item.id === providerId);
    // Switching provider carries the currency with it when the old one is not
    // supported, rather than leaving an invoice that cannot be sent.
    const currency =
      provider && !provider.currencies.includes(invoice.currency)
        ? (provider.currencies[0] ?? invoice.currency)
        : invoice.currency;
    commit({ providerId, currency });
  }

  return (
    <div className="flex flex-col gap-2.5">
      {providers.length === 0 ? (
        <div className="rounded-md border border-dashed border-warning-bg bg-warning-bg/25 p-2.5">
          <div className="text-[11.5px] max-md:text-[13px] leading-relaxed text-neutral-300">
            Bu botga hech qanday to&apos;lov provayderi ulanmagan — invoys yuborilmaydi.
          </div>
          {botId && (
            <Link
              href={`/bots/${botId}/payments`}
              className="mt-1.5 inline-block text-[11.5px] max-md:text-[13px] text-accent-300 hover:text-accent-200"
            >
              Bot → To&apos;lovlar bo&apos;limida ulash
            </Link>
          )}
        </div>
      ) : (
        <label className="flex flex-col gap-1">
          <FieldLabel>To&apos;lov provayderi</FieldLabel>
          <Select value={selected?.id ?? ""} onChange={(event) => chooseProvider(event.target.value)}>
            {providers.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.name}
                {provider.mode ? ` · ${provider.mode === "live" ? "LIVE" : "TEST"}` : ""}
              </option>
            ))}
          </Select>
          <FieldHint>
            Faqat shu botga ulangan provayderlar ko&apos;rsatiladi
            {botId && (
              <>
                {" · "}
                <Link href={`/bots/${botId}/payments`} className="text-accent-300 hover:text-accent-200">
                  boshqarish
                </Link>
              </>
            )}
          </FieldHint>
        </label>
      )}

      {/* "Mahsulot nomi", not "Nomi": the block's own title field sits directly
          above this one in the inspector, and two fields both labelled "Nomi"
          is a form nobody can fill in confidently. */}
      <label className="flex flex-col gap-1">
        <FieldLabel>Mahsulot nomi</FieldLabel>
        <Input
          value={invoice.title}
          onChange={(event) => commit({ title: event.target.value })}
          placeholder="Premium kurs"
          maxLength={32}
        />
      </label>

      {/* `description` is not an extra. It used to sit in the drawer below with
          the currency and the cancel label, on the reading that most invoices
          never revisit it — but Telegram *refuses* `sendInvoice` without one
          ("Bad Request: parameter \"description\" is required"), so an author
          who never opened the drawer shipped a flow that failed at the moment
          a customer tapped Pay, and the customer got the fallback line instead
          of an invoice. A field the API requires belongs where the author
          cannot miss it. */}
      <label className="flex flex-col gap-1">
        <FieldLabel>Mahsulot tavsifi</FieldLabel>
        <Textarea
          rows={2}
          value={invoice.description}
          onChange={(event) => commit({ description: event.target.value })}
          placeholder="3 oylik to'liq kurs, sertifikat bilan"
          maxLength={255}
        />
      </label>

      {/* What it costs, and — below — through whom. Everything still in the
          drawer is a decision most invoices never revisit, and a form that asks
          all of it at once is the one a shop owner closes. */}
      <div className="flex gap-1.5">
        <label className="flex flex-1 flex-col gap-1">
          <FieldLabel>{stars ? "Stars soni" : "Narx"}</FieldLabel>
          <Input
            value={invoice.amount}
            onChange={(event) => commit({ amount: event.target.value })}
            placeholder={stars ? "500" : "1200000"}
            inputMode={stars ? "numeric" : "decimal"}
          />
        </label>
      </div>

      <CollapsibleSection title={ADVANCED_SECTION_TITLE} summary={extrasSummary}>
        <label className="flex flex-col gap-1">
          <FieldLabel>Valyuta</FieldLabel>
          <Select value={invoice.currency} onChange={(event) => commit({ currency: event.target.value })}>
            {currencies.map((option) => (
              <option key={option.value} value={option.value}>
                {option.value}
              </option>
            ))}
          </Select>
        </label>

        {/* Not optional chrome: the invoice always goes out with this row under
            the pay button, because a customer who changes their mind with
            nothing to tap leaves the run parked. All the author picks is what
            it says. */}
        <label className="flex flex-col gap-1">
          <FieldLabel>Bekor qilish tugmasi</FieldLabel>
          <Input
            value={invoice.cancelLabel ?? ""}
            onChange={(event) => commit({ cancelLabel: event.target.value })}
            placeholder="Bekor qilish"
            maxLength={32}
          />
          <FieldHint>Blokning «Bekor» chiqishiga olib boradi.</FieldHint>
        </label>
      </CollapsibleSection>

      <FieldHint>
        {stars
          ? "Telegram Stars (XTR) — provayder tokeni kerak emas, bot tokeni orqali ishlaydi. Faqat butun son kiritiladi va raqamli tovar/obuna uchun ishlatiladi."
          : "To'lov bloki faqat inline tugmalar bilan ishlaydi."}
      </FieldHint>
    </div>
  );
}
