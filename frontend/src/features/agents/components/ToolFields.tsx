"use client";

import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";
import { Field, Input, Textarea } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { TOOL_KIND_META } from "../canvas-model";
import type { AgentTool, AgentToolKind, AgentToolParam } from "../types";

/**
 * The fields of one tool — what the «Vositalar» branch opens onto.
 *
 * The list of kinds is short and closed on purpose. Every kind is a block the
 * runtime already has, reached by that block's own code: `http` goes through
 * the same SSRF-checked fetch the «HTTP so'rov» block uses, `save` writes a
 * contact variable the way «Ma'lumotni saqlash» does, and `handoff` ends the
 * turn on the block's «Operatorga» exit where the author has drawn what a
 * handover means. There is no "custom tool" row and there should not be one:
 * a second tool system would be a second set of holes, and it would be the set
 * nobody audited.
 *
 * The rule the canvas must not soften, from `apps/agents/tools.py`: **the
 * model never supplies a destination.** The URL and the variable name are the
 * author's, typed here; the model only fills in values for parameters somebody
 * drew. A card that let an agent name its own endpoint would take the one
 * layer that actually holds and remove it.
 */

const PARAM_TYPES: { value: AgentToolParam["type"]; label: string }[] = [
  { value: "string", label: "Matn" },
  { value: "number", label: "Son" },
  { value: "enum", label: "Ro'yxatdan" },
];

/** A fresh row of the kind the author picked, with a name they can type over. */
export function blankTool(kind: AgentToolKind, index: number): AgentTool {
  const defaults: Record<AgentToolKind, Pick<AgentTool, "name" | "description" | "config">> = {
    http: {
      name: `malumot_${index}`,
      description: "Narx yoki jadval kabi ma'lumotni bazadan olib beradi.",
      config: { url: "https://", params: [] },
    },
    save: {
      // Numbered like the HTTP row above it: the unnumbered name was the
      // second tool anybody added, and two of them collide on
      // `(agent, name)` — which the serializer answers with a 400 on save.
      name: `malumotni_saqla_${index}`,
      description: "Mijoz aytgan ma'lumotni saqlaydi.",
      config: { variable: "mijoz_izohi" },
    },
    handoff: {
      name: "operator_chaqir",
      description: "Savolga javob topa olmaganda yoki mijoz odam so'raganda chaqiriladi.",
      config: {},
    },
  };
  return { kind, enabled: true, ...defaults[kind] };
}

function ParamRow({
  param,
  onChange,
  onRemove,
}: {
  param: AgentToolParam;
  onChange: (next: AgentToolParam) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-[10px] bg-neutral-900 p-2.5">
      <div className="flex items-center gap-2">
        <Input
          value={param.name}
          placeholder="kurs_nomi"
          aria-label="Parametr nomi"
          className="h-9 text-[15px]"
          onChange={(event) => onChange({ ...param, name: event.target.value })}
        />
        <Select
          value={param.type}
          aria-label="Turi"
          className="h-9 w-32 text-[15px]"
          onChange={(event) => onChange({ ...param, type: event.target.value as AgentToolParam["type"] })}
        >
          {PARAM_TYPES.map((type) => (
            <option key={type.value} value={type.value}>
              {type.label}
            </option>
          ))}
        </Select>
        <Button variant="danger-ghost" type="button" onClick={onRemove} aria-label="O'chirish">
          <Icon name="trash" size={16} />
        </Button>
      </div>
      <Input
        value={param.description ?? ""}
        placeholder="Agentga tushuntirish: qaysi kurs haqida so'ralayotgani"
        aria-label="Tavsif"
        className="h-9 text-[15px]"
        onChange={(event) => onChange({ ...param, description: event.target.value })}
      />
      {param.type === "enum" && (
        <Input
          value={(param.enum ?? []).join(", ")}
          placeholder="ingliz, matematika, dasturlash"
          aria-label="Ruxsat etilgan qiymatlar"
          className="h-9 text-[15px]"
          onChange={(event) =>
            onChange({
              ...param,
              enum: event.target.value.split(",").map((value) => value.trim()).filter(Boolean),
            })
          }
        />
      )}
      <label className="t-caption t-secondary flex cursor-pointer items-center gap-2">
        <input
          type="checkbox"
          checked={!!param.required}
          onChange={(event) => onChange({ ...param, required: event.target.checked })}
        />
        Majburiy
      </label>
    </div>
  );
}

export function ToolFields({
  tool,
  onChange,
}: {
  tool: AgentTool;
  onChange: (next: AgentTool) => void;
}) {
  const params = tool.config.params ?? [];

  return (
    <div className="flex flex-col gap-3">
      <p className="t-caption t-tertiary m-0">{TOOL_KIND_META[tool.kind].hint}</p>

      <Field label="Nomi (agent shu nom bilan chaqiradi)">
        <Input
          value={tool.name}
          placeholder="narxni_ol"
          onChange={(event) => onChange({ ...tool, name: event.target.value })}
        />
      </Field>

      {/* Model-facing, and the one place the author's words reach the prompt.
          Worth saying so: a description that reads "narxlar" tells the model
          nothing about *when* to reach for it, which is what it actually has
          to decide. */}
      <Field label="Qachon ishlatilsin — agentga tushuntirish">
        <Textarea
          rows={2}
          value={tool.description}
          placeholder="Mijoz kursning narxini so'raganda chaqir."
          onChange={(event) => onChange({ ...tool, description: event.target.value })}
        />
      </Field>

      {tool.kind === "http" && (
        <>
          <Field label="Manzil — {parametr} o'rinlari bilan">
            <Input
              value={tool.config.url ?? ""}
              placeholder="https://api.maktab.uz/narx/{kurs}"
              onChange={(event) => onChange({ ...tool, config: { ...tool.config, url: event.target.value } })}
            />
          </Field>
          <div className="flex flex-col gap-2">
            <span className="t-footnote t-secondary">Parametrlar</span>
            {params.map((param, index) => (
              <ParamRow
                key={index}
                param={param}
                onChange={(next) =>
                  onChange({
                    ...tool,
                    config: { ...tool.config, params: params.map((row, i) => (i === index ? next : row)) },
                  })
                }
                onRemove={() =>
                  onChange({
                    ...tool,
                    config: { ...tool.config, params: params.filter((_, i) => i !== index) },
                  })
                }
              />
            ))}
            <Button
              type="button"
              variant="ghost"
              onClick={() =>
                onChange({
                  ...tool,
                  config: {
                    ...tool.config,
                    params: [...params, { name: "", type: "string", required: true }],
                  },
                })
              }
            >
              <Icon name="plus" size={15} /> Parametr qo&apos;shish
            </Button>
          </div>
        </>
      )}

      {tool.kind === "save" && (
        <Field label="Qaysi o'zgaruvchiga yozilsin">
          <Input
            value={tool.config.variable ?? ""}
            placeholder="mijoz_manzili"
            onChange={(event) => onChange({ ...tool, config: { ...tool.config, variable: event.target.value } })}
          />
        </Field>
      )}
    </div>
  );
}
