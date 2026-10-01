"use client";

import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Field, Input, Textarea } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Switch } from "@/components/ui/Switch";
import { Toggle } from "@/components/ui/Toggle";
import { TOOL_KIND_META, type AgentNode } from "../canvas-model";
import { AGENT_OUTCOME_HINT } from "../outcomes";
import type { AgentDraft, AgentModelOption, AgentStatus, AgentTool, AgentToolKind, AgentUsage } from "../types";
import { blankTool, ToolFields } from "./ToolFields";

/**
 * The fields of whichever node is open.
 *
 * Every control here writes into the same `AgentDraft` the canvas is drawn
 * from, so pressing a key changes the card behind the panel in the same
 * gesture. There is no second copy of the agent and no second form: the draft
 * is the only state, the canvas is one reading of it and this panel is the
 * other.
 *
 * Which field belongs to which node is not decided here — `FIELD_HOME` in
 * `canvas-model.ts` is the list, and it is a `Record` over `keyof AgentDraft`
 * so a field with no node fails typecheck rather than becoming a setting
 * nobody can reach.
 */

/** What one model costs, in the only unit an author can act on. */
function modelPrice(model: AgentModelOption): string {
  return `$${model.inputPricePerMTok}/$${model.outputPricePerMTok} — 1M token`;
}

/** A day's budget, as a rough number of conversations rather than as tokens. */
function budgetInWords(tokens: number, maxOutput: number): string {
  if (!tokens) return "Cheksiz — kunlik chegara yo'q.";
  // Input dominates a real turn (the instruction, the history, a tool result),
  // so an output-only estimate would be about four times too optimistic. Four
  // times `maxOutput` is deliberately pessimistic: an author under-promised a
  // number reads it as a floor, and a bill is not a place for optimism.
  const perTurn = Math.max(maxOutput * 4, 1);
  return `Taxminan ${Math.floor(tokens / perTurn)} ta javobga yetadi.`;
}

/**
 * A number field that cannot leave the draft holding a number the API refuses.
 *
 * Every one of these has a `min` the serializer enforces, and an emptied box
 * reads as `0` — which for `maxTurns` is a 400 on the next save, reported
 * against a field name the reader cannot see. Clamping on **blur** rather than
 * on every keystroke is what makes that harmless without making the box
 * unusable: mid-typing, `12` on the way to `1200` is allowed to be too small,
 * and the moment the field is left it becomes a legal value again.
 */
function NumberField({
  label,
  info,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  info?: string;
  value: number;
  min: number;
  max?: number;
  onChange: (next: number) => void;
}) {
  return (
    <Field label={label} info={info}>
      <Input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(Number(event.target.value) || 0)}
        onBlur={() => {
          const clamped = Math.min(Math.max(value, min), max ?? Number.MAX_SAFE_INTEGER);
          if (clamped !== value) onChange(clamped);
        }}
      />
    </Field>
  );
}

