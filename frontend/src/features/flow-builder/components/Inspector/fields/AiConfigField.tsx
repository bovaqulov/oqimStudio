"use client";

import { Input, Textarea } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { CheckboxRow } from "@/components/ui/CheckboxRow";
import type { AiConfig } from "@/features/flows";
import {
  AI_MODELS,
  AI_TEMPERATURE_MAX,
  AI_TEMPERATURE_MIN,
  AI_TEMPERATURE_STEP,
  getAiModel,
  getKnowledgeSource,
  KNOWLEDGE_SOURCES,
} from "../../../lib/ai";
import type { FlowLinkOption } from "./FlowLinkField";
import { ADVANCED_SECTION_TITLE } from "./advanced-fields";
import { CollapsibleSection } from "./CollapsibleSection";
import { FieldHint } from "./FieldHint";
import { FieldLabel } from "./FieldLabel";
import { SampleFill } from "./SampleFill";

const SAMPLE_FALLBACK = "Kechirasiz, bu savolga javob topa olmadim. Operatorimiz tez orada bog'lanadi.";

/**
 * Everything an AI block needs besides its prompt.
 *
 * Two questions lead, and they are the two an author has an opinion about:
 * what the model may read, and what happens when it cannot answer — the second
 * being the difference between a demo and something you can put in front of
 * customers. Which model and how freely it writes are real settings with real
 * defaults, and asking them first made the block look like a research console;
 * they fold, with the chosen model on the closed header so the choice is never
 * hidden, only quiet.
 */
export function AiConfigField({
  value,
  siblingFlows,
  onChange,
}: {
  value: AiConfig;
  siblingFlows: FlowLinkOption[];
  onChange: (config: AiConfig) => void;
}) {
  const model = getAiModel(value.model);
  const source = getKnowledgeSource(value.knowledgeSource);

  function patch(next: Partial<AiConfig>) {
    onChange({ ...value, ...next });
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-neutral-800 p-2.5">
      <label className="flex flex-col gap-1">
        <FieldLabel>Bilim manbasi</FieldLabel>
        <Select
          value={value.knowledgeSource}
          onChange={(event) => patch({ knowledgeSource: event.target.value as AiConfig["knowledgeSource"] })}
        >
          {KNOWLEDGE_SOURCES.map((option) => (
            <option key={option.key} value={option.key}>
              {option.label}
            </option>
          ))}
        </Select>
        <FieldHint>{source.hint}</FieldHint>
      </label>

      {source.refLabel && (
        <label className="flex flex-col gap-1">
          <FieldLabel>{source.refLabel}</FieldLabel>
          <Input
            value={value.knowledgeRef ?? ""}
            placeholder={source.refPlaceholder}
            onChange={(event) => patch({ knowledgeRef: event.target.value })}
          />
          {!value.knowledgeRef?.trim() && source.refPlaceholder && (
            <SampleFill onFill={() => patch({ knowledgeRef: source.refPlaceholder })} />
          )}
        </label>
      )}

      <div className="flex flex-col gap-1.5 border-t border-neutral-800 pt-2.5">
        <FieldLabel>Javob topilmasa</FieldLabel>
        <Select
          value={value.fallbackAction}
          onChange={(event) => patch({ fallbackAction: event.target.value as AiConfig["fallbackAction"] })}
        >
          <option value="message">Tayyor matn yuborish</option>
          <option value="handoff">Operatorga uzatish</option>
          <option value="flow">Boshqa oqimga o&apos;tkazish</option>
        </Select>

        {value.fallbackAction === "message" && (
          <>
            <Textarea
              rows={2}
              value={value.fallbackText ?? ""}
              placeholder={SAMPLE_FALLBACK}
              onChange={(event) => patch({ fallbackText: event.target.value })}
            />
            {!value.fallbackText?.trim() && <SampleFill onFill={() => patch({ fallbackText: SAMPLE_FALLBACK })} />}
          </>
        )}

        {value.fallbackAction === "flow" && (
          <Select
            value={value.fallbackFlowId ?? ""}
            onChange={(event) => patch({ fallbackFlowId: event.target.value })}
          >
            <option value="">Oqimni tanlang…</option>
            {siblingFlows.map((flow) => (
              <option key={flow.id} value={flow.id}>
                {flow.name}
              </option>
            ))}
          </Select>
        )}

        <CheckboxRow
          checked={value.handoffOnLowConfidence ?? false}
          onToggle={() => patch({ handoffOnLowConfidence: !value.handoffOnLowConfidence })}
          label="Model ishonchsiz javob bersa ham operatorga uzatilsin"
        />
      </div>

      <CollapsibleSection
        title={ADVANCED_SECTION_TITLE}
        summary={`${model.label} · t=${value.temperature.toFixed(1)} · ${value.maxTokens} token`}
      >
        <label className="flex flex-col gap-1">
          <FieldLabel>Model</FieldLabel>
          <Select value={value.model} onChange={(event) => patch({ model: event.target.value })}>
            {AI_MODELS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </Select>
          <FieldHint>
            {model.hint} · 1M token uchun ${model.inputPricePerMTok} kirish / ${model.outputPricePerMTok} chiqish
          </FieldHint>
        </label>

        <label className="flex flex-col gap-1">
          <FieldLabel>
            Ijodkorlik · <span className="tabular-nums text-neutral-400">{value.temperature.toFixed(1)}</span>
          </FieldLabel>
          <input
            type="range"
            min={AI_TEMPERATURE_MIN}
            max={AI_TEMPERATURE_MAX}
            step={AI_TEMPERATURE_STEP}
            value={value.temperature}
            onChange={(event) => patch({ temperature: Number(event.target.value) })}
            className="w-full accent-[var(--color-accent-500)]"
          />
          <FieldHint>
            0 — bir xil, bashorat qilinadigan javob (narx, qoida). 1 — erkin, jonli uslub (marketing matni).
          </FieldHint>
        </label>

        <label className="flex flex-col gap-1">
          <FieldLabel>Javob uzunligi (token)</FieldLabel>
          <Input
            type="number"
            min={50}
            max={4000}
            step={50}
            value={value.maxTokens}
            onChange={(event) => patch({ maxTokens: Number(event.target.value) })}
          />
          <FieldHint>
            Taxminan {Math.round(value.maxTokens * 0.75)} ta so&apos;z. Telegram xabari uchun 300–800 yetarli.
          </FieldHint>
        </label>
      </CollapsibleSection>
    </div>
  );
}
