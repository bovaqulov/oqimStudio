"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Icon, type IconName } from "@/components/ui/Icon";
import { Field, Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { MainButton } from "@/lib/telegram/MainButton";
import { cn } from "@/lib/utils/cn";
import { createTableAction } from "../actions";
import { KV_KEY_COLUMN, KV_VALUE_COLUMN, type TableKind } from "../types";
import { ColumnFields, toColumns, type DraftColumn } from "./ColumnFields";

/**
 * A new store, asked for one question at a time.
 *
 * It used to be a single screen — name, bot, columns — which was the right
 * shape while there was only one kind of store to make. A kind choice on that
 * screen would have sat between the name and a column editor that half the
 * answers make meaningless, and the reader would have been deciding what they
 * were building while looking at the parts of something else.
 *
 * So: the name, then the kind, then whatever that kind still needs. The last
 * step is the only one that differs — a table is its columns, and a `kv` store
 * has none to describe, so it gets the pair shown to it rather than asked for.
 *
 * The bot moved to that last step for the same reason the key field left this
 * form entirely: it is almost always «Hamma botlar uchun», and a question
 * nobody answers does not belong on the screen that opens.
 */

const STARTER_COLUMNS: DraftColumn[] = [
  { uid: "c0", key: "nomi", label: "Nomi", type: "text", savedKey: null },
  { uid: "c1", key: "narxi", label: "Narxi", type: "number", savedKey: null },
];

const KINDS: { value: TableKind; icon: IconName; title: string; blurb: string }[] = [
  {
    value: "table",
    icon: "table",
    title: "Jadval",
    blurb: "Ustunlar va ular ostidagi qatorlar — narxlar ro'yxati, jadval, navbat.",
  },
  {
    value: "kv",
    icon: "tag",
    title: "Kalit = qiymat",
    blurb: "Har bir kalitga bitta qiymat — sozlamalar, matnlar, hisoblagichlar.",
  },
];

/** What the third step is called, which is not the same question for both kinds. */
const LAST_STEP_LABEL: Record<TableKind, string> = { table: "Ustunlar", kv: "Tayyor" };

export function NewTableForm({
  bots,
  projectId = null,
}: {
  bots: { id: string; name: string }[];
  /** Where this table belongs, when the screen was opened from a project. */
  projectId?: string | null;
}) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<TableKind>("table");
  const [botId, setBotId] = useState("");
  const [columns, setColumns] = useState<DraftColumn[]>(STARTER_COLUMNS);
  const [error, setError] = useState<{ message: string; field?: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const steps = [
    { key: "name", label: "Nomi" },
    { key: "kind", label: "Turi" },
    { key: "shape", label: LAST_STEP_LABEL[kind] },
  ];
  const last = steps.length - 1;
  /** Whether the step on screen has enough on it to move off. */
  const stepValid = step === 0 ? Boolean(name.trim()) : true;

  function next() {
    if (!stepValid) {
      setError({ message: "Ma'lumotga nom bering.", field: "name" });
      return;
    }
    setError(null);
    setStep((current) => Math.min(last, current + 1));
  }

  function choose(value: TableKind) {
    setKind(value);
    setError(null);
    // Straight on. It is a choice between two, the strip above says where it
    // landed, and «Orqaga» is the width of a thumb away — asking for a second
    // press to confirm a two-way pick is a step that only ever costs.
    setStep(last);
  }

  function submit() {
    if (pending) return;
    setError(null);

    if (!name.trim()) {
      setStep(0);
      setError({ message: "Ma'lumotga nom bering.", field: "name" });
      return;
    }
    startTransition(async () => {
      const result = await createTableAction({
        name: name.trim(),
        botId: botId || null,
        projectId,
        kind,
        // Ignored for `kv`, whose columns are the kind rather than a choice —
        // the action drops them and the backend writes the pair.
        columns: toColumns(columns),
      });
      if ("error" in result) {
        // A refusal about the name belongs on the step that asked for it,
        // which by now is two screens back.
        if (result.field === "name") setStep(0);
        setError({ message: result.error, field: result.field });
        return;
      }
      // Straight into the store that was just made: the next thing the reader
      // wants is a row in it, and that is the screen this lands on.
      router.push(`/tables/${result.tableId}`);
    });
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (step < last) next();
        else submit();
      }}
    >
      <StepBar steps={steps} step={step} onStep={(index) => index < step && setStep(index)} />

      {step === 0 && (
        <Field label="Nomi" required error={error?.field === "name" ? error.message : null}>
          <Input
            value={name}
            autoFocus
            maxLength={120}
            placeholder="Narxlar"
            aria-invalid={error?.field === "name" || undefined}
            onChange={(event) => {
              setName(event.target.value);
              setError(null);
            }}
          />
        </Field>
      )}

      {/*
       * No key field, on any step. It used to be asked for here, defaulted from
       * the name, and explained with a tooltip warning that changing it breaks
       * the flows that use it — which is a question about the product's
       * internals put to somebody who came here to write down their prices. The
       * backend derives one from the name (`tables/serializers.py::derive_handle`)
       * and guarantees it is unique in the workspace; it is shown, read only, on
       * the store's «Integratsiyalar» tab, which is where somebody writing
       * `{{ table("...") }}` actually looks for it.
       */}

      {step === 1 && (
        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className="t-footnote t-secondary mb-1 p-0">Ma&apos;lumot bazasi turi</legend>
          {KINDS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={kind === option.value}
              onClick={() => choose(option.value)}
              className={cn(
                "oq-press flex w-full cursor-pointer items-start gap-3 rounded-[14px] border p-3.5 text-left transition-colors",
                kind === option.value
                  ? "border-accent-500 bg-accent-900/40"
                  : "border-separator bg-neutral-900 hover:bg-neutral-800",
              )}
            >
              <span
                className={cn(
                  "flex h-9 w-9 flex-none items-center justify-center rounded-[10px]",
                  kind === option.value ? "bg-accent-800 text-accent-ink" : "bg-neutral-800 text-neutral-400",
                )}
              >
                <Icon name={option.icon} size={18} />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="t-body">{option.title}</span>
                <span className="t-footnote t-secondary leading-[18px]">{option.blurb}</span>
              </span>
            </button>
          ))}
        </fieldset>
      )}

      {step === last && (
        <>
          {kind === "table" ? (
            <div className="flex flex-col gap-2">
              <span className="t-footnote t-secondary">Ustunlar</span>
              <ColumnFields
                columns={columns}
                onChange={setColumns}
                disabled={pending}
                error={
                  error && !error.field ? error.message : error?.field === "columns" ? error.message : null
                }
              />
            </div>
          ) : (
            /* Shown rather than asked for. A `kv` store's two columns are what
               the kind means, so the honest thing is to say what the reader is
               about to get — and the words «kalit» and «qiymat» are the ones
               their flow expressions will use. */
            <div className="flex flex-col gap-2">
              <span className="t-footnote t-secondary">Ustunlar</span>
              <div className="flex flex-col gap-1.5 rounded-[14px] border border-separator bg-neutral-900 p-3.5">
                <KvColumn name={KV_KEY_COLUMN} label="Kalit" note="Takrorlanmaydi" />
                <KvColumn name={KV_VALUE_COLUMN} label="Qiymat" note="Matn" />
              </div>
              {error && !error.field && <p className="t-footnote m-0 text-danger-fg">{error.message}</p>}
            </div>
          )}

          {bots.length > 0 && (
            <Field label="Bot">
              <Select value={botId} onChange={(event) => setBotId(event.target.value)}>
                {/* A store shared by every bot in the workspace is the ordinary
                    case, so it is the one that needs no choosing. */}
                <option value="">Hamma botlar uchun</option>
                {bots.map((bot) => (
                  <option key={bot.id} value={bot.id}>
                    {bot.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </>
      )}

      <div className="mt-1 flex flex-col-reverse gap-2 md:flex-row md:items-center md:gap-3">
        {step < last ? (
          <MainButton inline text="Davom etish" onClick={next} />
        ) : (
          <MainButton inline text={pending ? "Yaratilmoqda…" : "Yaratish"} loading={pending} onClick={submit} />
        )}
        {step > 0 ? (
          <button
            type="button"
            onClick={() => setStep((current) => current - 1)}
            className="oq-press t-body flex min-h-[44px] cursor-pointer items-center justify-center px-1 text-accent-400 md:justify-start"
          >
            Orqaga
          </button>
        ) : (
          <Link
            href="/tables"
            className="oq-press t-body flex min-h-[44px] items-center justify-center px-1 text-accent-400 md:justify-start"
          >
            Bekor qilish
          </Link>
        )}
      </div>
    </form>
  );
}

/** One line of the pair a `kv` store is fixed to. */
function KvColumn({ name, label, note }: { name: string; label: string; note: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="t-body min-w-0 flex-1 truncate">{label}</span>
      <span className="font-mono text-[12.5px] text-neutral-500">{name}</span>
      <span className="t-footnote t-tertiary flex-none">{note}</span>
    </div>
  );
}

/**
 * Where the reader is, and the way back.
 *
 * Only backwards: a step ahead has not been answered yet, and a strip that
 * jumped to it would show a column editor for a kind nobody had chosen.
 */
function StepBar({
  steps,
  step,
  onStep,
}: {
  steps: { key: string; label: string }[];
  step: number;
  onStep: (index: number) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      {steps.map((item, index) => {
        const done = index < step;
        const active = index === step;
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => onStep(index)}
            aria-current={active ? "step" : undefined}
            disabled={index > step}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-full px-2.5 py-2 text-[13px] transition-colors md:flex-none md:justify-start md:py-1 md:text-[11.5px]",
              active
                ? "bg-accent-800 text-accent-ink"
                : done
                  ? "cursor-pointer text-accent-300 hover:bg-neutral-800"
                  : "text-neutral-700",
            )}
          >
            <span
              className={cn(
                "flex h-4 w-4 flex-none items-center justify-center rounded-full text-[9.5px] tabular-nums",
                active
                  ? "bg-white/20 text-white"
                  : done
                    ? "bg-accent-900 text-accent-200"
                    : "bg-neutral-800 text-neutral-600",
              )}
            >
              {done ? <Icon name="check" size={8} weight="bold" /> : index + 1}
            </span>
            <span className="whitespace-nowrap">{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}