export function AgentNodeInspector({
  node,
  draft,
  onChange,
  onOpenNode,
  status,
  usage,
  nameError,
}: {
  node: AgentNode;
  draft: AgentDraft;
  onChange: (patch: Partial<AgentDraft>) => void;
  /**
   * Follow the edit onto the card it produced. Adding a tool opens the tool,
   * deleting one goes back to the hub, moving one goes with it — otherwise the
   * panel stays on a card that is no longer the one the author just acted on,
   * and on a phone that is a sheet showing the wrong thing.
   */
  onOpenNode: (nodeId: string) => void;
  status: AgentStatus;
  /** What this agent has spent today, when it has been saved once. */
  usage?: AgentUsage;
  /** The backend's complaint about the name, printed where the name is typed. */
  nameError?: string | null;
}) {
  const setTools = (tools: AgentTool[]) => onChange({ tools });

  switch (node.kind) {
    case "persona":
      return (
        <div className="flex flex-col gap-4">
          <Field label="Nomi" required error={nameError}>
            <Input
              value={draft.name}
              placeholder="Qabulxona"
              onChange={(event) => onChange({ name: event.target.value })}
            />
          </Field>

          <Field
            label="Bir qatorda — o'zingiz uchun"
            info="Bu matn modelga yuborilmaydi. U kartada va ro'yxatlarda ko'rinadi, xolos — agent o'zini qanday tutishini «Ko'rsatma» hal qiladi."
          >
            <Input
              value={draft.persona}
              placeholder="Klinika qabulxonasi: navbat va narxlar"
              onChange={(event) => onChange({ persona: event.target.value })}
            />
          </Field>

          <Switch
            checked={draft.enabled}
            label="Yoqilgan"
            onToggle={() => onChange({ enabled: !draft.enabled })}
          />
          {!draft.enabled && (
            <p className="t-caption t-tertiary -mt-2">
              O&apos;chirilgan agent javob bermaydi — blok «Chiqishlar» kartasidagi xatolik yo&apos;lidan
              ketadi.
            </p>
          )}
        </div>
      );

    case "instructions":
      return (
        <div className="flex flex-col gap-4">
          <Field
            label="Modelga aynan shu matn beriladi"
            info="Mijoz yozgan hech narsa bu matnga qo'shilmaydi. Shuning uchun mijoz «ko'rsatmangni unut» deb yozsa ham, u faqat ma'lumot bo'lib qoladi, ko'rsatma bo'lmaydi."
          >
            <Textarea
              rows={14}
              value={draft.instructions}
              placeholder={
                "Sen «Sunrise» o'quv markazining qabulxonasisan.\n" +
                "Kurslar, narxlar va dars jadvali haqida javob berasan.\n" +
                "Narxni faqat vositadan olingan ma'lumot asosida ayt, o'zingdan o'ylab topma.\n" +
                "To'lov qilish yoki shartnoma haqida so'ralsa — operatorni chaqir."
              }
              onChange={(event) => onChange({ instructions: event.target.value })}
            />
          </Field>
          {/* The guard, said where the text it guards is typed. Otherwise the
              refusal it produces («Javob ko'rsatma matnini takrorladi») is read
              as the agent being broken. */}
          <p className="t-caption t-tertiary m-0">
            Agent bu matnni javobida takrorlab yuborsa, javob mijozga yetib bormaydi — blok xatolik
            yo&apos;lidan ketadi. Shuning uchun ichki qoidalarni ham bemalol yozavering.
          </p>
        </div>
      );

    case "knowledge":
      return (
        <div className="flex flex-col gap-3">
          <p className="t-footnote t-secondary m-0">
            Bilim bazasi hali qurilmagan. Bugun agent biladigan narsa ikkitadan iborat: ko&apos;rsatmada
            yozilgan matn va HTTP vositasi olib kelgan javob.
          </p>
          <p className="t-caption t-tertiary m-0">
            Uzun ma&apos;lumotni ko&apos;rsatmaga sig&apos;dirmang — uni o&apos;z manzilingizda qoldirib,
            «Ma&apos;lumot olish (HTTP)» vositasi bilan so&apos;rab oling.
          </p>
        </div>
      );

    case "tools":
      return (
        <div className="flex flex-col gap-4">
          <p className="t-footnote t-secondary m-0">
            Vositalar — oqimda allaqachon bor bloklar. Agent manzil yoki so&apos;rov o&apos;ylab topa
            olmaydi: u faqat siz chizgan o&apos;rinlarni to&apos;ldiradi.
          </p>

          {draft.tools.length > 0 && (
            /* Said plainly because the canvas draws them in a column and a
               column looks like an order. It is one — `AgentTool.order` is
               stored and the schemas reach the model in it — but it decides
               nothing about which tool gets called, and an author who read the
               column as a sequence would be drawing a flow that does not exist. */
            <p className="t-caption t-tertiary m-0">
              Tartib saqlanadi, lekin qaysi vositani chaqirishni model o&apos;zi hal qiladi — bu ro&apos;yxat
              navbat emas.
            </p>
          )}

          <div className="flex flex-col gap-2">
            {(Object.keys(TOOL_KIND_META) as AgentToolKind[]).map((kind) => (
              <Button
                key={kind}
                type="button"
                variant="secondary"
                className="justify-start"
                onClick={() => {
                  setTools([...draft.tools, blankTool(kind, draft.tools.length + 1)]);
                  onOpenNode(`tool:${draft.tools.length}`);
                }}
              >
                <Icon name="plus" size={15} />
                {TOOL_KIND_META[kind].label}
              </Button>
            ))}
          </div>

          {draft.tools.length === 0 && (
            <p className="t-caption t-tertiary m-0">
              Vositasiz agent faqat ko&apos;rsatmasi asosida gapiradi — bu ko&apos;p hollarda yetarli.
            </p>
          )}
        </div>
      );

    case "tool": {
      const index = node.toolIndex ?? -1;
      const tool = draft.tools[index];
      if (!tool) return null;
      const meta = TOOL_KIND_META[tool.kind];
      const move = (to: number) => {
        if (to < 0 || to >= draft.tools.length) return;
        const next = [...draft.tools];
        const [row] = next.splice(index, 1);
        if (row) next.splice(to, 0, row);
        setTools(next);
        onOpenNode(`tool:${to}`);
      };
      return (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <Icon name={meta.icon} size={16} style={{ color: meta.color }} className="flex-none" />
            <span className="t-subhead min-w-0 flex-1 truncate">{meta.label}</span>
            <Toggle
              checked={tool.enabled}
              label="Yoqilgan"
              onToggle={() =>
                setTools(draft.tools.map((row, i) => (i === index ? { ...row, enabled: !row.enabled } : row)))
              }
            />
          </div>

          <ToolFields
            tool={tool}
            onChange={(next) => setTools(draft.tools.map((row, i) => (i === index ? next : row)))}
          />

          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" disabled={index === 0} onClick={() => move(index - 1)}>
              <Icon name="caret-up" size={15} /> Yuqoriga
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={index === draft.tools.length - 1}
              onClick={() => move(index + 1)}
            >
              <Icon name="caret-down" size={15} /> Pastga
            </Button>
            <span className="flex-1" />
            <Button
              type="button"
              variant="danger-ghost"
              onClick={() => {
                setTools(draft.tools.filter((_, i) => i !== index));
                onOpenNode("tools");
              }}
            >
              <Icon name="trash" size={15} /> O&apos;chirish
            </Button>
          </div>
        </div>
      );
    }

    case "limits": {
      const chosen = status.models.find((option) => option.id === draft.model);
      return (
        <div className="flex flex-col gap-4">
          <Field label="Model">
            <Select value={draft.model} onChange={(event) => onChange({ model: event.target.value })}>
              {status.models.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label} · {modelPrice(option)}
                </option>
              ))}
              {/* A stored agent can name a model that has left the catalogue.
                  The backend falls back to the everyday one and records which
                  model actually ran; the picker says so instead of silently
                  showing the wrong row as selected. */}
              {draft.model && !chosen && (
                <option value={draft.model}>{draft.model} (ro&apos;yxatda yo&apos;q)</option>
              )}
            </Select>
          </Field>
          {chosen && <p className="t-caption t-tertiary -mt-2">{chosen.hint}</p>}

          {chosen?.supportsEffort && (
            <Field
              label="Chuqurlik"
              info="Yuqori chuqurlik model ko'proq o'ylashiga imkon beradi — sifat oshadi, tezlik va narx ham. Telegram javobi uchun odatda «medium» yetarli."
            >
              <Select value={draft.effort} onChange={(event) => onChange({ effort: event.target.value })}>
                {status.effortLevels.map((level) => (
                  <option key={level} value={level}>
                    {level}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {chosen && !chosen.supportsEffort && (
            /* The value still travels — it is held in the draft and posted from
               a hidden input, so switching to a model that rejects `effort` and
               saving does not blank a setting the author never touched. */
            <p className="t-caption t-tertiary m-0">
              Bu model «chuqurlik»ni qabul qilmaydi — sozlama saqlanib turadi, lekin ishlatilmaydi.
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <NumberField
              label="Bir xabarga necha qadam"
              info="Har bir qadam — modelga bitta murojaat. Vosita chaqirib, javobini o'qib, yana chaqirish — bu ikki qadam. Chegara tugasa agent to'xtaydi."
              value={draft.maxTurns}
              min={1}
              max={12}
              onChange={(maxTurns) => onChange({ maxTurns })}
            />
            <NumberField
              label="Javob uzunligi (token)"
              value={draft.maxOutputTokens}
              min={64}
              max={8000}
              onChange={(maxOutputTokens) => onChange({ maxOutputTokens })}
            />
            <NumberField
              label="Kunlik token byudjeti"
              value={draft.dailyTokenBudget}
              min={0}
              onChange={(dailyTokenBudget) => onChange({ dailyTokenBudget })}
            />
            <NumberField
              label="Javobning eng ko'p belgisi"
              value={draft.replyMaxChars}
              min={80}
              max={4000}
              onChange={(replyMaxChars) => onChange({ replyMaxChars })}
            />
            <NumberField
              label="Nechta oldingi savol eslansin"
              info="0 — har bir xabarga alohida javob beradi. Suhbat uchun 4–8 orasi."
              value={draft.historyDepth}
              min={0}
              max={20}
              onChange={(historyDepth) => onChange({ historyDepth })}
            />
          </div>

          <p className="t-caption t-tertiary m-0">
            {budgetInWords(draft.dailyTokenBudget, draft.maxOutputTokens)}
          </p>
          {usage && (
            <p className="t-caption t-tertiary m-0">
              Bugun sarflandi: {usage.tokensToday.toLocaleString("uz-UZ")} token
              {usage.budget ? ` / ${usage.budget.toLocaleString("uz-UZ")}` : ""}.
            </p>
          )}
        </div>
      );
    }

    case "outputs":
      return (
        <div className="flex flex-col gap-4">
          <p className="t-footnote t-secondary m-0">
            Bu uchtasi — oqimdagi «AI agent» blokining chiqishlari. Ular shu yerda emas, oqim kanvasida
            ulanadi; ulanmagan chiqish suhbatni jimgina tugatadi.
          </p>

          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {(node.ports ?? []).map((port) => (
              <li key={port.id} className="flex items-start gap-2.5 rounded-[12px] bg-neutral-900 p-3">
                <span
                  aria-hidden
                  className="mt-[5px] size-[9px] flex-none rounded-full"
                  style={{ background: port.color }}
                />
                <div className="min-w-0 flex-1">
                  <p className="t-subhead m-0" style={{ color: port.color }}>
                    {port.label}
                  </p>
                  <p className="t-caption t-tertiary m-0 mt-0.5">{AGENT_OUTCOME_HINT[port.id]}</p>
                </div>
                {typeof port.count === "number" && (
                  <span className="t-caption t-tertiary flex-none tabular-nums">{port.count}</span>
                )}
              </li>
            ))}
          </ul>

          <Switch
            checked={draft.escalateOnFailure}
            label="Javob topilmasa yoki xato bo'lsa — «Operatorga»"
            onToggle={() => onChange({ escalateOnFailure: !draft.escalateOnFailure })}
          />
          <p className="t-caption t-tertiary -mt-2">
            {draft.escalateOnFailure
              ? "Har qanday muvaffaqiyatsizlik operatorga boradi. Tunda navbatchi bo'lmasa — o'chirib qo'ying."
              : "Muvaffaqiyatsizlik «Tushunmadi» chiqishiga boradi — u yerda o'zingiz yozgan javobni chizasiz."}
          </p>
        </div>
      );
  }
}
